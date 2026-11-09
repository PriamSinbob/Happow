import type { PlansConfig } from './types.js';

/** Rewards for adding events, from `contributions` in config/plans.json. */
export type ContributionsConfig = PlansConfig['contributions'];

/**
 * The highest level whose thresholds are both met, or null below the first. Callers keep the
 * highest level ever reached: levels only go up (no streaks, nothing to lose).
 */
export function levelFor(events: number, opens: number, cfg: ContributionsConfig): string | null {
  let level: string | null = null;
  for (const l of cfg.levels) if (events >= l.events && opens >= l.opens) level = l.id;
  return level;
}

/** The higher of two levels in config order (a stored best and a new one). */
export function higherLevel(
  a: string | null,
  b: string | null,
  cfg: ContributionsConfig,
): string | null {
  const rank = (id: string | null) => (id === null ? -1 : cfg.levels.findIndex((l) => l.id === id));
  return rank(b) > rank(a) ? b : a;
}
