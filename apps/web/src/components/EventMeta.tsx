import { isRunning, SOURCE_MISSING, walkingMinutes, type NearbyEvent } from '@happow/core';
import { track } from '../analytics';
import { categoriesById, config } from '../config';
import {
  formatAgo,
  formatDistance,
  formatPrice,
  formatRelativeDay,
  formatTime,
  isSameDay,
  navigationUrl,
} from '../format';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

const sourceNames = new Map(config.sources.map((s) => [s.id, s.name]));

export function useEventText(ev: NearbyEvent, now: Date) {
  const { t, lang } = useI18n();
  const running = isRunning(ev, now);
  const start = formatTime(ev.startAt, ev.timezone, lang);
  const end = formatTime(ev.endAt, ev.timezone, lang);
  const minutesToStart = Math.round((new Date(ev.startAt).getTime() - now.getTime()) / 60_000);
  // The day is always named for later starts, and for the others once it is not today (at night
  // "until 01:00" or "at 00:30" is otherwise ambiguous).
  const day = (iso: string) => formatRelativeDay(iso, now, ev.timezone, lang);
  const notToday = (iso: string) => (isSameDay(iso, now, ev.timezone) ? '' : `${day(iso)} `);
  const when = running
    ? `${t('event.until', { time: `${notToday(ev.endAt)}${end}` })}${ev.endEstimated ? '*' : ''}`
    : minutesToStart <= 90
      ? `${notToday(ev.startAt)}${t('event.startsAt', { time: start })} · ${t('event.startsIn', { minutes: minutesToStart })}`
      : `${day(ev.startAt)}, ${start}–${end}${ev.endEstimated ? '*' : ''}`;
  const price = ev.isFree
    ? t('event.free')
    : ev.priceMin !== null
      ? ev.priceMax !== null && ev.priceMax !== ev.priceMin
        ? t('event.price', { price: formatPrice(ev.priceMin, ev.currency, lang) })
        : formatPrice(ev.priceMin, ev.currency, lang)
      : null;
  const distance = formatDistance(ev.distanceM, lang);
  const walk = t('event.walk', {
    minutes: walkingMinutes(ev.distanceM, config.app.walkingSpeedMPerMin),
  });
  const categories = ev.categoryIds
    .map((id) => categoriesById.get(id))
    .filter((c) => c !== undefined);
  return { running, when, price, distance, walk, categories };
}

export function CategoryIcon({ ev, size = 40 }: { ev: NearbyEvent; size?: number }) {
  const cat = categoriesById.get(ev.categoryIds[0]!);
  return (
    <span
      className="cat-icon"
      style={{ ['--cat' as string]: cat?.color ?? '#475569', width: size, height: size }}
      aria-hidden
    >
      {cat?.icon ?? '📍'}
    </span>
  );
}

/** Community warning ("venue reported closed · 2 people · 10 min ago"); null when there is none. */
export function FlagNotice({
  ev,
  now,
  compact = false,
}: {
  ev: NearbyEvent;
  now: Date;
  compact?: boolean;
}) {
  const { t, lang } = useI18n();
  const flag = ev.flag;
  if (!flag) return null;
  const ago = formatAgo(flag.at, now, lang, t('time.justNow'));
  const reported =
    flag.reason === SOURCE_MISSING
      ? t('flag.sourceMissing', {
          source: (ev.sourceId && sourceNames.get(ev.sourceId)) || t(`event.source.${ev.trust}`),
          ago,
        })
      : t('flag.reported', { count: flag.count, ago });
  if (compact)
    return (
      <p className="flag-line" role="status">
        <span aria-hidden>⚠</span> <strong>{t(`flag.reason.${flag.reason}`)}</strong> · {reported}
      </p>
    );
  return (
    <div className="flag-banner" role="status">
      <span className="flag-banner__icon" aria-hidden>
        ⚠
      </span>
      <div>
        <strong>{t(`flag.reason.${flag.reason}`)}</strong>
        <span className="flag-banner__meta">{reported}</span>
        <span className="flag-banner__note">{t('flag.unconfirmed')}</span>
      </div>
    </div>
  );
}

/**
 * Getting there: a small button for the route inside Happow (live location, event updates on the
 * way) and a wide one handing off to Google Maps, which most people prefer.
 */
export function GoButtons({ ev, onGo }: { ev: NearbyEvent; onGo: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        className="btn btn--square"
        onClick={() => {
          track('Directions', { via: 'happow' });
          onGo();
        }}
        aria-label={t('nav.inApp')}
        title={t('nav.inApp')}
      >
        <Icon name="navigate" size={18} />
      </button>
      <a
        className="btn btn--primary"
        href={navigationUrl(ev.point.lat, ev.point.lng)}
        target="_blank"
        rel="noreferrer"
        onClick={() => track('Directions', { via: 'google' })}
      >
        {t('nav.googleMaps')}
      </a>
    </>
  );
}
