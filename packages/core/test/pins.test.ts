import { describe, expect, it } from 'vitest';
import { loadConfig, pinState, ringStep, type HappowEvent } from '../src';

const { app, categories } = loadConfig();
const now = new Date('2026-10-24T17:00:00Z');
type Ev = Parameters<typeof pinState>[0];
const ev = (over: Partial<Ev> = {}): Ev => ({
  startAt: '2026-10-24T16:00:00Z',
  endAt: '2026-10-24T19:00:00Z',
  endEstimated: false,
  categoryIds: ['market'],
  entry: null,
  graceMin: null,
  ...over,
});
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

describe('ringStep', () => {
  const step = (left: number) => ringStep({ endAt: at(left) } as Pick<HappowEvent, 'endAt'>, now);
  it('is full at two hours or more, then 10-minute steps, with a stub until the end', () => {
    expect(step(300)).toBe(12);
    expect(step(120)).toBe(12);
    expect(step(119)).toBe(11);
    expect(step(60)).toBe(6);
    expect(step(9)).toBe(1);
    expect(step(1)).toBe(1);
  });
});

describe('pinState', () => {
  const s = (over: Partial<Ev>, distance = 100, radius = 500) =>
    pinState(ev(over), now, distance, radius, categories, app);
  it('live: running now, with a ring of time left', () => {
    expect(s({})).toMatchObject({ kind: 'live', ring: 12, dotted: false, outside: false });
    expect(s({ endAt: at(45) }).ring).toBe(4);
  });
  it('no fixed end: a dotted full ring', () => {
    expect(s({ endAt: at(30), endEstimated: true })).toMatchObject({ ring: 12, dotted: true });
  });
  it('soon within 60 minutes, later after that; no ring', () => {
    expect(s({ startAt: at(60), endAt: at(120) })).toMatchObject({ kind: 'soon', ring: null });
    expect(s({ startAt: at(61), endAt: at(120) }).kind).toBe('later');
  });
  it('outside the radius', () => {
    expect(s({}, 900, 500).outside).toBe(true);
  });
  it('late: a theatre play already 10 min in, 400 m away', () => {
    const play = { categoryIds: ['theatre'], startAt: at(-10), endAt: at(100) };
    expect(s(play, 400).late).toBe(true);
    // Open entry is never late while it runs.
    expect(s({}, 400).late).toBe(false);
  });
  it('sort keys: live < soon < later, outside after inside', () => {
    const keys = [
      s({}).sortKey,
      s({ startAt: at(30), endAt: at(90) }).sortKey,
      s({ startAt: at(200), endAt: at(300) }).sortKey,
      s({}, 900).sortKey,
    ];
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(new Set(keys).size).toBe(4);
  });
});
