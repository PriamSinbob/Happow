import { zonedTime } from './time.js';
import type { AppConfig, Category, EntryType, HappowEvent } from './types.js';

type EntryFields = Pick<HappowEvent, 'categoryIds' | 'entry' | 'graceMin'>;

/**
 * Entry type and grace minutes of an event: its own values, else the defaults of its first
 * known category. Applied when read, so a config change reaches every stored event at once.
 */
export function entryOf(
  event: EntryFields,
  categories: Category[],
): { entry: EntryType; graceMin: number } {
  const own = event.categoryIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => !!c);
  const entry = event.entry ?? own[0]?.entry ?? 'open';
  // A per-event "fixed" on an open category takes the grace of a fixed category it also has.
  const graceMin = event.graceMin ?? own.find((c) => c.entry === entry)?.graceMin ?? 0;
  return { entry, graceMin };
}

/** When the user gets there on foot: straight line × detour ÷ walking speed (routing comes later). */
export function arrivalAt(
  now: Date,
  distanceM: number,
  app: Pick<AppConfig, 'walkingSpeedMPerMin' | 'arrival'>,
): Date {
  const minutes = (distanceM * app.arrival.detourFactor) / app.walkingSpeedMPerMin;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Too late to be worth going (the dashed pin): fixed entry after start + grace; open entry
 * from `openLastEntryMin` before the end, as it closes before you would get there.
 */
export function isLate(
  event: EntryFields & Pick<HappowEvent, 'startAt' | 'endAt'>,
  arrival: Date,
  categories: Category[],
  app: Pick<AppConfig, 'arrival'>,
): boolean {
  const { entry, graceMin } = entryOf(event, categories);
  const t = arrival.getTime();
  if (entry === 'fixed') return t > new Date(event.startAt).getTime() + graceMin * 60_000;
  return t >= new Date(event.endAt).getTime() - app.arrival.openLastEntryMin * 60_000;
}

/** Whole minutes the arrival is after the start ("+N min" on the card); 0 when not after. */
export function minutesAfterStart(event: Pick<HappowEvent, 'startAt'>, arrival: Date): number {
  return Math.max(0, Math.ceil((arrival.getTime() - new Date(event.startAt).getTime()) / 60_000));
}

export type FamilyMatch = 'show' | 'unconfirmed' | 'hide';

/** Oldest `ageMin` that family mode still shows. */
export const FAMILY_MAX_AGE_MIN = 12;

/**
 * Family mode (§4.4). Hides 13+ events, starts after `family.latestEnd` and categories marked
 * "no"; shows family events, "yes" categories and `ageMin` ≤ 12; shows events with no age data
 * in "likely" categories that end by `latestEnd` as not confirmed; hides the rest.
 */
export function familyMatch(
  event: Pick<HappowEvent, 'categoryIds' | 'ageMin' | 'family' | 'startAt' | 'endAt' | 'timezone'>,
  categories: Category[],
  app: Pick<AppConfig, 'family'>,
): FamilyMatch {
  const marks = event.categoryIds.map((id) => categories.find((c) => c.id === id)?.family);
  const start = new Date(event.startAt);
  const latest = latestOnDay(start, event.timezone, app.family.latestEnd);
  if (event.ageMin !== null && event.ageMin > FAMILY_MAX_AGE_MIN) return 'hide';
  if (event.family === false || marks.includes('no') || start > latest) return 'hide';
  if (event.family || marks.includes('yes') || event.ageMin !== null) return 'show';
  if (marks.includes('likely') && new Date(event.endAt) <= latest) return 'unconfirmed';
  return 'hide';
}

/** `hhmm` on the local calendar day of `at` in `timeZone`. */
function latestOnDay(at: Date, timeZone: string, hhmm: string): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const [h, m] = hhmm.split(':').map(Number);
  return zonedTime(Number(p.year), Number(p.month), Number(p.day), h!, m!, timeZone);
}
