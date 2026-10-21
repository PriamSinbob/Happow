import { localToInstant } from '@happow/core';

/**
 * An extracted ISO value → instant. Offsets are honoured; local date-times and bare dates are read
 * in the region's time zone (`allDay` marks a bare date).
 */
export function resolveInstant(
  value: string,
  timeZone: string,
): { at: Date; allDay: boolean } | null {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : { at: d, allDay: false };
  }
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value);
  if (!m) return null;
  const at = localToInstant(m[1]!, m[2] ?? null, timeZone);
  return at ? { at, allDay: !m[2] } : null;
}

/** "2026-10-24" → "2026-10-25". */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}
