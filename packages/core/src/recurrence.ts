/**
 * Weekly repeats for the add form (M12 §4.5). Wall-clock values ("2026-11-07T19:00", the form's
 * own format, in the region's time zone): the server turns each date into an instant on its own,
 * so 19:00 stays 19:00 across a change of clocks.
 */

export interface WeeklyRepeat {
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  days: number[];
  /** The last day it may happen on, "YYYY-MM-DD", inclusive. */
  until: string;
}

const DAY_MS = 86_400_000;
const dayOf = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`);

/** ISO weekday (1 = Monday) of a wall-clock value or a date. */
export function isoWeekday(value: string): number {
  return ((new Date(dayOf(value)).getUTCDay() + 6) % 7) + 1;
}

/** The latest "until" a repeat may have: `maxWeeks` weeks after the start's day. */
export function lastRepeatDay(start: string, maxWeeks: number): string {
  return new Date(dayOf(start) + maxWeeks * 7 * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The starts of a weekly repeat, earliest first: every chosen weekday from the start's day
 * through `until` (no later than `maxWeeks` weeks on), each at the start's time.
 */
export function weeklyStarts(start: string, repeat: WeeklyRepeat, maxWeeks: number): string[] {
  const time = start.slice(10);
  const last = Math.min(dayOf(repeat.until), dayOf(lastRepeatDay(start, maxWeeks)));
  const days = new Set(repeat.days);
  const out: string[] = [];
  for (let d = dayOf(start); d <= last; d += DAY_MS) {
    const day = new Date(d).toISOString().slice(0, 10);
    if (days.has(isoWeekday(day))) out.push(`${day}${time}`);
  }
  return out;
}

const wallMs = (value: string) => Date.parse(`${value}:00Z`);

/** A wall-clock value moved by `minutes` on the clock. */
export function shiftWall(value: string, minutes: number): string {
  return new Date(wallMs(value) + minutes * 60_000).toISOString().slice(0, 16);
}

/** Minutes from one wall-clock value to another. */
export function wallMinutes(start: string, end: string): number {
  return (wallMs(end) - wallMs(start)) / 60_000;
}
