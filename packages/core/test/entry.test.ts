import { describe, expect, it } from 'vitest';
import {
  arrivalAt,
  categoriesConfigSchema,
  entryOf,
  familyMatch,
  isLate,
  loadConfig,
  minutesAfterStart,
  type HappowEvent,
} from '../src';

const config = loadConfig();
const { app, categories } = config;
const TZ = 'Europe/Warsaw';

type Ev = Pick<
  HappowEvent,
  'categoryIds' | 'entry' | 'graceMin' | 'ageMin' | 'family' | 'startAt' | 'endAt' | 'timezone'
>;
const ev = (over: Partial<Ev> = {}): Ev => ({
  categoryIds: ['theatre'],
  entry: null,
  graceMin: null,
  ageMin: null,
  family: null,
  // 19:00–21:00 CEST on Sat 24 Oct 2026.
  startAt: '2026-10-24T17:00:00Z',
  endAt: '2026-10-24T19:00:00Z',
  timezone: TZ,
  ...over,
});
const at = (iso: string) => new Date(iso);

describe('category entry defaults', () => {
  it('every category has an entry type and the agreed defaults', () => {
    const by = Object.fromEntries(categories.map((c) => [c.id, c]));
    for (const id of ['theatre', 'cinema', 'talk', 'sport', 'music', 'kids', 'religious'])
      expect(by[id]!.entry, id).toBe('fixed');
    for (const id of ['garage-sale', 'market', 'exhibition', 'festival', 'happening'])
      expect(by[id]!.entry, id).toBe('open');
    expect(by.cinema!.graceMin).toBe(25);
    expect(by.kids!.graceMin).toBe(5);
    expect(by.religious!.graceMin).toBe(15);
    expect(by.kids!.family).toBe('yes');
    for (const id of ['market', 'garage-sale', 'festival', 'exhibition', 'food', 'sport'])
      expect(by[id]!.family, id).toBe('likely');
  });
  it('the config check rejects a category without an entry type', () => {
    const bad = { id: 'x', labels: { pl: 'x', en: 'x' }, defaultDurationMin: 60 };
    expect(
      categoriesConfigSchema.safeParse({ categories: [{ ...bad, icon: 'x', color: '#000000' }] })
        .success,
    ).toBe(false);
  });
});

describe('entryOf', () => {
  it('uses the category default when the event says nothing', () => {
    expect(entryOf(ev({ categoryIds: ['cinema'] }), categories)).toEqual({
      entry: 'fixed',
      graceMin: 25,
    });
    expect(entryOf(ev({ categoryIds: ['market'] }), categories).entry).toBe('open');
  });
  it('a per-event value wins: a club night under music is open', () => {
    expect(entryOf(ev({ categoryIds: ['music'], entry: 'open' }), categories)).toEqual({
      entry: 'open',
      graceMin: 0,
    });
    expect(entryOf(ev({ graceMin: 30 }), categories).graceMin).toBe(30);
  });
  it('a fixed event in an open category borrows the grace of a fixed category it has', () => {
    const e = ev({ categoryIds: ['festival', 'music'], entry: 'fixed' });
    expect(entryOf(e, categories)).toEqual({ entry: 'fixed', graceMin: 15 });
  });
  it('unknown categories fall back to open', () => {
    expect(entryOf(ev({ categoryIds: ['nope'] }), categories)).toEqual({
      entry: 'open',
      graceMin: 0,
    });
  });
});

describe('arrival and late', () => {
  it('arrival is straight line × 1.3 ÷ 80 m/min', () => {
    // 800 m × 1.3 = 1,040 m → 13 min.
    expect(arrivalAt(at('2026-10-24T17:00:00Z'), 800, app).toISOString()).toBe(
      '2026-10-24T17:13:00.000Z',
    );
  });
  it('fixed entry is late after start + grace (theatre: 5 min)', () => {
    const e = ev();
    expect(isLate(e, at('2026-10-24T17:05:00Z'), categories, app)).toBe(false);
    expect(isLate(e, at('2026-10-24T17:05:01Z'), categories, app)).toBe(true);
    expect(minutesAfterStart(e, at('2026-10-24T17:07:30Z'))).toBe(8);
    expect(minutesAfterStart(e, at('2026-10-24T16:50:00Z'))).toBe(0);
  });
  it('open entry is never late while open, until 5 min before the end', () => {
    const e = ev({ categoryIds: ['market'] });
    expect(isLate(e, at('2026-10-24T18:30:00Z'), categories, app)).toBe(false);
    expect(isLate(e, at('2026-10-24T18:54:59Z'), categories, app)).toBe(false);
    expect(isLate(e, at('2026-10-24T18:55:00Z'), categories, app)).toBe(true);
  });
});

describe('familyMatch', () => {
  const m = (over: Partial<Ev>) => familyMatch(ev(over), categories, app);
  it('shows family events, the kids category and ageMin ≤ 12 (0+ included)', () => {
    expect(m({ family: true })).toBe('show');
    expect(m({ categoryIds: ['kids'] })).toBe('show');
    expect(m({ ageMin: 0 })).toBe('show');
    expect(m({ ageMin: 12 })).toBe('show');
  });
  it('hides 13+, explicit non-family events and theatre without age data', () => {
    expect(m({ ageMin: 13 })).toBe('hide');
    expect(m({ ageMin: 18, categoryIds: ['kids'] })).toBe('hide');
    expect(m({ family: false, categoryIds: ['market'] })).toBe('hide');
    expect(m({})).toBe('hide');
  });
  it('"likely" categories without age data are not confirmed if they end by 21:00', () => {
    expect(m({ categoryIds: ['market'] })).toBe('unconfirmed');
    // Ends 21:30 local.
    expect(m({ categoryIds: ['market'], endAt: '2026-10-24T19:30:00Z' })).toBe('hide');
  });
  it('hides starts after 21:00 local, also across the DST change', () => {
    // Sun 25 Oct is CET (UTC+1): 21:00 local = 20:00 UTC.
    const day = { startAt: '2026-10-25T20:00:00Z', endAt: '2026-10-25T21:00:00Z' };
    expect(m({ family: true, ...day })).toBe('show');
    expect(m({ family: true, startAt: '2026-10-25T20:01:00Z', endAt: day.endAt })).toBe('hide');
    expect(
      m({
        categoryIds: ['market'],
        startAt: '2026-10-25T15:00:00Z',
        endAt: '2026-10-25T20:00:00Z',
      }),
    ).toBe('unconfirmed');
  });
  it('a category marked "no" hides even family events', () => {
    const night = categories.map((c) => (c.id === 'music' ? { ...c, family: 'no' as const } : c));
    expect(familyMatch(ev({ categoryIds: ['music'], family: true }), night, app)).toBe('hide');
  });
});
