import { describe, expect, it } from 'vitest';
import { MemoryCache } from '@happow/extract';
import { worshipServices } from '../src/adapters/worship-services';
import { HttpClient } from '../src/http';
import { normalize } from '../src/normalize';
import type { AdapterContext } from '../src/types';
import { parseOsmVenues } from '../src/venues/osm';
import { parseServiceTimes, serviceDates } from '../src/venues/services';
import { config, fixture, region, source } from './helpers';

/** M12 slice J: regular services at places of worship, from OSM `service_times`. */

describe('service_times', () => {
  it('reads weekdays, day ranges and several times', () => {
    expect(parseServiceTimes('Su 08:00,10:00,12:00; Mo-Sa 18:00')).toEqual({
      rules: [
        {
          days: [7],
          times: [
            { start: '08:00', end: null },
            { start: '10:00', end: null },
            { start: '12:00', end: null },
          ],
        },
        { days: [1, 2, 3, 4, 5, 6], times: [{ start: '18:00', end: null }] },
      ],
      skipped: 0,
    });
    expect(parseServiceTimes('We,Fr 7:00-7:45; Sa-Mo 9:30').rules).toEqual([
      { days: [3, 5], times: [{ start: '07:00', end: '07:45' }] },
      { days: [1, 6, 7], times: [{ start: '09:30', end: null }] },
    ]);
    // Holidays add nothing; a rule without days is every day.
    expect(parseServiceTimes('Su,PH 10:00').rules[0]!.days).toEqual([7]);
    expect(parseServiceTimes('17:00').rules[0]!.days).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('skips what it cannot read, and keeps the rest', () => {
    expect(parseServiceTimes('Jan-Jun Su 09:00; Su 11:00')).toEqual({
      rules: [{ days: [7], times: [{ start: '11:00', end: null }] }],
      skipped: 1,
    });
    expect(parseServiceTimes('PH 10:00; Mo off; "by appointment"; Tu 25:00; Xx 10:00')).toEqual({
      rules: [],
      skipped: 5,
    });
    expect(parseServiceTimes('').rules).toEqual([]);
  });

  it('lays the pattern over the days ahead, earliest first', () => {
    const { rules } = parseServiceTimes('Su 08:00,10:00; Mo-Sa 18:00-18:45; Sa 23:30-00:30');
    const dates = serviceDates(rules, '2026-10-31', 2);
    expect(dates).toEqual([
      { start: '2026-10-31T18:00', end: '2026-10-31T18:45' },
      { start: '2026-10-31T23:30', end: '2026-11-01T00:30' },
      { start: '2026-11-01T08:00', end: null },
      { start: '2026-11-01T10:00', end: null },
    ]);
  });
});

describe('worship-services adapter (recorded Overpass answer)', () => {
  const places = parseOsmVenues(
    JSON.parse(fixture('venues/overpass-venues.json')).elements,
    config.app.venues.osmTags,
  ).filter((v) => v.serviceTimes);
  const ctx = (now: Date): AdapterContext => ({
    source: source('worship-services'),
    region,
    window: { from: new Date(now.getTime() - 3_600_000), to: now },
    http: new HttpClient({ userAgent: 'test' }),
    env: {},
    now,
    services: {
      extractor: null,
      extractionCache: new MemoryCache(),
      categories: config.categories,
      userAgent: 'test',
      maxInputChars: 1000,
      maxPageBytes: 1000,
      worshipPlaces: places,
    },
  });

  it('gives one event per service for two weeks, none already over, each its own', async () => {
    // Sat 24 Oct 2026, 19:00 in Warsaw (summer time until Sunday 03:00).
    const now = new Date('2026-10-24T17:00:00Z');
    const raws = await worshipServices.fetch(ctx(now));
    // Two weeks: 2 Sundays × 3 + 11 weekdays left (today's 18:00 is over) × 1.
    expect(raws).toHaveLength(2 * 3 + 11);
    expect(new Set(raws.map((r) => r.externalId)).size).toBe(raws.length);
    const parsed = raws.map((r) => worshipServices.parse(r, ctx(now))!);
    const first = parsed[0]!;
    expect(first).toMatchObject({
      title: 'Nabożeństwo',
      categoryIds: ['religious'],
      isFree: true,
      entry: 'fixed',
      venue: { name: 'Parafia Przykładowa', externalId: 'relation/3003' },
      officialUrl: 'http://parafia.example/msze',
    });
    // Sunday 25 Oct, the day the clocks go back: 08:00 is winter time already (UTC+1).
    expect(first.startAt).toBe('2026-10-25T07:00:00.000Z');
    // A week earlier the same 08:00 would be UTC+2; a week later it stays UTC+1.
    const sundays = parsed.filter((p) => p.startAt.endsWith('07:00:00.000Z'));
    expect(sundays.map((p) => p.startAt)).toEqual([
      '2026-10-25T07:00:00.000Z',
      '2026-11-01T07:00:00.000Z',
    ]);
  });

  it('normalizes into the religious category, crawled trust and the configured confidence', async () => {
    const now = new Date('2026-10-24T17:00:00Z');
    const raw = (await worshipServices.fetch(ctx(now)))[0]!;
    const res = normalize(worshipServices.parse(raw, ctx(now))!, {
      source: source('worship-services'),
      region,
      categories: config.categories,
      h3Resolution: config.app.h3.eventResolution,
      densityResolution: config.app.h3.densityResolution,
      descriptionMaxChars: 600,
      now,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.event).toMatchObject({ categoryIds: ['religious'], trust: 'crawled' });
    expect(res.value.event.confidence).toBeLessThan(1);
  });

  it('needs the OSM venues', async () => {
    const c = ctx(new Date());
    await expect(worshipServices.fetch({ ...c, services: undefined })).rejects.toThrow();
  });
});
