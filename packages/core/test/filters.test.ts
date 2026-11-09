import { describe, expect, it } from 'vitest';
import {
  FAR_FUTURE,
  intervalMs,
  localToInstant,
  matchesFilters,
  monthStarts,
  priceFromToggles,
  priceToggles,
  rateLimitIntervalMs,
  windowRange,
} from '../src';

describe('time windows', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  it('"now" is the instant, hour windows extend from now', () => {
    expect(windowRange({ id: 'now', hours: 0 }, now, 'Europe/Warsaw')).toEqual({
      from: now,
      to: now,
    });
    expect(windowRange({ id: '2h', hours: 2 }, now, 'Europe/Warsaw').to.toISOString()).toBe(
      '2026-10-24T12:00:00.000Z',
    );
  });
  it('"today" ends at local midnight', () => {
    const { to } = windowRange({ id: 'today', endOfDay: true }, now, 'Europe/Warsaw');
    expect(to.toISOString()).toBe('2026-10-24T21:59:59.999Z');
  });
  it('"week" and "later" count calendar days, ending at local midnight after the DST change', () => {
    // Sat 24 Oct (CEST); summer time ends on Sun 25 Oct, so the last day ends at 23:00 UTC.
    const week = windowRange({ id: 'week', days: 7 }, now, 'Europe/Warsaw');
    expect(week.from).toEqual(now);
    expect(week.to.toISOString()).toBe('2026-10-30T22:59:59.999Z');
    const later = windowRange({ id: 'later', days: 14 }, now, 'Europe/Warsaw');
    expect(later.to.toISOString()).toBe('2026-11-06T22:59:59.999Z');
  });

  it('the future starts where the 14 days end and has no end', () => {
    const future = windowRange({ id: 'future', afterDays: 14, months: 12 }, now, 'Europe/Warsaw');
    // Local midnight after Fri 6 Nov (CET), the instant after the 14-day range.
    expect(future.from.toISOString()).toBe('2026-11-06T23:00:00.000Z');
    expect(future.to).toEqual(FAR_FUTURE);
  });

  it('steps the future by calendar month, then one step for everything later', () => {
    const from = new Date('2026-11-06T23:00:00.000Z');
    const steps = monthStarts(from, 'Europe/Warsaw', 12);
    expect(steps).toHaveLength(14);
    expect(steps[0]).toEqual(from);
    // The rest of November, then whole months at local midnight, summer time included.
    expect(steps[1]!.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(steps[2]!.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(steps[6]!.toISOString()).toBe('2027-04-30T22:00:00.000Z');
    expect(steps[12]!.toISOString()).toBe('2027-10-31T23:00:00.000Z');
    expect(steps[13]).toEqual(FAR_FUTURE);
  });
});

describe('filters', () => {
  const ev = { categoryIds: ['music', 'festival'], isFree: true };
  it('matches any selected category; empty selection matches all', () => {
    expect(matchesFilters(ev, { categories: [] })).toBe(true);
    expect(matchesFilters(ev, { categories: ['festival', 'sport'] })).toBe(true);
    expect(matchesFilters(ev, { categories: ['sport'] })).toBe(false);
  });
  it('hides an event only when all of its categories are excluded', () => {
    expect(matchesFilters(ev, { excluded: ['sport'] })).toBe(true);
    expect(matchesFilters(ev, { excluded: ['festival'] })).toBe(true);
    expect(matchesFilters(ev, { excluded: ['music', 'festival'] })).toBe(false);
    expect(matchesFilters({ ...ev, categoryIds: ['music'] }, { excluded: ['music'] })).toBe(false);
    expect(matchesFilters(ev, { categories: ['sport'], excluded: ['festival'] })).toBe(false);
  });
  it('filters by price', () => {
    expect(matchesFilters(ev, { price: 'free' })).toBe(true);
    expect(matchesFilters(ev, { price: 'paid' })).toBe(false);
    expect(matchesFilters({ ...ev, isFree: false }, { price: 'paid' })).toBe(true);
  });
});

describe('price toggles', () => {
  it('both on means any; the last one on cannot go off', () => {
    expect(priceToggles('any')).toEqual({ free: true, paid: true });
    expect(priceToggles('free')).toEqual({ free: true, paid: false });
    expect(priceFromToggles(true, true)).toBe('any');
    expect(priceFromToggles(false, true)).toBe('paid');
    expect(priceFromToggles(false, false)).toBeNull();
  });
});

describe('source schedules', () => {
  it('parses schedules and rate limits', () => {
    expect(intervalMs('30m')).toBe(1_800_000);
    expect(intervalMs('2h')).toBe(7_200_000);
    expect(rateLimitIntervalMs('5/s')).toBe(200);
    expect(rateLimitIntervalMs('200/h')).toBe(18_000);
  });
});

describe('localToInstant', () => {
  it('converts wall-clock time across DST', () => {
    expect(localToInstant('2026-10-24', '20:00:00', 'Europe/Warsaw')?.toISOString()).toBe(
      '2026-10-24T18:00:00.000Z',
    );
    // After the switch back to CET on 25 Oct 2026.
    expect(localToInstant('2026-10-26', '20:00', 'Europe/Warsaw')?.toISOString()).toBe(
      '2026-10-26T19:00:00.000Z',
    );
    expect(localToInstant('24.10.2026', null, 'Europe/Warsaw')).toBeNull();
  });
});
