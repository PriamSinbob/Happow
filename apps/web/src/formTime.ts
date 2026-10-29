/**
 * Wall-clock values of the add form ("2026-11-07T19:30", as <input type="datetime-local"> holds
 * them, in the region's time zone) for quick add and add again (M12 §4.3, §4.4).
 */

/** Now in `timeZone`, rounded down to `roundMin` minutes. */
export function nowInput(timeZone: string, roundMin: number, at = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const minute = Math.floor(Number(p.minute) / roundMin) * roundMin;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${String(minute).padStart(2, '0')}`;
}

const asUtc = (value: string) => Date.parse(`${value}:00Z`);

/** `value` moved by `minutes` on the clock. */
export function shiftInput(value: string, minutes: number): string {
  return new Date(asUtc(value) + minutes * 60_000).toISOString().slice(0, 16);
}

/** Minutes from `start` to `end` on the clock; null when either is missing or invalid. */
export function minutesBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const m = (asUtc(end) - asUtc(start)) / 60_000;
  return Number.isFinite(m) && m > 0 ? m : null;
}
