import type { Season } from './types.js';
import { localToInstant, zonedTime } from './time.js';

/**
 * Season collections and district goals (M12 §6.2–6.3): which events fit a season, which seasons
 * run now, and the weekend a district goal counts.
 */

/** Lower case without diacritics, so "Świąteczny" finds the keyword "swiateczn". */
export function plainText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .toLowerCase();
}

/** The instants a season covers in `timeZone`: from its first day's start to after its last. */
export function seasonSpan(season: Season, timeZone: string): { from: Date; to: Date } {
  const [y, m, d] = season.to.split('-').map(Number) as [number, number, number];
  return {
    from: localToInstant(season.from, null, timeZone)!,
    to: zonedTime(y, m, d + 1, 0, 0, timeZone),
  };
}

export interface SeasonCandidate {
  title: string;
  categoryIds: string[];
  startAt: string;
  endAt: string;
}

/** Overlaps the season's days, has one of its categories (if any) and a keyword (if any). */
export function fitsSeason(e: SeasonCandidate, season: Season, timeZone: string): boolean {
  const { from, to } = seasonSpan(season, timeZone);
  if (Date.parse(e.startAt) >= to.getTime() || Date.parse(e.endAt) <= from.getTime()) return false;
  if (season.categories.length && !e.categoryIds.some((c) => season.categories.includes(c)))
    return false;
  if (!season.keywords.length) return true;
  const title = plainText(e.title);
  return season.keywords.some((k) => title.includes(plainText(k)));
}

/** Seasons running at `now`, in config order. */
export function activeSeasons(seasons: Season[], now: Date, timeZone: string): Season[] {
  return seasons.filter((s) => {
    const { from, to } = seasonSpan(s, timeZone);
    return now >= from && now < to;
  });
}

/**
 * "This weekend" for a district goal: Saturday 00:00 to Monday 00:00 in `timeZone`; on the
 * weekend itself it starts now.
 */
export function weekendWindow(now: Date, timeZone: string): { from: Date; to: Date } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!) + 1;
  const [y, m, d] = [Number(p.year), Number(p.month), Number(p.day)];
  const saturday = d + (6 - weekday);
  const from = zonedTime(y, m, saturday, 0, 0, timeZone);
  const to = zonedTime(y, m, saturday + 2, 0, 0, timeZone);
  return { from: from < now ? now : from, to };
}
