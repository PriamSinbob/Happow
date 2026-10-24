/** Start and end of the calendar day containing `now`, in the given IANA timezone. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  return daysBounds(now, timeZone, 1);
}

/**
 * Start of today and end of the `days`-th calendar day from today ("week" = 7 days), in the given
 * IANA timezone. Days are counted on the calendar, so a 23- or 25-hour DST day still ends at
 * local midnight.
 */
export function daysBounds(now: Date, timeZone: string, days: number): { start: Date; end: Date } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const start = zonedMidnight(Number(parts.year), Number(parts.month), Number(parts.day), timeZone);
  const next = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days),
  );
  const end = zonedMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, end: new Date(end.getTime() - 1) };
}

function offsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function zonedMidnight(y: number, m: number, d: number, timeZone: string): Date {
  return zonedTime(y, m, d, 0, 0, timeZone);
}

/** The instant a wall-clock time in `timeZone` refers to. */
export function zonedTime(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Re-evaluate once in case the time sits across a DST change.
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** "2026-10-20" + optional "19:30:00" in `timeZone` → instant. Null when the date is malformed. */
export function localToInstant(date: string, time: string | null, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dm) return null;
  const tm = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  return zonedTime(+dm[1]!, +dm[2]!, +dm[3]!, tm ? +tm[1]! : 0, tm ? +tm[2]! : 0, timeZone);
}

/**
 * The first instant after a local calendar day ("2026-12-31"): midnight after it in `timeZone`,
 * so something that lasts "through" that day ends there. Null when the date is malformed.
 */
export function afterDay(day: string, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!dm) return null;
  // Date.UTC rolls 32 December over to 1 January, so day + 1 needs no calendar of its own.
  return zonedTime(+dm[1]!, +dm[2]!, +dm[3]! + 1, 0, 0, timeZone);
}
