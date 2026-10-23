import { describe, expect, it } from 'vitest';
import {
  dicePool,
  loadConfig,
  priceFromToggles,
  priceToggles,
  reachForRoll,
  reweigh,
  rollDice,
  topCategories,
} from '../src';

const { app } = loadConfig();
const now = new Date('2026-10-23T14:10:00Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
const ev = (id: string, cat: string, start: number, end: number, distanceM = 500) => ({
  id,
  categoryIds: [cat],
  startAt: at(start),
  endAt: at(end),
  distanceM,
});

describe('dice pool', () => {
  const opts = { ...app.dice, liveOnly: false, late: () => false };
  const events = [
    ev('live', 'music', -30, 60),
    ev('soon', 'music', 45, 120),
    ev('later', 'music', 90, 180),
    ev('over', 'music', -120, -10),
    ev('far', 'music', -30, 60, 2500),
  ];
  it('takes live events and those starting within 60 min, within 2 km', () => {
    expect(dicePool(events, now, opts).map((e) => e.id)).toEqual(['live', 'soon']);
  });
  it('live-only keeps only what is on now; late arrivals are left out', () => {
    expect(dicePool(events, now, { ...opts, liveOnly: true }).map((e) => e.id)).toEqual(['live']);
    expect(
      dicePool(events, now, { ...opts, late: (e) => e.id === 'live' }).map((e) => e.id),
    ).toEqual(['soon']);
  });
});

describe('rolling', () => {
  const pool = [ev('a', 'music', 0, 60), ev('b', 'food', 0, 60), ev('c', 'food', 0, 60)];
  it('never repeats until every event has been shown, then skips only the last one', () => {
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) seen.push(rollDice(pool, { seen, weights: {} }, () => 0.5)!.id);
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    expect(rollDice(pool, { seen, weights: {} }, () => 0.99)!.id).not.toBe(seen[2]);
  });
  it('picks by category weight', () => {
    // music 0.2 vs food 1 + 1: a roll at 5% of the total lands on music, at 50% on food.
    const weights = { music: 0.2 };
    expect(rollDice(pool, { seen: [], weights }, () => 0.05)!.id).toBe('a');
    expect(rollDice(pool, { seen: [], weights }, () => 0.5)!.categoryIds).toEqual(['food']);
  });
  it('a long-press roll stays in its category; an empty pool rolls nothing', () => {
    expect(rollDice(pool, { seen: [], weights: {}, category: 'music' }, () => 0.9)!.id).toBe('a');
    expect(rollDice([], { seen: [], weights: {} })).toBeNull();
  });
  it('re-rolls lower a category, opens and Going there raise it, within bounds', () => {
    let w = reweigh({}, 'music', 'reroll');
    expect(w.music).toBeCloseTo(0.7);
    w = reweigh(w, 'food', 'go');
    expect(w.food).toBeCloseTo(1.5);
    for (let i = 0; i < 20; i++) w = reweigh(w, 'music', 'reroll');
    expect(w.music).toBe(0.2);
    expect(topCategories(['music', 'theatre', 'food'], w, 2)).toEqual(['food', 'theatre']);
  });
  it('widens the reach to the first detent at 1.15 × the distance', () => {
    const { detentsM } = app.radius;
    expect(reachForRoll(400, 500, detentsM, app.dice.reachMargin)).toBe(500);
    expect(reachForRoll(800, 500, detentsM, app.dice.reachMargin)).toBe(1000);
    expect(reachForRoll(900, 250, detentsM, app.dice.reachMargin)).toBe(2000);
    expect(reachForRoll(1900, 500, detentsM, app.dice.reachMargin)).toBe(5000);
  });
});

describe('price toggles (§15)', () => {
  it('both on means any; the last one on cannot go off', () => {
    expect(priceToggles('any')).toEqual({ free: true, paid: true });
    expect(priceToggles('free')).toEqual({ free: true, paid: false });
    expect(priceFromToggles(true, true)).toBe('any');
    expect(priceFromToggles(false, true)).toBe('paid');
    expect(priceFromToggles(false, false)).toBeNull();
  });
});
