import { useEffect, useMemo, useRef, useState } from 'react';
import {
  diceCategory,
  dicePool,
  pinState,
  reweigh,
  rollDice,
  topCategories,
  type DiceSignal,
  type DiceWeights,
  type NearbyEvent,
} from '@happow/core';
import { config } from '../config';
import { storage } from '../storage';

function savedWeights(): DiceWeights {
  try {
    const v: unknown = JSON.parse(storage.get('diceWeights') ?? '{}');
    return v && typeof v === 'object' ? (v as DiceWeights) : {};
  } catch {
    return {};
  }
}

/**
 * The dice: a random event worth going to. Category weights live on this device and follow what
 * the person does with a roll (opens it, goes there, rolls again); nothing repeats in a session.
 *
 * Events reported cancelled or moved are never rolled. The pool widens until it has something:
 * close and soon first, then anywhere in the loaded area, then anything still to come in the
 * range shown. Only when all three are empty does a roll find nothing.
 */
export function useDice({
  events,
  now,
  radiusM,
  liveOnly,
}: {
  /** Everything loaded, in the reach and beyond it, with this device's reports applied. */
  events: NearbyEvent[];
  now: Date;
  radiusM: number;
  liveOnly: boolean;
}) {
  const [weights, setWeights] = useState(savedWeights);
  useEffect(() => storage.set('diceWeights', JSON.stringify(weights)), [weights]);
  const seen = useRef<string[]>([]);
  const [rolledId, setRolledId] = useState<string | null>(null);

  const pools = useMemo(() => {
    const candidates = events.filter((e) => !e.flag);
    const late = (e: NearbyEvent) =>
      pinState(e, now, e.distanceM, radiusM, config.categories, config.app).late;
    const pool = (maxDistanceM: number, soonMin: number) =>
      dicePool(candidates, now, { maxDistanceM, soonMin, liveOnly, late });
    const { maxDistanceM, soonMin } = config.app.dice;
    return [pool(maxDistanceM, soonMin), pool(Infinity, soonMin), pool(Infinity, Infinity)];
  }, [events, now, liveOnly, radiusM]);
  const poolNow = pools.find((p) => p.length > 0) ?? [];

  /**
   * One roll, of one category when given. `openId` is the event whose card is open: rolling again
   * while the last result is still open counts as "not this one". Null when nothing can be rolled.
   */
  function roll(category: string | undefined, openId: string | null): NearbyEvent | null {
    const pool =
      pools.find((p) => (category ? p.some((e) => e.categoryIds.includes(category)) : p.length)) ??
      [];
    let next = weights;
    const last = rolledId === openId ? pool.find((e) => e.id === rolledId) : undefined;
    if (last) {
      next = reweigh(next, diceCategory(last), 'reroll');
      setWeights(next);
    }
    const e = rollDice(pool, { seen: seen.current, weights: next, category });
    if (!e) return null;
    seen.current = [...seen.current, e.id];
    setRolledId(e.id);
    return e;
  }

  /** Opening the rolled event or going there raises its category. */
  function signal(e: NearbyEvent | undefined, s: DiceSignal) {
    if (e && e.id === rolledId) setWeights((w) => reweigh(w, diceCategory(e), s));
  }

  /** The categories the dice can roll right now, heaviest first (the hold grid). */
  const categories = topCategories(
    config.categories
      .map((c) => c.id)
      .filter((id) => poolNow.some((e) => e.categoryIds.includes(id))),
    weights,
    config.app.dice.fanSize,
  );

  return { roll, signal, categories };
}
