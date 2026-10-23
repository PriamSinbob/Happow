import { describe, expect, it } from 'vitest';
import type { NearbyEvent } from '@happow/core';
import { pinFeatures, type PinGroup } from '../src/pins';

const center = { lat: 51.11, lng: 17.03 };
const now = new Date('2026-10-24T17:00:00Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
const ev = (id: string, over: Partial<NearbyEvent> = {}): NearbyEvent =>
  ({
    id,
    title: id,
    categoryIds: ['music'],
    startAt: at(-30),
    endAt: at(45),
    endEstimated: false,
    point: center,
    distanceM: 0,
    entry: null,
    graceMin: null,
    ageMin: null,
    family: null,
    ...over,
  }) as NearbyEvent;
const place = (key: string, events: NearbyEvent[]): PinGroup => ({
  key,
  kind: 'place',
  point: events[0]!.point,
  events,
});
const build = (groups: PinGroup[], selectedId: string | null = null) =>
  pinFeatures(groups, { now, center, radiusM: 500, selectedId }).features.map((f) => f.properties);

describe('pin features', () => {
  it('a live event: ring of time left, glyph of its category', () => {
    const [p] = build([place('a', [ev('a')])]);
    expect(p).toMatchObject({ kind: 'live', ring: 'ring-4', glyph: 'note', count: 1, age: '' });
    expect(JSON.parse(p!.ids)).toEqual(['a']);
  });
  it('soon and later pins have no ring; till-late is dotted', () => {
    const [soon, later, late] = build([
      place('s', [ev('s', { startAt: at(30), endAt: at(90) })]),
      place('l', [ev('l', { startAt: at(200), endAt: at(300) })]),
      place('d', [ev('d', { endEstimated: true })]),
    ]);
    expect(soon).toMatchObject({ kind: 'soon', ring: '' });
    expect(later).toMatchObject({ kind: 'later', ring: '' });
    expect(late!.ring).toBe('ring-dotted');
  });
  it('a place shows its most urgent event, the count and the highest age badge', () => {
    const [p] = build([
      place('v', [
        ev('later', { startAt: at(200), endAt: at(300), ageMin: 18 }),
        ev('now', { categoryIds: ['theatre'] }),
      ]),
    ]);
    expect(p).toMatchObject({ kind: 'live', glyph: 'mask', count: 2, age: '18+' });
  });
  it('a flagged single event gets the warning mark', () => {
    const flag = { reason: 'cancelled' as const, count: 2, at: at(-5) };
    expect(build([place('a', [ev('a', { flag })])])[0]!.flagged).toBe(true);
    expect(build([place('a', [ev('a')])])[0]!.flagged).toBe(false);
  });
  it('age badge only from 16+', () => {
    expect(build([place('a', [ev('a', { ageMin: 12 })])])[0]!.age).toBe('');
    expect(build([place('a', [ev('a', { ageMin: 16 })])])[0]!.age).toBe('16+');
  });
  it('draw order: selected > live > soon > later, inside over outside', () => {
    const far = { lat: 51.13, lng: 17.03 };
    const [live, soon, later, outside, selected] = build(
      [
        place('1', [ev('1')]),
        place('2', [ev('2', { startAt: at(30), endAt: at(90) })]),
        place('3', [ev('3', { startAt: at(200), endAt: at(300) })]),
        place('4', [ev('4', { point: far })]),
        place('5', [ev('5', { startAt: at(200), endAt: at(300) })]),
      ],
      '5',
    );
    expect(live!.z).toBeGreaterThan(soon!.z);
    expect(soon!.z).toBeGreaterThan(later!.z);
    expect(live!.z).toBeGreaterThan(outside!.z);
    expect(outside!.outside).toBe(true);
    expect(selected!.z).toBeGreaterThan(live!.z);
  });
});

describe('pin sprites', () => {
  it('every category has a drawn glyph', async () => {
    const { GLYPH_IDS, spriteIds } = await import('../src/pinSprites');
    const { config } = await import('../src/config');
    for (const c of config.categories) expect(GLYPH_IDS, c.id).toContain(c.glyph);
    expect(spriteIds()).toContain('ring-12');
    expect(spriteIds()).toContain('ring-dotted');
  });
});
