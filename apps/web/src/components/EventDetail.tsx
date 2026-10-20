import { useEffect, useRef, useState } from 'react';
import type { NearbyEvent } from '@happow/core';
import { config } from '../config';
import { formatAgo, formatDay, formatTime, isSameDay, navigationUrl } from '../format';
import { eventUrl } from '../hooks/useHashRoute';
import { downloadIcs } from '../ics';
import { useI18n } from '../i18n';
import { CategoryIcon, useEventText } from './EventMeta';
import { RuleList } from './EventCard';
import { Icon } from './Icons';

const sourceNames = new Map(config.sources.map((s) => [s.id, s.name]));

interface Props {
  ev: NearbyEvent | null;
  loading: boolean;
  now: Date;
  saved: boolean;
  onToggleSave: () => void;
  onClose: () => void;
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

export function EventDetail({ ev, loading, now, saved, onToggleSave, onClose }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);

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
        <DetailBody ev={ev} now={now} saved={saved} onToggleSave={onToggleSave} />
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
}: {
  ev: NearbyEvent;
  now: Date;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const { t, lang } = useI18n();
  const { running, price, distance, walk, categories } = useEventText(ev, now);
  const [toast, setToast] = useState<string | null>(null);
  const url = eventUrl(ev.id);
  const ended = new Date(ev.endAt) < now;
  const dayLong = isDayLong(ev);
  const start = formatTime(ev.startAt, ev.timezone, lang);
  const end = formatTime(ev.endAt, ev.timezone, lang);
  const sameDay = isSameDay(ev.startAt, new Date(new Date(ev.endAt).getTime() - 1), ev.timezone);
  const minutesToStart = Math.round((new Date(ev.startAt).getTime() - now.getTime()) / 60_000);
  const cat = categories[0];
  const source = (ev.sourceId && sourceNames.get(ev.sourceId)) || t(`event.source.${ev.trust}`);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  async function share() {
    const data = { title: ev.title, text: `${ev.title} · ${ev.venue?.name ?? ''}`.trim(), url };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(url);
        setToast(t('event.linkCopied'));
      }
    } catch {
      /* the user dismissed the share sheet */
    }
  }

  return (
    <div className="detail__scroll">
      <div
        className={`detail__hero${ev.imageUrl ? ' has-image' : ''}`}
        style={{ ['--cat' as string]: cat?.color ?? '#475569' }}
      >
        {ev.imageUrl ? (
          <img src={ev.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="detail__hero-icon" aria-hidden>
            {cat?.icon ?? '📍'}
          </span>
        )}
      </div>

      <div className="detail__body">
        <div className="event-card__cats">
          {categories.map((c) => c.labels[lang]).join(' · ')}
          <span className={`badge badge--${ev.trust}`}>{t(`event.source.${ev.trust}`)}</span>
        </div>
        <h1 id="detail-title">{ev.title}</h1>

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
          <a
            className="btn btn--primary"
            href={navigationUrl(ev.point.lat, ev.point.lng)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="navigate" size={16} /> {t('event.navigate')}
          </a>
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
          <button type="button" className="tool" onClick={share}>
            <Icon name="share" />
            {t('event.share')}
          </button>
          <button type="button" className="tool" aria-pressed={saved} onClick={onToggleSave}>
            <Icon name="bookmark" filled={saved} />
            {saved ? t('event.saved') : t('event.save')}
          </button>
        </div>

        {ev.description && (
          <section className="detail__section">
            <h2>{t('event.about')}</h2>
            <p>{ev.description}</p>
          </section>
        )}
        {Object.values(ev.rules).some(Boolean) && (
          <section className="detail__section">
            <h2>{t('event.rules')}</h2>
            <RuleList rules={ev.rules} />
          </section>
        )}
        {ev.endEstimated && <p className="footnote">* {t('event.endEstimated')}</p>}

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
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
