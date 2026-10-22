import { describe, expect, it } from 'vitest';
import {
  categoriesConfigSchema,
  intervalMs,
  loadConfig,
  localToInstant,
  matchesFilters,
  rateLimitIntervalMs,
  windowRange,
} from '../src';

const config = loadConfig();

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
  it('config windows are valid and include the default', () => {
    expect(config.app.timeWindows.map((w) => w.id)).toContain(config.app.defaultTimeWindow);
  });
});

describe('filters', () => {
  const ev = { categoryIds: ['music', 'festival'], isFree: true };
  it('matches any selected category; empty selection matches all', () => {
    expect(matchesFilters(ev, { categories: [] })).toBe(true);
    expect(matchesFilters(ev, { categories: ['festival', 'sport'] })).toBe(true);
    expect(matchesFilters(ev, { categories: ['sport'] })).toBe(false);
  });
  it('filters by price', () => {
    expect(matchesFilters(ev, { price: 'free' })).toBe(true);
    expect(matchesFilters(ev, { price: 'paid' })).toBe(false);
    expect(matchesFilters({ ...ev, isFree: false }, { price: 'paid' })).toBe(true);
  });
});

describe('source config', () => {
  it('maps every source label to a known category', () => {
    const ids = new Set(config.categories.map((c) => c.id));
    for (const s of config.sources) {
      for (const c of Object.values(s.categoryMap)) expect(ids.has(c)).toBe(true);
      for (const c of s.defaultCategories) expect(ids.has(c)).toBe(true);
    }
  });
  it('keeps secrets as env var names only', () => {
    for (const s of config.sources) for (const k of s.secrets) expect(k).toMatch(/^[A-Z0-9_]+$/);
  });
  it('parses schedules and rate limits', () => {
    expect(intervalMs('30m')).toBe(1_800_000);
    expect(intervalMs('2h')).toBe(7_200_000);
    expect(rateLimitIntervalMs('5/s')).toBe(200);
    expect(rateLimitIntervalMs('200/h')).toBe(18_000);
  });
  it('categories schema still accepts the taxonomy file', () => {
    expect(() => categoriesConfigSchema.parse({ categories: config.categories })).not.toThrow();
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
