import { z } from 'zod';
import { ApiError, body, json } from './http.js';
import type { Supabase } from './supabase.js';

/**
 * Ways to buy premium (M8 §4). A provider only turns its own purchases into grants; entitlements
 * never ask which provider sold them, so premium bought on the web works in the native apps and
 * the other way round. M8 ships none (`premium.providers: []`): no offers, no buy button.
 */

export interface UserRef {
  id: string;
  email: string;
}

export interface Offer {
  id: string;
  plan: 'premium';
  period: 'month' | 'year';
  /** In the currency's main unit (12.99 = 12,99 zł). */
  price: number;
  currency: string;
}

/** A purchase as the provider sees it now: paid, renewed, cancelled (to the period end), refunded. */
export interface GrantChange {
  userId: string;
  plan: 'account' | 'premium';
  /** The provider's id for the purchase (subscription, order); one grant per id. */
  providerRef: string;
  startsAt: string;
  /** End of the paid period; now for a refund. */
  endsAt: string;
}

export interface PremiumProvider {
  id: string;
  offers(): Promise<Offer[]>;
  /** Web: a page to pay on, which returns to `returnUrl`. */
  checkout?(user: UserRef, offerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Native: a store purchase token, checked with the store. */
  verify?(user: UserRef, receipt: string): Promise<GrantChange[]>;
  /** Signed notifications from the provider; throws ApiError(401) on a bad signature. */
  webhook?(req: Request): Promise<GrantChange[]>;
  /** Where the user cancels or changes the purchase. */
  manageUrl?(user: UserRef): Promise<string | null>;
}

/** Providers by their id in config/app.json → premium.providers. A provider slice adds its own. */
export const providerFactories: Record<
  string,
  (env: Record<string, string | undefined>) => PremiumProvider
> = {};

export function premiumProviders(
  ids: readonly string[],
  env: Record<string, string | undefined>,
): PremiumProvider[] {
  return ids.map((id) => {
    const make = providerFactories[id];
    if (!make) throw new Error(`premium.providers: unknown provider "${id}"`);
    return make(env);
  });
}

export interface PremiumDeps {
  providers: readonly PremiumProvider[];
  need: () => { db: Supabase };
  requireUser: (req: Request) => Promise<UserRef>;
  /** The user's plan after a change, as /api/me shows it. */
  planOf: (user: UserRef) => Promise<object>;
}

const id = z.string().min(1).max(100);
const checkoutSchema = z.object({ provider: id, offerId: id }).strict();
const verifySchema = z.object({ provider: id, receipt: z.string().min(1).max(10_000) }).strict();

/** /api/premium/{offers, checkout, verify, webhook/:provider}. */
export function premiumRoutes({ providers, need, requireUser, planOf }: PremiumDeps) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const provider = (pid: string | undefined) => {
    const p = pid === undefined ? undefined : byId.get(pid);
    if (!p) throw new ApiError(404, 'not_found');
    return p;
  };

  async function apply(p: PremiumProvider, changes: readonly GrantChange[]) {
    const { db } = need();
    for (const c of changes)
      await db.rpc('grant_apply', {
        p_user: c.userId,
        p_plan: c.plan,
        p_provider: p.id,
        p_ref: c.providerRef,
        p_starts_at: c.startsAt,
        p_ends_at: c.endsAt,
      });
  }

  return async function premium(req: Request, path: string[]): Promise<Response> {
    const [action, pid, ...rest] = path;
    if (req.method === 'GET' && action === 'offers' && path.length === 1) {
      const offers = await Promise.all(
        providers.map(async (p) => (await p.offers()).map((o) => ({ ...o, provider: p.id }))),
      );
      return json({ offers: offers.flat() });
    }
    if (req.method !== 'POST') throw new ApiError(404, 'not_found');
    if (action === 'checkout' && path.length === 1) {
      const user = await requireUser(req);
      const input = await body(req, checkoutSchema);
      const p = provider(input.provider);
      if (!p.checkout) throw new ApiError(404, 'not_found');
      // Back to the app the user paid from, never to a URL the client names.
      return json(await p.checkout(user, input.offerId, `${new URL(req.url).origin}/`));
    }
    if (action === 'verify' && path.length === 1) {
      const user = await requireUser(req);
      const input = await body(req, verifySchema);
      const p = provider(input.provider);
      if (!p.verify) throw new ApiError(404, 'not_found');
      // A receipt only ever gives the user who sent it a plan.
      const changes = (await p.verify(user, input.receipt)).map((c) => ({ ...c, userId: user.id }));
      await apply(p, changes);
      return json(await planOf(user));
    }
    if (action === 'webhook' && !rest.length) {
      const p = provider(pid);
      if (!p.webhook) throw new ApiError(404, 'not_found');
      await apply(p, await p.webhook(req));
      return json({ ok: true });
    }
    throw new ApiError(404, 'not_found');
  };
}
