import { isoWeekday } from '@happow/core';

/**
 * Regular services at places of worship (M12 §2.3): OSM's `service_times` tag, which uses the
 * `opening_hours` grammar, read as a weekly pattern. Only the plain part of that grammar is read:
 * weekdays and day ranges ("Mo-Sa", "Su,We"), then start times or time ranges
 * ("08:00,10:00", "18:00-19:00"). A rule with months, weeks, holidays only, "off" or a comment is
 * skipped rather than guessed; the rest of the tag still counts.
 */

export interface ServiceRule {
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  times: { start: string; end: string | null }[];
}

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const pad = (t: string) => t.padStart(5, '0');

function dayList(selector: string): number[] | null {
  const days = new Set<number>();
  let any = false;
  for (const part of selector.split(',')) {
    // Public and school holidays: no calendar of them here, so they add nothing.
    if (part === 'PH' || part === 'SH') {
      any = true;
      continue;
    }
    const range = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(part);
    if (!range) return null;
    const from = DAYS.indexOf(range[1]!);
    const to = DAYS.indexOf(range[2] ?? range[1]!);
    if (from < 0 || to < 0) return null;
    // "Sa-Mo" wraps over the week's end.
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d + 1);
      if (d === to) break;
    }
    any = true;
  }
  return any ? [...days].sort() : null;
}

/** Parses a `service_times` value; `skipped` counts the rules left out. */
export function parseServiceTimes(tag: string): { rules: ServiceRule[]; skipped: number } {
  const rules: ServiceRule[] = [];
  let skipped = 0;
  for (const raw of tag.split(/;|\|\|/)) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = /^(?:([A-Za-z,-]+)\s+)?([\d:,\s-]+)$/.exec(rule);
    const days = m ? (m[1] ? dayList(m[1]) : [1, 2, 3, 4, 5, 6, 7]) : null;
    const times = m
      ? m[2]!
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => {
            const [start, end] = t.split('-').map((x) => x.trim());
            return start && TIME.test(start) && (!end || TIME.test(end))
              ? { start: pad(start), end: end ? pad(end) : null }
              : null;
          })
      : [];
    if (!days || !days.length || !times.length || times.some((t) => !t)) {
      skipped++;
      continue;
    }
    rules.push({ days, times: times as ServiceRule['times'] });
  }
  return { rules, skipped };
}

/**
 * Wall-clock starts and ends ("2026-11-01T08:00") of the pattern for `days` days from `today`
 * ("YYYY-MM-DD"), earliest first. An end before its start runs past midnight.
 */
export function serviceDates(
  rules: ServiceRule[],
  today: string,
  days: number,
): { start: string; end: string | null }[] {
  const out: { start: string; end: string | null }[] = [];
  const first = Date.parse(`${today}T00:00:00Z`);
  for (let n = 0; n < days; n++) {
    const day = new Date(first + n * 86_400_000).toISOString().slice(0, 10);
    const weekday = isoWeekday(day);
    for (const r of rules) {
      if (!r.days.includes(weekday)) continue;
      for (const t of r.times) {
        const next = new Date(first + (n + 1) * 86_400_000).toISOString().slice(0, 10);
        out.push({
          start: `${day}T${t.start}`,
          end: t.end ? `${t.end > t.start ? day : next}T${t.end}` : null,
        });
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
