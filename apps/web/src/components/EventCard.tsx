import type { NearbyEvent } from '@happow/core';
import { navigationUrl } from '../format';
import { useI18n, type MessageKey } from '../i18n';
import { CategoryIcon, useEventText } from './EventMeta';
import { en as RULE_KEYS } from '../i18n/en';

const RULE_ICONS: Record<string, string> = {
  age: '🔞',
  pets: '🐾',
  accessibility: '♿',
  dress: '👔',
};

/** Known rule values get a translated label; free text from sources is shown as is. */
function ruleText(
  t: (key: MessageKey, params?: Record<string, string>) => string,
  key: string,
  value: string,
): string {
  const exact = `rule.${key}.${value}`;
  if (exact in RULE_KEYS) return t(exact as MessageKey);
  if (key === 'age' || key === 'dress') return t(`rule.${key}`, { value });
  return value;
}

export function EventCard({
  ev,
  now,
  onClose,
}: {
  ev: NearbyEvent;
  now: Date;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const { running, when, price, distance, walk, categories } = useEventText(ev, now);
  const rules = Object.entries(ev.rules).filter(([, v]) => v);

  return (
    <article className="event-card" aria-labelledby={`ev-${ev.id}`}>
      <header className="event-card__head">
        <CategoryIcon ev={ev} size={44} />
        <div className="event-card__titles">
          <div className="event-card__cats">
            {categories.map((c) => c.labels[lang]).join(' · ')}
            <span className={`badge badge--${ev.trust}`}>{t(`event.source.${ev.trust}`)}</span>
          </div>
          <h2 id={`ev-${ev.id}`}>{ev.title}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('event.close')}>
          ✕
        </button>
      </header>

      <p className="event-card__when">
        {running && <span className="now-pill">{t('event.now')}</span>}
        {when}
        {price && <span className="event-card__price">{price}</span>}
      </p>
      {ev.venue && (
        <p className="event-card__venue">
          <strong>{ev.venue.name}</strong>
          {ev.venue.address && <span> · {ev.venue.address}</span>}
        </p>
      )}
      <p className="event-card__distance">
        {distance} · {walk}
      </p>
      {ev.description && <p className="event-card__desc">{ev.description}</p>}
      {rules.length > 0 && (
        <ul className="rules">
          {rules.map(([k, v]) => (
            <li key={k}>
              <span aria-hidden>{RULE_ICONS[k] ?? '•'}</span> {ruleText(t, k, v!)}
            </li>
          ))}
        </ul>
      )}
      {ev.endEstimated && <p className="footnote">* {t('event.endEstimated')}</p>}

      <div className="event-card__actions">
        <a
          className="btn btn--primary"
          href={navigationUrl(ev.point.lat, ev.point.lng)}
          target="_blank"
          rel="noreferrer"
        >
          {t('event.navigate')}
        </a>
        {ev.ticketUrl && (
          <a className="btn" href={ev.ticketUrl} target="_blank" rel="noreferrer">
            {t('event.tickets')}
          </a>
        )}
        {ev.officialUrl && (
          <a className="btn" href={ev.officialUrl} target="_blank" rel="noreferrer">
            {t('event.website')}
          </a>
        )}
      </div>
    </article>
  );
}
