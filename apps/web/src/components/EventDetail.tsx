import { useEffect, useRef, useState } from 'react';
import { FLAG_REASONS, type FlagReason, type LatLng, type NearbyEvent } from '@happow/core';
import { track } from '../analytics';
import { config } from '../config';
import { formatAgo, formatCountdown, formatDay, formatTime, isSameDay } from '../format';
import { eventUrl } from '../hooks/useHashRoute';
import { downloadIcs } from '../ics';
import { useI18n } from '../i18n';
import { FlagNotice, GoButtons, useEventText } from './EventMeta';
import { Going } from './Going';
import { InstallHint } from './InstallHint';
import { NearbyNow } from './NearbyNow';
import { ShareSheet } from './ShareSheet';
import { hasRules, RuleList } from './EventCard';
import { FollowStar, PerformerChips } from './Follow';
import { follows, useFollows } from '../follows';
import { Icon } from './Icons';
import { ReportDialog } from './ReportDialog';
import { ReminderSheet, useLeadLabel } from './ReminderSheet';
import { useReminders } from '../reminders';
import { countEvent } from '../counts';
import type { Credit } from '../data/repository';
import { levelKey } from '../contributions';
import { isPrivate } from '../private';
import { FriendsLine } from './FriendsLine';
import { useOrganiser } from './OrganiserPanel';
import { PrivatePanel } from './PrivatePanel';
import { PartyNotice } from './OpenPlaceCard';
import { NotifyHint } from './NotifyHint';
import type { OpenPlace } from '../places';

const sourceNames = new Map(config.sources.map((s) => [s.id, s.name]));

interface Props {
  ev: NearbyEvent | null;
  loading: boolean;
  now: Date;
  saved: boolean;
  onToggleSave: () => void;
  onClose: () => void;
  /** A status report from this device, so the warning shows here before the next reload. */
  onReported: (id: string, reason: FlagReason) => void;
  /** Opens "Going there" (route inside the app). */
  onGo: () => void;
  /** "Added by" for a community event, read live. */
  loadCredit: (eventId: string, signal: AbortSignal) => Promise<Credit | null>;
  /** Events around a place, for "on now nearby" under an ended event. */
  loadNearby: (at: LatLng, signal: AbortSignal) => Promise<NearbyEvent[]>;
  /** Opens another event's card in place of this one. */
  onOpenEvent: (id: string) => void;
  /** Where distances count from (private events read with it). */
  center?: LatLng | null;
  /** The place the event is at holds a private party now. */
  party?: OpenPlace | null;
  /** An edit or an answer changed the event: read it again. */
  onChanged?: () => void;
}

/** Wall-clock midnight to midnight: a day-long listing (exhibitions, fairs). */
function isDayLong(ev: NearbyEvent): boolean {
  const hm = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: ev.timezone,
  });
  const midnight = (iso: string) => hm.format(new Date(iso)) === '00:00';
  return !ev.endEstimated && midnight(ev.startAt) && midnight(ev.endAt);
}

export function EventDetail({
  ev,
  loading,
  now,
  saved,
  onToggleSave,
  onClose,
  onReported,
  onGo,
  loadCredit,
  loadNearby,
  onOpenEvent,
  center = null,
  party = null,
  onChanged = () => {},
}: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);

  // An open for its adder's "your impact".
  const eventId = ev?.id;
  useEffect(() => {
    if (eventId) countEvent(eventId, 'open');
  }, [eventId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay overlay--detail" onClick={onClose}>
      <div
        ref={dialog}
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="detail__bar">
          <button
            type="button"
            className="icon-btn icon-btn--raised"
            onClick={onClose}
            aria-label={t('event.back')}
          >
            <Icon name="back" />
          </button>
        </header>
        {ev ? (
          <DetailBody
            ev={ev}
            now={now}
            saved={saved}
            onToggleSave={onToggleSave}
            onReported={onReported}
            onGo={onGo}
            loadCredit={loadCredit}
            loadNearby={loadNearby}
            onOpenEvent={onOpenEvent}
            center={center}
            party={party}
            onChanged={onChanged}
            onClose={onClose}
          />
        ) : (
          <p className="detail__empty" id="detail-title" aria-live="polite">
            {loading ? t('event.loading') : t('event.notFound')}
          </p>
        )}
      </div>
    </div>
  );
}

function DetailBody({
  ev,
  now,
  saved,
  onToggleSave,
  onReported,
  onGo,
  loadCredit,
  loadNearby,
  onOpenEvent,
  center,
  party,
  onChanged,
  onClose,
}: {
  ev: NearbyEvent;
  party: OpenPlace | null;
  now: Date;
  saved: boolean;
  onToggleSave: () => void;
  onReported: Props['onReported'];
  onGo: () => void;
  loadCredit: Props['loadCredit'];
  loadNearby: Props['loadNearby'];
  onOpenEvent: Props['onOpenEvent'];
  center: LatLng | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const priv = isPrivate(ev);
  const credit = useCredit(ev, loadCredit);
  const { running, price, distance, walk, categories } = useEventText(ev, now);
  const [toast, setToast] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const reminder = useReminders()[ev.id] ?? null;
  const leadLabel = useLeadLabel();
  const url = eventUrl(ev.id);
  const ended = new Date(ev.endAt) < now;
  const dayLong = isDayLong(ev);
  const start = formatTime(ev.startAt, ev.timezone, lang);
  const end = formatTime(ev.endAt, ev.timezone, lang);
  const sameDay = isSameDay(ev.startAt, new Date(new Date(ev.endAt).getTime() - 1), ev.timezone);
  const organiser = useOrganiser({ ev, now, onToast: setToast, onChanged });
  const ownerTools = priv && ev.mine;
  const source = (ev.sourceId && sourceNames.get(ev.sourceId)) || t(`event.source.${ev.trust}`);
  useFollows();
  const followed = (ev.performers ?? []).some((p) => follows.isFollowed(p.name));

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div className="detail__scroll">
      <div className="detail__body">
        {/* Centred, with room at both sides: the back button never covers the title. */}
        <header className="detail__head">
          <div className="event-card__cats">
            {categories.map((c) => c.labels[lang]).join(' · ')}
            <span className={`badge badge--${ev.trust}`}>{t(`event.source.${ev.trust}`)}</span>
            {ev.verified === false && (
              <span className="badge badge--unverified">{t('event.unverified')}</span>
            )}
            {followed && <FollowStar />}
          </div>
          <h1 id="detail-title">{ev.title}</h1>
        </header>
        <InstallHint />

        {ended && <p className="status-banner status-banner--ended">{t('ended.banner')}</p>}
        <FlagNotice ev={ev} now={now} />
        {party && <PartyNotice place={party} timeZone={ev.timezone} named />}
        {ev.status !== 'scheduled' && (
          <p className={`status-banner status-banner--${ev.status}`}>{t(`event.${ev.status}`)}</p>
        )}
        {organiser.updates && (
          <section className="organiser" aria-label={t('organiser.section')}>
            {organiser.updates}
          </section>
        )}
        <PerformerChips performers={ev.performers} />

        <ul className="facts">
          <li>
            <Icon name="clock" />
            <div>
              {/* The time left leads; the date follows. */}
              {ev.status !== 'cancelled' && (
                <span className="facts__count">
                  {running && <span className="now-pill">{t('event.now')}</span>}
                  {running
                    ? t('event.until', { time: end })
                    : ended
                      ? t('event.ended')
                      : formatCountdown(ev.startAt, now, lang)}
                </span>
              )}
              <strong>
                {formatDay(ev.startAt, ev.timezone, lang)}
                {dayLong
                  ? ` · ${t('event.dayLong')}`
                  : sameDay
                    ? ` · ${start}–${end}${ev.endEstimated ? '*' : ''}`
                    : ` ${start} – ${formatDay(ev.endAt, ev.timezone, lang)} ${end}`}
              </strong>
            </div>
          </li>
          {ev.venue && (
            <li>
              <Icon name="pin" />
              <div>
                <strong>
                  {ev.venue.name}
                  {ev.venue.address && <span className="facts__addr"> · {ev.venue.address}</span>}
                </strong>
                <span className="facts__sub">
                  {distance} · {walk}
                </span>
              </div>
            </li>
          )}
          {price && (
            <li>
              <Icon name="wallet" />
              <div>
                <strong>{price}</strong>
              </div>
            </li>
          )}
        </ul>

        {/* The answer sits under when and where. A private event is answered through its
            invitation, and its guests see each other by name: no "I'm going" button, no friends'
            switch. */}
        {priv && (
          <PrivatePanel
            part="main"
            ev={ev}
            center={center}
            onToast={setToast}
            onGone={onClose}
            onChanged={onChanged}
          />
        )}
        {!ended && (!priv || ev.mine || ev.invitation?.status === 'accepted') && (
          <Going ev={ev} now={now} answer={!priv} />
        )}
        {!ended && !priv && <FriendsLine eventId={ev.id} />}
        <div className="event-card__actions">
          <GoButtons ev={ev} onGo={onGo} />
        </div>
        <div className="event-card__actions event-card__actions--links">
          {ev.ticketUrl && (
            <a className="btn" href={ev.ticketUrl} target="_blank" rel="noreferrer">
              <Icon name="ticket" size={16} /> {t('event.tickets')}
            </a>
          )}
          {ev.officialUrl && (
            <a className="btn" href={ev.officialUrl} target="_blank" rel="noreferrer">
              <Icon name="globe" size={16} /> {t('event.website')}
            </a>
          )}
        </div>
        <div className="detail__tools">
          <button type="button" className="tool" onClick={() => downloadIcs(ev, url)}>
            <Icon name="calendar" />
            {t('event.addToCalendar')}
          </button>
          {/* A private event is never shared by link, QR or image. */}
          {!priv && (
            <button type="button" className="tool" onClick={() => setSharing(true)}>
              <Icon name="share" />
              {t('event.share')}
            </button>
          )}
          <button type="button" className="tool" aria-pressed={saved} onClick={onToggleSave}>
            <Icon name="bookmark" filled={saved} />
            {saved ? t('event.saved') : t('event.save')}
          </button>
          {saved && Date.parse(ev.startAt) > now.getTime() && (
            <button
              type="button"
              className="tool"
              aria-pressed={!!reminder}
              onClick={() => setReminding(true)}
            >
              <Icon name="bell" filled={!!reminder} />
              {reminder ? leadLabel(reminder) : t('reminder.bell')}
            </button>
          )}
        </div>
        {reminding && <ReminderSheet ev={ev} onClose={() => setReminding(false)} />}
        {/* Yours (saved, or an invitation you took): its updates can reach you as notifications. */}
        {!ended && (saved || (priv && ev.invitation?.status === 'accepted')) && (
          <NotifyHint onToast={setToast} />
        )}

        {ended && !priv && <NearbyNow ev={ev} now={now} load={loadNearby} onOpen={onOpenEvent} />}
        {ev.description && (
          <section className="detail__section">
            <h2>{t('event.about')}</h2>
            <p>{ev.description}</p>
          </section>
        )}
        {hasRules(ev) && (
          <section className="detail__section">
            <h2>{t('event.rules')}</h2>
            <RuleList ev={ev} />
          </section>
        )}
        {ev.endEstimated && <p className="footnote">* {t('event.endEstimated')}</p>}

        {/* What the organiser sets, last: posting, editing, invitations, handing over. */}
        {(organiser.tools || ownerTools) && (
          <section className="detail__settings">
            <h2>{t('event.settings')}</h2>
            {organiser.tools}
            {ownerTools && (
              <PrivatePanel
                part="settings"
                ev={ev}
                center={center}
                onToast={setToast}
                onGone={onClose}
                onChanged={onChanged}
              />
            )}
          </section>
        )}

        {credit && (
          <p className="detail__credit">
            {credit.level
              ? t('event.addedByLevel', { name: credit.name, level: t(levelKey(credit.level)) })
              : t('event.addedBy', { name: credit.name })}
          </p>
        )}
        <p className="detail__source">
          {t('event.verified', {
            source,
            ago: formatAgo(ev.lastSeenAt, now, lang, t('time.justNow')),
          })}
          {ev.sourceUrl && (
            <>
              {' · '}
              <a href={ev.sourceUrl} target="_blank" rel="noreferrer">
                {t('event.sourcePage')}
              </a>
            </>
          )}
          {ev.venue?.website && (
            <>
              {' · '}
              <a href={ev.venue.website} target="_blank" rel="noreferrer">
                {t('event.venueWebsite')}
              </a>
            </>
          )}
        </p>
        <button type="button" className="report-link" onClick={() => setReporting(true)}>
          <Icon name="flag" size={16} /> {t('event.report')}
        </button>
      </div>
      {sharing && (
        <ShareSheet ev={ev} url={url} onClose={() => setSharing(false)} onToast={setToast} />
      )}
      {reporting && (
        <ReportDialog
          eventId={ev.id}
          onClose={() => setReporting(false)}
          onSent={(reason) => {
            setReporting(false);
            track('Report', { reason });
            const status = (FLAG_REASONS as readonly string[]).includes(reason);
            if (status) onReported(ev.id, reason as FlagReason);
            setToast(t(status ? 'report.thanksFlag' : 'report.thanks'));
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Who added a community event, when they chose to show it; nothing for other events. */
function useCredit(ev: NearbyEvent, load: Props['loadCredit']): Credit | null {
  const [credit, setCredit] = useState<Credit | null>(null);
  const community = ev.trust === 'community';
  useEffect(() => {
    setCredit(null);
    if (!community) return;
    const ctrl = new AbortController();
    load(ev.id, ctrl.signal).then(
      (c) => !ctrl.signal.aborted && setCredit(c),
      () => {}, // a missing credit is the same as none
    );
    return () => ctrl.abort();
  }, [ev.id, community, load]);
  return credit;
}
