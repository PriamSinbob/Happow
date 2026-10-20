import type { HappowEvent } from '@happow/core';
import { describe, expect, it } from 'vitest';
import {
  decide,
  findDuplicate,
  mergeEvents,
  normalizeTitle,
  sourceRanker,
  titleSimilarity,
} from '../src';
import { config } from './helpers';

const cfg = config.app.dedup;

function ev(over: Partial<HappowEvent>): HappowEvent {
  return {
    id: 'x',
    title: 'Event',
    description: null,
    categoryIds: ['music'],
    startAt: '2026-10-24T18:00:00.000Z',
    endAt: '2026-10-24T20:30:00.000Z',
    endEstimated: true,
    timezone: 'Europe/Warsaw',
    venue: null,
    point: { lat: 51.1069, lng: 17.0773 },
    h3r9: '891e2040b2bffff',
    priceMin: null,
    priceMax: null,
    currency: null,
    isFree: false,
    rules: {},
    officialUrl: null,
    ticketUrl: null,
    imageUrl: null,
    status: 'scheduled',
    trust: 'api',
    confidence: 1,
    lastSeenAt: '2026-10-24T10:00:00.000Z',
    ...over,
  };
}

describe('title similarity', () => {
  it('normalizes case, diacritics, punctuation and filler words', () => {
    expect(normalizeTitle('Koncert: Dawid Podsiadło – LIVE!')).toBe('koncert dawid podsiadlo');
  });

  it('matches the same event listed differently', () => {
    expect(
      titleSimilarity('Dawid Podsiadło', 'Dawid Podsiadło – Trasa 2026'),
    ).toBeGreaterThanOrEqual(cfg.titleSimilarity);
    expect(titleSimilarity('Wrocław JS #87', 'Wroclaw JS 87')).toBe(1);
    expect(titleSimilarity('Jazz nad Odrą 2026', 'JAZZ NAD ODRĄ')).toBeGreaterThanOrEqual(
      cfg.titleSimilarity,
    );
  });

  it('keeps different events at the same venue apart', () => {
    expect(titleSimilarity('Mayday', 'Skrzypek na dachu')).toBeLessThan(cfg.titleSimilarity);
    expect(titleSimilarity('Śląsk – Legia', 'Śląsk – Lech')).toBeLessThan(0.8);
    // A one-short-word title must not swallow every longer title containing it.
    expect(titleSimilarity('Jazz', 'Jazz Jam Session with Big Band Orchestra')).toBeLessThan(
      cfg.titleSimilarity,
    );
  });
});

describe('findDuplicate', () => {
  const stored = [
    {
      event: ev({ id: 'a', title: 'Dawid Podsiadło' }),
      primarySourceId: 'ticketmaster',
      primaryExternalId: 'a',
    },
  ];

  it('finds a match within the start tolerance', () => {
    const c = ev({
      id: 'b',
      title: 'Dawid Podsiadło – Trasa 2026',
      startAt: '2026-10-24T18:20:00.000Z',
    });
    expect(findDuplicate(c, stored, cfg)?.event.id).toBe('a');
  });

  it('ignores starts further apart than the tolerance', () => {
    const c = ev({ id: 'b', title: 'Dawid Podsiadło', startAt: '2026-10-24T19:00:00.000Z' });
    expect(findDuplicate(c, stored, cfg)).toBeNull();
  });

  it('never matches an event with itself', () => {
    expect(findDuplicate(ev({ id: 'a', title: 'Dawid Podsiadło' }), stored, cfg)).toBeNull();
  });
});

describe('merge and decide', () => {
  const rank = sourceRanker(config.sources);
  const tm = (externalId: string) => ({ sourceId: 'ticketmaster', externalId });
  const mu = (externalId: string) => ({ sourceId: 'meetup', externalId });
  const stored = (event: HappowEvent, owner: { sourceId: string; externalId: string }) => ({
    event,
    primarySourceId: owner.sourceId,
    primaryExternalId: owner.externalId,
  });

  it('ranks by trust, then by order in sources.json', () => {
    expect(rank('ticketmaster')).toBeGreaterThan(rank('seed'));
    expect(rank('ticketmaster')).toBeGreaterThan(rank('meetup'));
    expect(rank('unknown')).toBeLessThan(rank('seed'));
  });

  it('fills gaps from the other listing and prefers a real end time', () => {
    const merged = mergeEvents(
      ev({ title: 'A', ticketUrl: 'https://t.example/1', endEstimated: true }),
      ev({
        title: 'B',
        ticketUrl: 'https://t.example/2',
        officialUrl: 'https://o.example',
        endAt: '2026-10-24T21:00:00.000Z',
        endEstimated: false,
        rules: { age: '16+' },
      }),
    );
    expect(merged).toMatchObject({
      title: 'A',
      ticketUrl: 'https://t.example/1',
      officialUrl: 'https://o.example',
      endAt: '2026-10-24T21:00:00.000Z',
      endEstimated: false,
      rules: { age: '16+' },
    });
  });

  it('inserts when nothing matches, owned by the incoming listing', () => {
    const d = decide(ev({ id: 'meetup:1', title: 'Talk' }), mu('1'), null, [], rank, cfg);
    expect(d).toMatchObject({ action: 'insert', owner: mu('1') });
  });

  it('a lower-ranked duplicate only fills gaps and keeps the existing id and owner', () => {
    const s = stored(ev({ id: 'ticketmaster:1', title: 'Jazz nad Odrą' }), tm('1'));
    const d = decide(
      ev({ id: 'meetup:9', title: 'Jazz nad Odrą 2026', officialUrl: 'https://m.example' }),
      mu('9'),
      null,
      [s],
      rank,
      cfg,
    );
    expect(d).toMatchObject({ action: 'update', owner: tm('1'), merged: true });
    expect(d.event).toMatchObject({
      id: 'ticketmaster:1',
      title: 'Jazz nad Odrą',
      officialUrl: 'https://m.example',
    });
  });

  it('a higher-ranked source takes over the primary fields', () => {
    const s = stored(ev({ id: 'seed:1', title: 'Jazz nad Odrą', trust: 'community' }), {
      sourceId: 'seed',
      externalId: 'seed:1',
    });
    const d = decide(
      ev({ id: 'ticketmaster:7', title: 'JAZZ NAD ODRĄ 2026' }),
      tm('7'),
      null,
      [s],
      rank,
      cfg,
    );
    expect(d).toMatchObject({ action: 'update', owner: tm('7'), merged: true });
    expect(d.event).toMatchObject({ id: 'seed:1', title: 'JAZZ NAD ODRĄ 2026', trust: 'api' });
  });

  it('a second listing of equal rank never takes over, on the merge or on later runs', () => {
    const s = stored(ev({ id: 'ticketmaster:1', title: 'Dawid Podsiadło' }), tm('1'));
    const incoming = ev({ id: 'ticketmaster:2', title: 'Dawid Podsiadło – Trasa 2026' });
    const merge = decide(incoming, tm('2'), null, [s], rank, cfg);
    expect(merge).toMatchObject({ owner: tm('1'), event: { title: 'Dawid Podsiadło' } });
    const rerun = decide(incoming, tm('2'), s, [], rank, cfg);
    expect(rerun).toMatchObject({
      owner: tm('1'),
      merged: false,
      event: { title: 'Dawid Podsiadło' },
    });
  });

  it('an update from the owning listing is applied, e.g. a cancellation', () => {
    const s = stored(ev({ id: 'ticketmaster:1' }), tm('1'));
    const d = decide(ev({ id: 'ticketmaster:1', status: 'cancelled' }), tm('1'), s, [], rank, cfg);
    expect(d).toMatchObject({ action: 'update', merged: false, event: { status: 'cancelled' } });
  });
});
