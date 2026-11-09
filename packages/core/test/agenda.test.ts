import { describe, expect, it } from 'vitest';
import {
  agendaDays,
  eveningQueue,
  loadConfig,
  mergePlans,
  setPlan,
  stepLeave,
  viewIds,
  walkMinutes,
  type HappowEvent,
  type PlanEntry,
} from '../src';

const { app, categories } = loadConfig();
const TZ = 'Europe/Warsaw';
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-06T17:00:00Z'); // Fri 6 Nov, 18:00 in Wrocław

const entry = (id: string, at: number, on = true, going = false): PlanEntry => ({
  id,
  on,
  going,
  at,
});

describe('the saved list', () => {
  const cfg = { keepRemovedDays: 30, maxSaved: 3 };

  it('merges two lists: the latest change per event wins, the server on a tie', () => {
    const device = [entry('a', T0 + 10), entry('b', T0 + 30, false), entry('c', T0 + 5)];
    const server = [
      entry('a', T0 + 20, false),
      entry('b', T0 + 20),
      entry('c', T0 + 5, true, true),
    ];
    const merged = mergePlans(device, server, T0, cfg);
    expect(merged.find((e) => e.id === 'a')!.on).toBe(false);
    expect(merged.find((e) => e.id === 'b')!.on).toBe(false);
    expect(merged.find((e) => e.id === 'c')!.going).toBe(true);
  });

  it('forgets removals after keepRemovedDays and keeps the newest maxSaved', () => {
    const old = T0 - 31 * DAY;
    const merged = mergePlans(
      [entry('gone', old, false), entry('kept', T0 - DAY, false)],
      [entry('s1', 1), entry('s2', 2), entry('s3', 3), entry('s4', 4)],
      T0,
      cfg,
    );
    expect(merged.map((e) => e.id).sort()).toEqual(['kept', 's2', 's3', 's4']);
  });

  it('"I\'m going" also saves; taking it back keeps the bookmark; un-saving clears going', () => {
    let list = setPlan([], 'x', { going: true }, T0);
    expect(list).toEqual([entry('x', T0, true, true)]);
    list = setPlan(list, 'x', { going: false }, T0 + 1);
    expect(list[0]).toMatchObject({ on: true, going: false });
    list = setPlan(list, 'x', { going: true }, T0 + 2);
    list = setPlan(list, 'x', { on: false }, T0 + 3);
    expect(list[0]).toMatchObject({ on: false, going: false });
  });

  it('a change is always newer than the one before, even with a clock that went back', () => {
    const list = setPlan([entry('x', T0 + 5000)], 'x', { on: false }, T0);
    expect(list[0]!.at).toBe(T0 + 5001);
  });

  it('views: everything is no filter; plans and saved are the bookmarks; private is empty', () => {
    const list = [entry('a', 1), entry('b', 2, false)];
    expect(viewIds(list, 'all')).toBeNull();
    expect([...viewIds(list, 'plans')!]).toEqual(['a']);
    expect([...viewIds(list, 'saved')!]).toEqual(['a']);
    expect(viewIds(list, 'private')!.size).toBe(0);
  });

  it('my plans merges accepted invitations; only private ones show in Private', () => {
    const list = [entry('a', 1), entry('b', 2, false)];
    const invited = [
      { id: 'inv-pub', private: false },
      { id: 'inv-priv', private: true },
      { id: 'a', private: false },
    ];
    expect([...viewIds(list, 'plans', invited)!].sort()).toEqual(['a', 'inv-priv', 'inv-pub']);
    expect([...viewIds(list, 'saved', invited)!]).toEqual(['a']);
    expect([...viewIds(list, 'private', invited)!]).toEqual(['inv-priv']);
    expect(viewIds(list, 'all', invited)).toBeNull();
  });

  it('pending invitations are only in Private; your own private events are in both', () => {
    const invited = [
      { id: 'p', private: true, status: 'pending' as const },
      { id: 'o', private: true, status: 'owner' as const },
      { id: 'y', private: true, status: 'accepted' as const },
    ];
    expect([...viewIds([], 'plans', invited)!].sort()).toEqual(['o', 'y']);
    expect([...viewIds([], 'private', invited)!].sort()).toEqual(['o', 'p', 'y']);
  });
});

const ev = (id: string, start: string, end: string, over: Partial<HappowEvent> = {}) =>
  ({
    id,
    title: id,
    startAt: start,
    endAt: end,
    categoryIds: ['music'],
    entry: null,
    graceMin: null,
    point: { lat: 51.11, lng: 17.03 },
    ...over,
  }) as HappowEvent;

describe('agenda days', () => {
  const now = new Date(T0);

  it('groups by local day, a running event first today, ended ones under Past', () => {
    const list = [
      ev('tomorrow', '2026-11-07T18:00:00Z', '2026-11-07T20:00:00Z'),
      ev('later-today', '2026-11-06T19:00:00Z', '2026-11-06T21:00:00Z'),
      ev('running', '2026-11-06T09:00:00Z', '2026-11-06T22:00:00Z'),
      // 23:30 local on the 6th is still Friday, though it is the 6th 22:30 UTC.
      ev('late-night', '2026-11-06T22:30:00Z', '2026-11-07T01:00:00Z'),
      ev('yesterday', '2026-11-05T18:00:00Z', '2026-11-05T20:00:00Z'),
      ev('last-week', '2026-10-30T18:00:00Z', '2026-10-30T20:00:00Z'),
      ev('long-ago', '2026-09-01T18:00:00Z', '2026-09-01T20:00:00Z'),
    ];
    const { days, past, expired } = agendaDays(list, now, TZ, 30);
    expect(days.map((d) => [d.day, d.events.map((e) => e.id)])).toEqual([
      ['2026-11-06', ['running', 'later-today', 'late-night']],
      ['2026-11-07', ['tomorrow']],
    ]);
    expect(past.map((e) => e.id)).toEqual(['yesterday', 'last-week']);
    expect(expired).toEqual(['long-ago']);
  });

  it('counts days on the calendar across the end of daylight saving', () => {
    // Sat 24 Oct 23:30 CEST and Sun 25 Oct 23:30 CET: two different local days.
    const sat = ev('sat', '2026-10-24T21:30:00Z', '2026-10-24T22:00:00Z');
    const sun = ev('sun', '2026-10-25T22:30:00Z', '2026-10-25T23:00:00Z');
    const { days } = agendaDays([sat, sun], new Date('2026-10-24T10:00:00Z'), TZ, 30);
    expect(days.map((d) => d.day)).toEqual(['2026-10-24', '2026-10-25']);
  });
});

describe('the evening queue', () => {
  // 1 km apart along a meridian: 1000 × 1.3 ÷ 80 = 16.25 min, rounded up to 20.
  const near = { lat: 51.1, lng: 17.03 };
  const km = { lat: 51.1 + 1 / 111.2, lng: 17.03 };

  it('rounds walks up to 5 minutes', () => {
    expect(walkMinutes(0, app)).toBe(0);
    expect(walkMinutes(300, app)).toBe(5);
    expect(walkMinutes(1000, app)).toBe(20);
    expect(walkMinutes(2462, app)).toBe(45);
    expect(walkMinutes(2400, app)).toBe(40);
  });

  it('is fine with time to spare, in start order', () => {
    const q = eveningQueue(
      [
        ev('concert', '2026-11-06T19:30:00Z', '2026-11-06T21:00:00Z', { point: km }),
        ev('talk', '2026-11-06T17:00:00Z', '2026-11-06T18:30:00Z', {
          categoryIds: ['talk'],
          point: near,
        }),
      ],
      {},
      categories,
      app,
    );
    expect(q.stops.map((s) => s.event.id)).toEqual(['talk', 'concert']);
    expect(q.legs).toHaveLength(1);
    expect(q.legs[0]).toMatchObject({
      walkMin: 20,
      long: false,
      verdict: { kind: 'fine', spareMin: 40 },
    });
  });

  it('warns of an overlap, and of a late arrival past the grace', () => {
    const overlap = eveningQueue(
      [
        ev('a', '2026-11-06T17:00:00Z', '2026-11-06T19:00:00Z', {
          categoryIds: ['theatre'],
          point: near,
        }),
        ev('b', '2026-11-06T18:20:00Z', '2026-11-06T20:00:00Z', {
          categoryIds: ['theatre'],
          point: km,
        }),
      ],
      {},
      categories,
      app,
    );
    expect(overlap.legs[0]!.verdict).toEqual({ kind: 'overlap', min: 40 });

    // Ends 18:00, 20 min walk, theatre (grace 5) at 18:10: 10 min late.
    const late = eveningQueue(
      [
        ev('a', '2026-11-06T16:00:00Z', '2026-11-06T18:00:00Z', {
          categoryIds: ['theatre'],
          point: near,
        }),
        ev('b', '2026-11-06T18:10:00Z', '2026-11-06T20:00:00Z', {
          categoryIds: ['theatre'],
          point: km,
        }),
      ],
      {},
      categories,
      app,
    );
    expect(late.legs[0]!.verdict).toEqual({ kind: 'late', min: 10 });

    // Within the grace (cinema, 25 min) it's fine.
    const grace = eveningQueue(
      [
        ev('a', '2026-11-06T16:00:00Z', '2026-11-06T18:00:00Z', {
          categoryIds: ['theatre'],
          point: near,
        }),
        ev('b', '2026-11-06T18:10:00Z', '2026-11-06T20:00:00Z', {
          categoryIds: ['cinema'],
          point: km,
        }),
      ],
      {},
      categories,
      app,
    );
    expect(grace.legs[0]!.verdict).toEqual({ kind: 'fine', spareMin: 0 });
  });

  it('open entry: leave early, open until, or closed before you get there', () => {
    // An exhibition until 20:00, then a concert at 18:30 a 20-minute walk away: leave by 18:10.
    const leaveEarly = eveningQueue(
      [
        ev('expo', '2026-11-06T16:00:00Z', '2026-11-06T19:00:00Z', {
          categoryIds: ['exhibition'],
          point: near,
        }),
        ev('gig', '2026-11-06T17:30:00Z', '2026-11-06T19:30:00Z', { point: km }),
      ],
      {},
      categories,
      app,
    );
    expect(leaveEarly.legs[0]!.verdict).toEqual({
      kind: 'leaveEarly',
      by: '2026-11-06T17:10:00.000Z',
    });

    // A market open until 20:00 when you'd arrive at 18:20.
    const openUntil = eveningQueue(
      [
        ev('gig', '2026-11-06T16:00:00Z', '2026-11-06T18:00:00Z', { point: near }),
        ev('market', '2026-11-06T15:00:00Z', '2026-11-06T19:00:00Z', {
          categoryIds: ['market'],
          point: km,
        }),
      ],
      {},
      categories,
      app,
    );
    expect(openUntil.stops.map((s) => s.event.id)).toEqual(['market', 'gig']);
    // In start order the market comes first; its leg to the gig is an overlap it can leave early from.
    expect(openUntil.legs[0]!.verdict.kind).toBe('leaveEarly');

    const until = eveningQueue(
      [
        ev('gig', '2026-11-06T14:00:00Z', '2026-11-06T18:00:00Z', { point: near }),
        ev('market', '2026-11-06T15:00:00Z', '2026-11-06T19:00:00Z', {
          categoryIds: ['market'],
          point: km,
        }),
      ],
      {},
      categories,
      app,
    );
    expect(until.legs[0]!.verdict).toEqual({ kind: 'openUntil', until: '2026-11-06T19:00:00Z' });

    const closed = eveningQueue(
      [
        ev('gig', '2026-11-06T14:00:00Z', '2026-11-06T18:50:00Z', { point: near }),
        ev('market', '2026-11-06T15:00:00Z', '2026-11-06T19:00:00Z', {
          categoryIds: ['market'],
          point: km,
        }),
      ],
      {},
      categories,
      app,
    );
    expect(closed.legs[0]!.verdict).toEqual({ kind: 'closed' });
  });

  it('a chosen leave time changes the next verdict, kept within the event', () => {
    const list = [
      ev('a', '2026-11-06T17:00:00Z', '2026-11-06T19:00:00Z', {
        categoryIds: ['theatre'],
        point: near,
      }),
      ev('b', '2026-11-06T18:30:00Z', '2026-11-06T20:00:00Z', {
        categoryIds: ['theatre'],
        point: km,
      }),
    ];
    const q = eveningQueue(list, { a: '2026-11-06T18:00:00Z' }, categories, app);
    expect(q.stops[0]).toMatchObject({ leaveAt: '2026-11-06T18:00:00.000Z', early: true });
    expect(q.legs[0]!.verdict).toEqual({ kind: 'fine', spareMin: 10 });
    const clamped = eveningQueue(list, { a: '2026-11-06T23:00:00Z' }, categories, app);
    expect(clamped.stops[0]).toMatchObject({ leaveAt: '2026-11-06T19:00:00.000Z', early: false });
  });

  it('marks a leg over the walking limit as long', () => {
    const far = { lat: 51.1 + 4.2 / 111.2, lng: 17.03 }; // 4.2 km: 68.25 min
    const q = eveningQueue(
      [
        ev('a', '2026-11-06T16:00:00Z', '2026-11-06T17:00:00Z', { point: near }),
        ev('b', '2026-11-06T20:00:00Z', '2026-11-06T21:00:00Z', { point: far }),
      ],
      {},
      categories,
      app,
    );
    expect(q.legs[0]).toMatchObject({ walkMin: 70, long: true });
  });

  it('steps a leave time on the 15-minute grid within the event', () => {
    const e = ev('a', '2026-11-06T17:10:00Z', '2026-11-06T19:00:00Z');
    expect(stepLeave(e, e.endAt, -1, 15)).toBe('2026-11-06T18:45:00.000Z');
    expect(stepLeave(e, '2026-11-06T18:50:00Z', -1, 15)).toBe('2026-11-06T18:45:00.000Z');
    expect(stepLeave(e, '2026-11-06T17:20:00Z', -1, 15)).toBe('2026-11-06T17:15:00.000Z');
    expect(stepLeave(e, '2026-11-06T17:15:00Z', -1, 15)).toBe('2026-11-06T17:10:00.000Z');
    expect(stepLeave(e, '2026-11-06T18:50:00Z', 1, 15)).toBe('2026-11-06T19:00:00.000Z');
  });
});
