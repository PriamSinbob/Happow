import type { HappowEvent, LatLng, NearbyEvent } from './types.js';
import { distanceM } from './geo.js';

const FALLBACK_DURATION_MIN = 120;

/** End time for an event: the source value, or start + the longest default duration of its categories. */
export function resolveEnd(
  startAt: Date,
  endAt: Date | null,
  categoryIds: string[],
  defaultDurationMin: (categoryId: string) => number | undefined,
): { endAt: Date; endEstimated: boolean } {
  if (endAt) return { endAt, endEstimated: false };
  const durations = categoryIds.map(defaultDurationMin).filter((d): d is number => d !== undefined);
  const minutes = durations.length ? Math.max(...durations) : FALLBACK_DURATION_MIN;
  return { endAt: new Date(startAt.getTime() + minutes * 60_000), endEstimated: true };
}

/** True when the event overlaps [from, to]. */
export function overlaps(
  event: Pick<HappowEvent, 'startAt' | 'endAt'>,
  from: Date,
  to: Date,
): boolean {
  return new Date(event.startAt) <= to && new Date(event.endAt) >= from;
}

/** "Now" in the brief's sense: start ≤ now ≤ end. */
export function isRunning(event: Pick<HappowEvent, 'startAt' | 'endAt'>, now: Date): boolean {
  return new Date(event.startAt) <= now && now <= new Date(event.endAt);
}

/** Attach distances, keep those within the radius, sort by distance then start time. */
export function nearby<T extends HappowEvent>(
  events: T[],
  center: LatLng,
  radiusM: number,
): (T & NearbyEvent)[] {
  return events
    .map((e) => ({ ...e, distanceM: distanceM(center, e.point) }))
    .filter((e) => e.distanceM <= radiusM)
    .sort(compareByDistanceThenStart);
}

export function compareByDistanceThenStart(
  a: Pick<NearbyEvent, 'distanceM' | 'startAt'>,
  b: Pick<NearbyEvent, 'distanceM' | 'startAt'>,
): number {
  // Bucket distances to 10 m so two events at the same venue order by start time.
  const d = Math.round(a.distanceM / 10) - Math.round(b.distanceM / 10);
  return d !== 0 ? d : new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
}
