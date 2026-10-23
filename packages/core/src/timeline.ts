import { daysBounds } from './time.js';
import type { HappowEvent } from './types.js';

type Span = Pick<HappowEvent, 'startAt' | 'endAt'>;

const MIN = 60_000;

/* ---------- Reach rail (§5) ---------- */

/** Rail position 0 (bottom, first detent) … 1 (top, last detent) → metres, on a log scale. */
export function railToRadius(p: number, detentsM: readonly number[]): number {
  const lo = detentsM[0]!;
  const hi = detentsM[detentsM.length - 1]!;
  return lo * Math.pow(hi / lo, Math.min(1, Math.max(0, p)));
}

/** Metres → rail position; beyond the last detent (city mode) stays at the top. */
export function radiusToRail(radiusM: number, detentsM: readonly number[]): number {
  const lo = detentsM[0]!;
  const hi = detentsM[detentsM.length - 1]!;
  const r = Math.min(hi, Math.max(lo, radiusM));
  return Math.log(r / lo) / Math.log(hi / lo);
}

/** The detent closest on the log scale (the rail snaps there on release). */
export function nearestDetent(radiusM: number, detentsM: readonly number[]): number {
  return detentsM.reduce((best, d) =>
    Math.abs(Math.log(radiusM / d)) < Math.abs(Math.log(radiusM / best)) ? d : best,
  );
}

/** Reach as people think of it: walking minutes up to `walkMaxM`, then whole km. */
export type ReachLabel = { kind: 'min'; value: number } | { kind: 'km'; value: number };

export function reachLabel(
  radiusM: number,
  walkingSpeedMPerMin: number,
  walkMaxM = 2000,
): ReachLabel {
  if (radiusM <= walkMaxM)
    return { kind: 'min', value: Math.max(1, Math.round(radiusM / walkingSpeedMPerMin)) };
  return { kind: 'km', value: Math.round(radiusM / 1000) };
}

/* ---------- Time line (§5, §13.3) ---------- */

/**
 * A dragged time on the Today line: never before now or past the end, back to now when within
 * `snapNowMin`, otherwise on a `stepMin` grid (whole minutes of the clock).
 */
export function snapTime(
  t: Date,
  now: Date,
  end: Date,
  opts: { snapNowMin: number; stepMin: number },
): Date {
  const ms = Math.min(end.getTime(), Math.max(now.getTime(), t.getTime()));
  if (ms - now.getTime() < opts.snapNowMin * MIN) return now;
  const step = opts.stepMin * MIN;
  return new Date(Math.min(end.getTime(), Math.round(ms / step) * step));
}

/** Events running at the middle of each `binMin` bin from `from` to `to` (the Today histogram). */
export function timeBins(events: readonly Span[], from: Date, to: Date, binMin: number): number[] {
  const bins: number[] = [];
  const step = binMin * MIN;
  for (let at = from.getTime(); at < to.getTime(); at += step) {
    const mid = Math.min(at + step / 2, to.getTime());
    bins.push(
      events.filter((e) => Date.parse(e.startAt) <= mid && Date.parse(e.endAt) > mid).length,
    );
  }
  return bins;
}

/**
 * Local midnights from the start of today to the end of the `days`-th day: days + 1 instants.
 * Calendar days, so the 25 Oct DST day is 25 hours long.
 */
export function dayStarts(now: Date, timeZone: string, days: number): Date[] {
  const out = [daysBounds(now, timeZone, 1).start];
  for (let k = 1; k <= days; k++)
    out.push(new Date(daysBounds(now, timeZone, k).end.getTime() + 1));
  return out;
}

/** Index of the day an instant falls in, or -1 outside the range. */
export function dayIndex(at: Date, starts: readonly Date[]): number {
  const t = at.getTime();
  for (let i = 0; i < starts.length - 1; i++)
    if (t >= starts[i]!.getTime() && t < starts[i + 1]!.getTime()) return i;
  return -1;
}

/**
 * Whether an event is on the day [from, to): it starts that day, or it started earlier and runs at
 * least `carryOverMin` into it. A festival counts on every day; a show from 22:15 to 0:15 only on
 * the day it starts.
 */
export function isOnDay(event: Span, from: Date, to: Date, carryOverMin: number): boolean {
  const s = Date.parse(event.startAt);
  const e = Date.parse(event.endAt);
  if (s >= to.getTime() || e <= from.getTime()) return false;
  return s >= from.getTime() || e - from.getTime() >= carryOverMin * MIN;
}

/** Events on each day (see `isOnDay`); today counts only what is not over yet. */
export function dayBins(
  events: readonly Span[],
  starts: readonly Date[],
  now: Date,
  carryOverMin: number,
): number[] {
  return starts.slice(0, -1).map((s, i) => {
    const from = new Date(Math.max(s.getTime(), now.getTime()));
    return events.filter((e) => isOnDay(e, from, starts[i + 1]!, carryOverMin)).length;
  });
}

/* ---------- Edge dots (§5) ---------- */

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where an off-screen point shows as an edge dot: on the rectangle's border, along the line from
 * `from` (the reach centre on screen). Null when the point is already inside.
 */
export function clampToEdge(
  p: { x: number; y: number },
  from: { x: number; y: number },
  rect: ScreenRect,
): { x: number; y: number } | null {
  if (p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) return null;
  const c = {
    x: Math.min(rect.right, Math.max(rect.left, from.x)),
    y: Math.min(rect.bottom, Math.max(rect.top, from.y)),
  };
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const f = Math.min(
    dx > 0 ? (rect.right - c.x) / dx : dx < 0 ? (rect.left - c.x) / dx : Infinity,
    dy > 0 ? (rect.bottom - c.y) / dy : dy < 0 ? (rect.top - c.y) / dy : Infinity,
  );
  return { x: c.x + dx * f, y: c.y + dy * f };
}
