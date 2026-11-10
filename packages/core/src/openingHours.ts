/**
 * OpenStreetMap `opening_hours`, the everyday part of it: weekday ranges with times
 * ("Mo-Fr 10:00-22:00; Sa,Su 12:00-02:00"), "24/7" and "off". Anything else (months, weeks,
 * sunrise, comments) makes the whole value unknown: a place shows only when it is known to be
 * open, so guessing would send someone to a closed door.
 */

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const DAY_MIN = 1440;

/** Open spans per weekday (0 = Monday), minutes from that day's midnight; an end may pass 1440. */
export type OpeningWeek = [number, number][][];

function parseDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [a, b, more] = part.trim().split('-');
    const from = DAYS.indexOf(a as (typeof DAYS)[number]);
    const to = b === undefined ? from : DAYS.indexOf(b as (typeof DAYS)[number]);
    if (from < 0 || to < 0 || more !== undefined) return null;
    // "Fr-Mo" wraps over the weekend.
    for (let d = from; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === to) break;
    }
  }
  return [...out];
}

function parseTimes(spec: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (start >= DAY_MIN || end > 2 * DAY_MIN || Number(m[2]) > 59 || Number(m[4]) > 59)
      return null;
    // "18:00-02:00" closes after midnight.
    if (end <= start) end += DAY_MIN;
    out.push([start, end]);
  }
  return out;
}

/** The week a value describes; null when it is empty or uses syntax this parser does not read. */
export function parseOpeningHours(value: string | null | undefined): OpeningWeek | null {
  const text = value?.trim();
  if (!text) return null;
  const week: OpeningWeek = DAYS.map(() => []);
  if (text === '24/7') return week.map(() => [[0, DAY_MIN]] as [number, number][]);
  let any = false;
  // "Mo-Fr 10:00-22:00, Sa 10:00-14:00": a comma after a time, before a weekday, starts a rule.
  const rules = text.replace(/(\d{2}|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, '$1;');
  for (const raw of rules.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    // Public-holiday rules say nothing about an ordinary day.
    if (/^(PH|SH)\b/.test(rule)) continue;
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)?\s*(.*)$/.exec(
      rule,
    );
    if (!m) return null;
    const days = m[1] ? parseDays(m[1].replace(/\s+/g, '')) : [0, 1, 2, 3, 4, 5, 6];
    const rest = m[2]!.trim();
    if (!days) return null;
    const spans = rest === 'off' || rest === 'closed' ? [] : parseTimes(rest);
    if (!spans) return null;
    // A later rule replaces an earlier one for the days it names.
    for (const d of days) week[d] = spans;
    any = true;
  }
  return any ? week : null;
}

const clock = (min: number) =>
  `${String(Math.floor((min % DAY_MIN) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * A week written as `opening_hours`, days with the same hours together ("Mo-Fr 10:00-22:00;
 * Sa,Su 12:00-02:00"); days without hours are left out, a week without any is "off".
 * `parseOpeningHours` reads it back to the same week.
 */
export function formatOpeningHours(week: OpeningWeek): string {
  const text = week.map((spans) =>
    spans
      .map(([s, e]) => (s === 0 && e === DAY_MIN ? '00:00-24:00' : `${clock(s)}-${clock(e)}`))
      .join(','),
  );
  if (text.every((t) => t === '00:00-24:00')) return '24/7';
  const rules: string[] = [];
  for (const hours of new Set(text.filter(Boolean))) {
    const days = text.flatMap((t, d) => (t === hours ? [d] : []));
    // Runs of days in a row: "Mo-Fr", "Sa,Su".
    const runs: number[][] = [];
    for (const d of days) {
      const run = runs[runs.length - 1];
      if (run && run[run.length - 1] === d - 1) run.push(d);
      else runs.push([d]);
    }
    const names = runs.map((r) =>
      r.length > 2 ? `${DAYS[r[0]!]}-${DAYS[r[r.length - 1]!]}` : r.map((d) => DAYS[d]).join(','),
    );
    rules.push(`${names.join(',')} ${hours}`);
  }
  return rules.length ? rules.join('; ') : 'off';
}

/** Monday-based weekday and minutes since local midnight of an instant in a time zone. */
function localMinute(at: Date, timeZone: string): { day: number; minute: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return {
    day: DAYS.indexOf(p.weekday!.slice(0, 2) as (typeof DAYS)[number]),
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

export type OpenState =
  | { open: false }
  /** `closesAt` is null for a place that never closes (24/7). */
  | { open: true; closesAt: Date | null };

/**
 * Whether the week is open at `at`, and until when: spans that meet (23:00–24:00, then 00:00 the
 * next day) count as one. Wall-clock minutes, so the hour of a DST change may be an hour off.
 */
export function openState(week: OpeningWeek, at: Date, timeZone: string): OpenState {
  const { day, minute } = localMinute(at, timeZone);
  // Minutes from this week's Monday midnight; yesterday's late span may still be running.
  const now = day * DAY_MIN + minute;
  const spans: [number, number][] = [];
  for (let w = -1; w <= 1; w++)
    for (let d = 0; d < 7; d++)
      for (const [s, e] of week[d]!)
        spans.push([(w * 7 + d) * DAY_MIN + s, (w * 7 + d) * DAY_MIN + e]);
  spans.sort((a, b) => a[0] - b[0]);
  let end: number | null = null;
  for (const [s, e] of spans) {
    if (end === null) {
      if (s <= now && now < e) end = e;
    } else if (s <= end) end = Math.max(end, e);
  }
  if (end === null) return { open: false };
  // Still open at the end of next week: it never closes.
  if (end >= 14 * DAY_MIN) return { open: true, closesAt: null };
  const floor = Math.floor(at.getTime() / 60_000) * 60_000;
  return { open: true, closesAt: new Date(floor + (end - now) * 60_000) };
}
