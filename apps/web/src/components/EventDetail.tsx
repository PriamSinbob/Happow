import { useEffect, useRef, useState } from 'react';
import { FLAG_REASONS, type FlagReason, type LatLng, type NearbyEvent } from '@happow/core';
import { track } from '../analytics';
import { config } from '../config';
import { formatAgo, formatDay, formatTime, isSameDay } from '../format';
import { eventUrl } from '../hooks/useHashRoute';
import { downloadIcs } from '../ics';
import { useI18n } from '../i18n';
import { CategoryIcon, FlagNotice, GoButtons, useEventText } from './EventMeta';
import { Going } from './Going';
import { InstallHint } from './InstallHint';
import { NearbyNow } from './NearbyNow';
import { ShareSheet } from './ShareSheet';
import { hasRules, RuleList } from './EventCard';
import { Glyph, Icon } from './Icons';
import { glyphOf } from '../pins';
import { ReportDialog } from './ReportDialog';
import { countEvent } from '../counts';
import type { Credit } from '../data/repository';
import { levelKey } from '../contributions';

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
  /** "Added by" for a community event, read live (M12 §5.5). */
  loadCredit: (eventId: string, signal: AbortSignal) => Promise<Credit | null>;
  /** Events around a place, for "on now nearby" under an ended event (M9 §4). */
  loadNearby: (at: LatLng, signal: AbortSignal) => Promise<NearbyEvent[]>;
  /** Opens another event's card in place of this one. */
  onOpenEvent: (id: string) => void;
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
}: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);

  // An open for its adder's "your impact" (M12 §5.1).
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
    <div
      ref={dialog}
      className="detail"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      tabIndex={-1}
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
        />
      ) : (
        <p className="detail__empty" id="detail-title" aria-live="polite">
          {loading ? t('event.loading') : t('event.notFound')}
        </p>
      )}
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
}: {
  ev: NearbyEvent;
  now: Date;
  saved: boolean;
  onToggleSave: () => void;
  onReported: Props['onReported'];
  onGo: () => void;
  loadCredit: Props['loadCredit'];
  loadNearby: Props['loadNearby'];
  onOpenEvent: Props['onOpenEvent'];
}) {
  const { t, lang } = useI18n();
  const credit = useCredit(ev, loadCredit);
  const { running, price, distance, walk, categories } = useEventText(ev, now);
  const [toast, setToast] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const url = eventUrl(ev.id);
  const ended = new Date(ev.endAt) < now;
  const dayLong = isDayLong(ev);
  const start = formatTime(ev.startAt, ev.timezone, lang);
  const end = formatTime(ev.endAt, ev.timezone, lang);
  const sameDay = isSameDay(ev.startAt, new Date(new Date(ev.endAt).getTime() - 1), ev.timezone);
  const minutesToStart = Math.round((new Date(ev.startAt).getTime() - now.getTime()) / 60_000);
  const source = (ev.sourceId && sourceNames.get(ev.sourceId)) || t(`event.source.${ev.trust}`);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div className="detail__scroll">
      <div className={`detail__hero${ev.imageUrl ? ' has-image' : ''}`}>
        {ev.imageUrl ? (
          <img src={ev.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="detail__hero-icon" aria-hidden>
            <Glyph id={glyphOf(ev)} size={64} strokeWidth={1.25} />
          </span>
        )}
      </div>

      <div className="detail__body">
        <div className="event-card__cats">
          {categories.map((c) => c.labels[lang]).join(' · ')}
          <span className={`badge badge--${ev.trust}`}>{t(`event.source.${ev.trust}`)}</span>
          {ev.verified === false && (
            <span className="badge badge--unverified">{t('event.unverified')}</span>
          )}
        </div>
        <h1 id="detail-title">{ev.title}</h1>
        <InstallHint />

        {ended && <p className="status-banner status-banner--ended">{t('ended.banner')}</p>}
        <FlagNotice ev={ev} now={now} />
        {ev.status !== 'scheduled' && (
          <p className={`status-banner status-banner--${ev.status}`}>{t(`event.${ev.status}`)}</p>
        )}

        <ul className="facts">
          <li>
            <Icon name="clock" />
            <div>
              <strong>
                {formatDay(ev.startAt, ev.timezone, lang)}
                {dayLong
                  ? ` · ${t('event.dayLong')}`
                  : sameDay
                    ? ` · ${start}–${end}${ev.endEstimated ? '*' : ''}`
                    : ` ${start} – ${formatDay(ev.endAt, ev.timezone, lang)} ${end}`}
              </strong>
              <span className="facts__sub">
                {running && <span className="now-pill">{t('event.now')}</span>}
                {running
                  ? t('event.until', { time: end })
                  : ended
                    ? t('event.ended')
                    : minutesToStart <= 180
                      ? t('event.startsIn', { minutes: minutesToStart })
                      : null}
              </span>
            </div>
          </li>
          {ev.venue && (
            <li>
              <Icon name="pin" />
              <div>
                <strong>{ev.venue.name}</strong>
                {ev.venue.address && <span className="facts__sub">{ev.venue.address}</span>}
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

        <div className="event-card__actions">
          <GoButtons ev={ev} onGo={onGo} />
        </div>
        {!ended && <Going ev={ev} now={now} />}
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
          <button type="button" className="tool" onClick={() => setSharing(true)}>
            <Icon name="share" />
            {t('event.share')}
          </button>
          <button type="button" className="tool" aria-pressed={saved} onClick={onToggleSave}>
            <Icon name="bookmark" filled={saved} />
            {saved ? t('event.saved') : t('event.save')}
          </button>
        </div>

        {ended && <NearbyNow ev={ev} now={now} load={loadNearby} onOpen={onOpenEvent} />}
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
