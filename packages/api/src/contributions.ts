import {
  earlyAccessEnd,
  higherLevel,
  levelFor,
  localDay,
  usageMonth,
  type HappowConfig,
} from '@happow/core';
import { titleSimilarity } from '@happow/ingest/dedup';
import { z } from 'zod';
import { ApiError, body, json, sha256 } from './http.js';
import type { Supabase } from './supabase.js';

/**
 * Contributions on the server (M12 §5, slice E): rewards for events that passed moderation or were
 * published by a trusted account, per-event counts for "your impact", and the contributor's side
 * of the account. Rewards come only from the `contributions` ledger.
 */

export interface ContributionDeps {
  config: HappowConfig;
  /** The default region's time zone: months and the promotion end count there. */
  timeZone: string;
  need: () => { db: Supabase; salt: string };
  now: () => Date;
  limit: (bucket: string, actor: string, windowSeconds: number, max: number) => Promise<void>;
}

const countsSchema = z.object({
  deviceId: z.string().min(8).max(100),
  items: z
    .array(
      z.object({
        eventId: z.string().min(1).max(300),
        kind: z.enum(['open', 'route', 'arrival']),
      }),
    )
    .min(1),
});

const FIELD = { open: 'opens', route: 'routes', arrival: 'arrivals' } as const;

export function contributionRoutes({ config, timeZone, need, now, limit }: ContributionDeps) {
  const cfg = config.plans.contributions;
  const { dedup } = config.app;

  /**
   * Records a submission's reward. The same event already listed by another source (same place,
   * start within the dedup tolerance, a similar title, as ingest merges) earns nothing.
   */
  async function award(submissionId: string, eventId: string | null) {
    const { db } = need();
    let duplicateOf: string | null = null;
    if (eventId) {
      const found = await db.rpc<{ title: string; others: { id: string; title: string }[] } | null>(
        'duplicate_candidates',
        { p_event: eventId, p_radius_m: dedup.radiusM, p_minutes: dedup.startToleranceMin },
      );
      duplicateOf =
        found?.others.find((o) => titleSimilarity(found.title, o.title) >= dedup.titleSimilarity)
          ?.id ?? null;
    }
    const t = now();
    const promo = config.plans.earlyAccess;
    const promoEnd = promo?.plan === 'premium' ? earlyAccessEnd(promo, timeZone) : null;
    return db.rpc<{ kind: string; days: number; startsAt: string | null } | null>(
      'contribution_award',
      {
        p_submission: submissionId,
        p_duplicate_of: duplicateOf,
        p_per_event: cfg.premiumDaysPerEvent,
        p_cap: cfg.premiumDaysPerMonth,
        p_month: usageMonth(t, timeZone).month,
        // Days earned during the promotion start when it ends (M12 §5.2).
        p_not_before: promoEnd && promoEnd > t ? promoEnd.toISOString() : null,
      },
    );
  }

  const trusted = (userId: string) =>
    need().db.rpc<boolean>('contributor_trusted', { p_user: userId, p_after: cfg.trustedAfter });

  /** POST /api/counts {deviceId, items}: opens, routes and arrivals, totals only (M12 §5.1). */
  async function counts(req: Request): Promise<Response> {
    const { db, salt } = need();
    const input = await body(req, countsSchema);
    if (input.items.length > config.app.counts.maxBatch)
      throw new ApiError(400, 'invalid_input', 'items');
    const device = await sha256(`${salt}:device:${input.deviceId}`);
    await limit('counts', device, 3600, config.app.counts.perHourPerDevice);
    const per = new Map<
      string,
      { eventId: string; opens: number; routes: number; arrivals: number }
    >();
    for (const { eventId, kind } of input.items) {
      const row = per.get(eventId) ?? { eventId, opens: 0, routes: 0, arrivals: 0 };
      row[FIELD[kind]]++;
      per.set(eventId, row);
    }
    // The day in the region, so a late evening counts on its own date.
    const added = await db.rpc<number>('counts_add', {
      p_items: [...per.values()],
      p_day: localDay(now(), timeZone),
    });
    return json({ added }, 202);
  }

  /**
   * GET /api/me/contributions: verified events, impact totals, trusted, this month's days and the
   * level (stored as the highest reached, so it never goes down).
   */
  async function mine(userId: string) {
    const { db } = need();
    const month = usageMonth(now(), timeZone).month;
    const data = await db.rpc<{ verified: number; opens: number; level: string | null } & object>(
      'contributions_get',
      { p_user: userId, p_month: month, p_trusted_after: cfg.trustedAfter },
    );
    const reached = higherLevel(data.level, levelFor(data.verified, data.opens, cfg), cfg);
    if (reached !== data.level)
      await db.rpc('contributor_level_set', {
        p_user: userId,
        p_level: reached,
        p_order: cfg.levels.map((l) => l.id),
      });
    return {
      ...data,
      level: reached,
      premiumDaysPerEvent: cfg.premiumDaysPerEvent,
      premiumDaysPerMonth: cfg.premiumDaysPerMonth,
      trustedAfter: cfg.trustedAfter,
    };
  }

  return { award, trusted, counts, mine };
}
