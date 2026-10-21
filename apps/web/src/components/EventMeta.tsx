import { isRunning, walkingMinutes, type NearbyEvent } from '@happow/core';
import { categoriesById, config } from '../config';
import { formatAgo, formatDistance, formatPrice, formatTime } from '../format';
import { useI18n } from '../i18n';

export function useEventText(ev: NearbyEvent, now: Date) {
  const { t, lang } = useI18n();
  const running = isRunning(ev, now);
  const start = formatTime(ev.startAt, ev.timezone, lang);
  const end = formatTime(ev.endAt, ev.timezone, lang);
  const minutesToStart = Math.round((new Date(ev.startAt).getTime() - now.getTime()) / 60_000);
  const when = running
    ? `${t('event.until', { time: end })}${ev.endEstimated ? '*' : ''}`
    : minutesToStart <= 90
      ? `${t('event.startsAt', { time: start })} · ${t('event.startsIn', { minutes: minutesToStart })}`
      : `${start}–${end}${ev.endEstimated ? '*' : ''}`;
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
  const reported = t('flag.reported', {
    count: flag.count,
    ago: formatAgo(flag.at, now, lang, t('time.justNow')),
  });
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
