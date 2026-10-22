import { describe, expect, it } from 'vitest';
import { mapCategories, normalize, stripHtml, truncate, type ParsedEvent } from '../src';
import { config, region, source } from './helpers';

const tm = source('ticketmaster');

const base: ParsedEvent = {
  externalId: '1',
  sourceUrl: null,
  title: '  Concert \n in the  park ',
  description: null,
  startAt: '2026-10-24T18:00:00+02:00',
  endAt: null,
  categoryLabels: [['Music']],
  venue: null,
  point: { lat: 51.11, lng: 17.03 },
  isFree: null,
  priceMin: null,
  priceMax: null,
  currency: null,
  rules: {},
  ageMin: null,
  family: null,
  entry: null,
  officialUrl: null,
  ticketUrl: null,
  imageUrl: null,
  status: 'scheduled',
};
const ctx = {
  source: tm,
  region,
  categories: config.categories,
  h3Resolution: 9,
  descriptionMaxChars: 40,
  now: new Date('2026-10-24T10:00:00Z'),
};

describe('normalize', () => {
  it('cleans titles, estimates the end and stamps freshness', () => {
    const res = normalize(base, ctx);
    if (!res.ok) throw new Error(res.reason);
    expect(res.value.event).toMatchObject({
      id: 'ticketmaster:1',
      title: 'Concert in the park',
      startAt: '2026-10-24T16:00:00.000Z',
      endAt: '2026-10-24T18:30:00.000Z',
      endEstimated: true,
      timezone: 'Europe/Warsaw',
      isFree: false,
      lastSeenAt: '2026-10-24T10:00:00.000Z',
    });
    expect(res.value.staleAfter).toBe('2026-10-25T10:00:00.000Z'); // maxCacheAgeHours 24
  });

  it('ignores an end before the start', () => {
    const res = normalize({ ...base, endAt: '2026-10-24T17:00:00+02:00' }, ctx);
    expect(res.ok && res.value.event.endEstimated).toBe(true);
  });

  it('treats a zero price as free', () => {
    const res = normalize({ ...base, priceMin: 0, priceMax: 0 }, ctx);
    expect(res.ok && res.value.event.isFree).toBe(true);
  });

  it('uses the venue point when the event has none, and rejects unplaceable events', () => {
    const venue = {
      externalId: 'v',
      name: 'Hall',
      address: null,
      point: { lat: 51.1, lng: 17.0 },
      website: null,
    };
    const res = normalize({ ...base, point: null, venue }, ctx);
    expect(res.ok && res.value.event.point).toEqual({ lat: 51.1, lng: 17.0 });
    expect(res.ok && res.value.venue?.id).toBe('ticketmaster:v');
    expect(normalize({ ...base, point: null }, ctx)).toMatchObject({
      ok: false,
      reason: 'no-location',
    });
    expect(normalize({ ...base, point: { lat: 52.4, lng: 16.9 } }, ctx)).toMatchObject({
      ok: false,
      reason: 'outside-region',
    });
    expect(normalize({ ...base, title: '  ' }, ctx)).toMatchObject({
      ok: false,
      reason: 'no-title',
    });
  });
});

describe('mapCategories', () => {
  it('takes the most specific mapped label of each classification', () => {
    expect(mapCategories([["Children's Theatre", 'Arts & Theatre']], tm)).toEqual(['kids']);
    expect(
      mapCategories(
        [
          ['Rock', 'Music'],
          ['Fairs & Festivals', 'Miscellaneous'],
        ],
        tm,
      ),
    ).toEqual(['music', 'festival']);
  });

  it('drops "other" next to a specific category and falls back to the default', () => {
    expect(mapCategories([['Miscellaneous'], ['Film']], tm)).toEqual(['cinema']);
    expect(mapCategories([['Something new']], tm)).toEqual(tm.defaultCategories);
    expect(mapCategories([], tm)).toEqual(tm.defaultCategories);
  });
});

describe('text helpers', () => {
  it('strips HTML, entities and Markdown', () => {
    expect(stripHtml('<p>Tom &amp; Jerry&#39;s<br/>show</p>')).toBe("Tom & Jerry's show");
    expect(stripHtml('**Bold** and [link](https://x.example)')).toBe('Bold and link');
  });

  it('truncates on a word boundary', () => {
    expect(truncate('one two three four five six', 15)).toBe('one two three…');
    expect(truncate('short', 15)).toBe('short');
  });
});
