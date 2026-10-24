import { localDay } from './atlas.js';
import { planIdSchema } from './schemas.js';
import { localToInstant } from './time.js';
import type { Entitlements, PlanId, PlansConfig, ThemePreset } from './types.js';

/**
 * Plans and entitlements (M8 §3–§4). Code asks `can(ent, 'atlas.export')` or
 * `quota(ent, 'events.perMonth')`, never which plan someone has, so moving a feature between
 * plans is a change to config/plans.json.
 */

export const PLAN_ORDER = planIdSchema.options;

export type QuotaKey = {
  [K in keyof Entitlements]: Entitlements[K] extends number ? K : never;
}[keyof Entitlements];
export type FeatureKey = Exclude<keyof Entitlements, QuotaKey>;

/** Where the effective plan comes from: the account itself, the promotion or a grant. */
export type PlanSource = 'account' | 'early_access' | 'manual' | 'trial' | 'purchase';

/** A grant as the API reads it from plan_grants. */
export interface PlanGrant {
  plan: PlanId;
  source: 'manual' | 'trial' | 'purchase';
  startsAt: string;
  /** Null = no end. */
  endsAt: string | null;
}

export interface EffectivePlan {
  plan: PlanId;
  /** Null when signed out. */
  source: PlanSource | null;
  /** When this plan stops applying; null = no end. */
  endsAt: Date | null;
}

export const planRank = (plan: PlanId) => PLAN_ORDER.indexOf(plan);

/** The first instant after the promotion: midnight after its `until` day, in `timeZone`. */
export function earlyAccessEnd(
  earlyAccess: NonNullable<PlansConfig['earlyAccess']>,
  timeZone: string,
): Date {
  const [y, m, d] = earlyAccess.until.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return localToInstant(next, null, timeZone)!;
}

/**
 * The plan in force at `now`: anonymous when signed out; otherwise the highest of the account,
 * the promotion and the active grants. Its end is the latest end among whatever gives that plan
 * (they all hold at `now`, so together they last until the latest one ends).
 */
export function effectivePlan(input: {
  signedIn: boolean;
  grants: readonly PlanGrant[];
  now: Date;
  earlyAccess: PlansConfig['earlyAccess'];
  timeZone: string;
}): EffectivePlan {
  const { signedIn, grants, now, earlyAccess, timeZone } = input;
  if (!signedIn) return { plan: 'anonymous', source: null, endsAt: null };
  const t = now.getTime();
  const candidates: { plan: PlanId; source: PlanSource; endsAt: Date | null }[] = [
    { plan: 'account', source: 'account', endsAt: null },
  ];
  if (earlyAccess) {
    const end = earlyAccessEnd(earlyAccess, timeZone);
    if (t < end.getTime())
      candidates.push({ plan: earlyAccess.plan, source: 'early_access', endsAt: end });
  }
  for (const g of grants) {
    const endsAt = g.endsAt ? new Date(g.endsAt) : null;
    if (new Date(g.startsAt).getTime() <= t && (!endsAt || t < endsAt.getTime()))
      candidates.push({ plan: g.plan, source: g.source, endsAt });
  }
  const top = Math.max(...candidates.map((c) => planRank(c.plan)));
  const later = (a: Date | null, b: Date | null) =>
    a === null || (b !== null && a.getTime() >= b.getTime());
  const best = candidates
    .filter((c) => planRank(c.plan) === top)
    .reduce((a, b) => (later(a.endsAt, b.endsAt) ? a : b));
  return best;
}

export const entitlementsFor = (config: PlansConfig, plan: PlanId): Entitlements =>
  config.plans[plan];

export const can = (ent: Entitlements, key: FeatureKey): boolean => ent[key];

export const quota = (ent: Entitlements, key: QuotaKey): number => ent[key];

/**
 * The calendar month quotas count in (M8 §5): its first day in `timeZone` ("2026-10-01") and the
 * instant the next month starts there.
 */
export function usageMonth(now: Date, timeZone: string): { month: string; resetsAt: Date } {
  const day = localDay(now, timeZone);
  const [y, m] = day.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { month: `${day.slice(0, 7)}-01`, resetsAt: localToInstant(next, null, timeZone)! };
}

/** The live-hue presets these entitlements allow (M8 §3: presets by tier). */
export function presetsFor<P extends Pick<ThemePreset, 'tier'>>(
  ent: Entitlements,
  presets: readonly P[],
): P[] {
  return presets.filter((p) => p.tier === 'anonymous' || ent[`presets.${p.tier}`]);
}

/** Config mistakes in plans.json: a higher plan giving less than a lower one. */
export function checkPlans(config: PlansConfig): string[] {
  const errors: string[] = [];
  for (let i = 1; i < PLAN_ORDER.length; i++) {
    const lower = config.plans[PLAN_ORDER[i - 1]!];
    const higher = config.plans[PLAN_ORDER[i]!];
    for (const key of Object.keys(lower) as (keyof Entitlements)[])
      if (Number(higher[key]) < Number(lower[key]))
        errors.push(`plan "${PLAN_ORDER[i]}" gives less "${key}" than "${PLAN_ORDER[i - 1]}"`);
  }
  const until = config.earlyAccess?.until;
  const [y, m, d] = (until ?? '').split('-').map(Number) as [number, number, number];
  if (until && new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== until)
    errors.push(`earlyAccess.until "${until}" is not a date`);
  return errors;
}
