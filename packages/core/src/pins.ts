import { arrivalAt, isLate } from './entry.js';
import { isRunning } from './events.js';
import type { AppConfig, Category, HappowEvent } from './types.js';

/** §4.1: on now, starts within the hour, or later. */
export type PinKind = 'live' | 'soon' | 'later';

/** Starts within this many minutes: a "soon" pin. */
export const SOON_MIN = 60;
/** Ring scale: full at two hours left or more, 12 steps of 10 minutes. */
export const RING_STEPS = 12;
const RING_STEP_MIN = 10;

export interface PinState {
  kind: PinKind;
  /** Beyond the radius: smaller and faded. */
  outside: boolean;
  /** Arrival too late to be worth going (fixed: after start + grace; open: near the end). */
  late: boolean;
  /** Live pins: 1–12 ring steps of time left; null otherwise. */
  ring: number | null;
  /** No fixed end ("till late"): a dotted full ring. */
  dotted: boolean;
  /** symbol-sort-key: lower is placed first and wins collisions (live > soon > later). */
  sortKey: number;
}

/** Ring steps for the time left: full at ≥ 120 min, then 10-minute steps, a stub until the end. */
export function ringStep(event: Pick<HappowEvent, 'endAt'>, now: Date): number {
  const left = (new Date(event.endAt).getTime() - now.getTime()) / 60_000;
  return Math.max(1, Math.min(RING_STEPS, Math.floor(left / RING_STEP_MIN)));
}

export function pinState(
  event: Pick<
    HappowEvent,
    'startAt' | 'endAt' | 'endEstimated' | 'categoryIds' | 'entry' | 'graceMin'
  >,
  now: Date,
  distanceM: number,
  radiusM: number,
  categories: Category[],
  app: Pick<AppConfig, 'walkingSpeedMPerMin' | 'arrival'>,
): PinState {
  const start = new Date(event.startAt).getTime();
  const kind: PinKind = isRunning(event, now)
    ? 'live'
    : start > now.getTime() && start - now.getTime() <= SOON_MIN * 60_000
      ? 'soon'
      : 'later';
  const outside = distanceM > radiusM;
  const late = kind !== 'later' && isLate(event, arrivalAt(now, distanceM, app), categories, app);
  const live = kind === 'live';
  const rank = kind === 'live' ? 0 : kind === 'soon' ? 1 : 2;
  return {
    kind,
    outside,
    late,
    ring: live ? (event.endEstimated ? RING_STEPS : ringStep(event, now)) : null,
    dotted: live && event.endEstimated,
    sortKey: rank + (outside ? 3 : 0) + (late ? 0.5 : 0),
  };
}
