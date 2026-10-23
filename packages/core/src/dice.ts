import type { HappowEvent } from './types.js';

/** Per-category weights on this device (§7): re-rolls lower one, opens and Going there raise it. */
export type DiceWeights = Record<string, number>;
export type DiceSignal = 'reroll' | 'open' | 'go';

const FACTOR: Record<DiceSignal, number> = { reroll: 0.7, open: 1.2, go: 1.5 };
const MIN_WEIGHT = 0.2;
const MAX_WEIGHT = 5;

/** The category a roll counts against: the event's first one. */
export const diceCategory = (e: Pick<HappowEvent, 'categoryIds'>) => e.categoryIds[0] ?? 'other';

export function reweigh(weights: DiceWeights, category: string, signal: DiceSignal): DiceWeights {
  const w = (weights[category] ?? 1) * FACTOR[signal];
  return { ...weights, [category]: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w)) };
}

/**
 * Who can be rolled (§7): live, or starting within `soonMin` (only live with live-only on), within
 * `maxDistanceM`, and worth going to (`late` says the user would arrive too late).
 */
export function dicePool<T extends Pick<HappowEvent, 'startAt' | 'endAt'> & { distanceM: number }>(
  events: T[],
  now: Date,
  opts: { maxDistanceM: number; soonMin: number; liveOnly: boolean; late: (e: T) => boolean },
): T[] {
  const t = now.getTime();
  const soon = t + (opts.liveOnly ? 0 : opts.soonMin * 60_000);
  return events.filter(
    (e) =>
      e.distanceM <= opts.maxDistanceM &&
      Date.parse(e.startAt) <= soon &&
      Date.parse(e.endAt) > t &&
      !opts.late(e),
  );
}

/**
 * One weighted roll. Nothing shown this session comes back until every candidate has been shown;
 * then the cycle starts over, skipping only the last one. `category` narrows the roll (long-press).
 */
export function rollDice<T extends Pick<HappowEvent, 'id' | 'categoryIds'>>(
  pool: T[],
  state: { seen: readonly string[]; weights: DiceWeights; category?: string },
  random: () => number = Math.random,
): T | null {
  const inCategory = state.category
    ? pool.filter((e) => e.categoryIds.includes(state.category!))
    : pool;
  let candidates = inCategory.filter((e) => !state.seen.includes(e.id));
  if (!candidates.length) {
    const last = state.seen[state.seen.length - 1];
    candidates = inCategory.filter((e) => e.id !== last);
  }
  if (!candidates.length) return inCategory[0] ?? null;
  const w = candidates.map((e) => state.weights[diceCategory(e)] ?? 1);
  let r = random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= w[i]!;
    if (r < 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

/** The user's top categories for the long-press fan: by weight, ties in config order. */
export function topCategories(ids: readonly string[], weights: DiceWeights, n: number): string[] {
  return ids
    .map((id, i) => ({ id, i, w: weights[id] ?? 1 }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, n)
    .map((c) => c.id);
}

/** The reach after a roll: unchanged when the event is inside it, else the first detent ≥ margin × distance. */
export function reachForRoll(
  distanceM: number,
  radiusM: number,
  detentsM: readonly number[],
  margin: number,
): number {
  if (distanceM <= radiusM) return radiusM;
  return detentsM.find((d) => d >= distanceM * margin) ?? detentsM[detentsM.length - 1]!;
}
