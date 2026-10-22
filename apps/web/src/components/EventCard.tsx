import type { NearbyEvent } from '@happow/core';
import { useI18n, type MessageKey } from '../i18n';
import { CategoryIcon, FlagNotice, GoButtons, useEventText } from './EventMeta';
import { en as RULE_KEYS } from '../i18n/en';

const RULE_ICONS: Record<string, string> = {
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
  if (key === 'dress') return t('rule.dress', { value });
  return value;
}

type RuleFields = Pick<NearbyEvent, 'rules' | 'ageMin' | 'family'>;

/** Age limit, family mark and the source's free-text rules, one line each. */
function ruleItems(
  ev: RuleFields,
  t: (key: MessageKey, params?: Record<string, string>) => string,
): { key: string; icon: string; text: string }[] {
  const items = [];
  if (ev.ageMin !== null)
    items.push({
      key: 'age',
      icon: ev.ageMin >= 18 ? '🔞' : '•',
      text: ev.ageMin === 0 ? t('rule.allAges') : t('rule.ageMin', { value: String(ev.ageMin) }),
    });
  if (ev.family) items.push({ key: 'family', icon: '👪', text: t('rule.family') });
  for (const [k, v] of Object.entries(ev.rules))
    if (v) items.push({ key: k, icon: RULE_ICONS[k] ?? '•', text: ruleText(t, k, v) });
  return items;
}

export function hasRules(ev: RuleFields): boolean {
  return ev.ageMin !== null || !!ev.family || Object.values(ev.rules).some(Boolean);
}

export function RuleList({ ev }: { ev: RuleFields }) {
  const { t } = useI18n();
  const items = ruleItems(ev, t);
  if (!items.length) return null;
  return (
    <ul className="rules">
      {items.map((i) => (
        <li key={i.key}>
          <span aria-hidden>{i.icon}</span> {i.text}
        </li>
      ))}
    </ul>
  );
}

export function EventCard({
  ev,
  now,
  onClose,
  onDetails,
  onGo,
}: {
  ev: NearbyEvent;
  now: Date;
  onClose: () => void;
  onDetails: () => void;
  /** Opens "Going there" (route inside the app). */
  onGo: () => void;
}) {
  const { t, lang } = useI18n();
  const { running, when, price, distance, walk, categories } = useEventText(ev, now);

  return (
    <article className="event-card" aria-labelledby={`ev-${ev.id}`}>
      <header className="event-card__head">
        <CategoryIcon ev={ev} size={44} />
        <div className="event-card__titles">
          <div className="event-card__cats">
            {categories.map((c) => c.labels[lang]).join(' · ')}
            <span className={`badge badge--${ev.trust}`}>{t(`event.source.${ev.trust}`)}</span>
            {ev.verified === false && (
              <span className="badge badge--unverified">{t('event.unverified')}</span>
            )}
          </div>
          <h2 id={`ev-${ev.id}`}>
            <button type="button" className="link-btn" onClick={onDetails}>
              {ev.title}
            </button>
          </h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('event.close')}>
          ✕
        </button>
      </header>

      <FlagNotice ev={ev} now={now} compact />
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
      <RuleList ev={ev} />
      {ev.endEstimated && <p className="footnote">* {t('event.endEstimated')}</p>}

      <div className="event-card__actions">
        <GoButtons ev={ev} onGo={onGo} />
        <button type="button" className="btn" onClick={onDetails}>
          {t('event.details')}
        </button>
      </div>
    </article>
  );
}
