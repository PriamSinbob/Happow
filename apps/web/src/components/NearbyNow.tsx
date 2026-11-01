import { isRunning, type LatLng, type NearbyEvent } from '@happow/core';
import { useEffect, useState } from 'react';
import { config } from '../config';
import { formatDistance, formatTime } from '../format';
import { useI18n } from '../i18n';
import { CategoryIcon } from './EventMeta';

/** Live, not cancelled, not this event; nearest to its place first, at most `max` (M9 §4). */
export function liveNearby(
  events: readonly NearbyEvent[],
  now: Date,
  exceptId: string,
  max: number,
): NearbyEvent[] {
  return events
    .filter((e) => e.id !== exceptId && e.status !== 'cancelled' && isRunning(e, now))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, max);
}

/**
 * Under an ended event's card: what's on now near that place, so an old shared link always leads
 * somewhere live. Uses the map's reach (the radius the person has set) around the event's place.
 */
export function NearbyNow({
  ev,
  now,
  load,
  onOpen,
}: {
  ev: NearbyEvent;
  now: Date;
  load: (at: LatLng, signal: AbortSignal) => Promise<NearbyEvent[]>;
  onOpen: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState<NearbyEvent[] | null>(null);
  const max = config.app.sharing.endedNearbyMax;
  const nowMinute = Math.floor(now.getTime() / 60_000);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ev.point, ctrl.signal)
      .then((all) => setEvents(liveNearby(all, new Date(nowMinute * 60_000), ev.id, max)))
      .catch(() => setEvents((prev) => prev ?? []));
    return () => ctrl.abort();
  }, [ev.id, ev.point, load, max, nowMinute]);

  if (!max) return null;
  return (
    <section className="detail__section nearby-now" aria-live="polite">
      <h2>{t('ended.nearbyTitle')}</h2>
      {events === null ? (
        <p className="nearby-now__empty">{t('event.loading')}</p>
      ) : events.length === 0 ? (
        <p className="nearby-now__empty">{t('ended.nearbyNone')}</p>
      ) : (
        <ul className="nearby-now__list">
          {events.map((e) => (
            <li key={e.id}>
              <button type="button" className="nearby-now__row" onClick={() => onOpen(e.id)}>
                <CategoryIcon ev={e} size={36} />
                <span className="nearby-now__text">
                  <strong>{e.title}</strong>
                  <span>
                    {formatDistance(e.distanceM, lang)} ·{' '}
                    {t('event.until', { time: formatTime(e.endAt, e.timezone, lang) })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
