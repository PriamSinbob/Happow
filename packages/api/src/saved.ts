import { can, type Entitlements, type HappowConfig } from '@happow/core';
import { z } from 'zod';
import type { User } from './accounts.js';
import { ApiError, body, json, type Limit, noStore, type Need } from './http.js';

/**
 * Saved events across an account's devices. A device sends its whole list,
 * removals included; the server merges it into the account's (latest change per event wins) and
 * answers with the result, which the device then keeps. An empty list is a pull.
 */

export interface SavedDeps {
  config: HappowConfig;
  need: Need;
  requireUser: (req: Request) => Promise<User>;
  planOf: (user: { id: string }) => Promise<{ entitlements: Entitlements }>;
  limit: Limit;
}

export function savedRoutes({ config, need, requireUser, planOf, limit }: SavedDeps) {
  const { maxSaved, keepRemovedDays, syncPerHour } = config.app.agenda;
  const schema = z.object({
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          on: z.boolean(),
          going: z.boolean().default(false),
          at: z.number().int().nonnegative(),
        }),
      )
      // Saved ones plus the removals a device still remembers.
      .max(maxSaved * 3),
  });

  /** POST /api/me/saved {items} → {items}: the account's merged list. */
  return async function saved(req: Request, path: string[]): Promise<Response> {
    if (req.method !== 'POST' || path.length) throw new ApiError(404, 'not_found');
    const user = await requireUser(req);
    if (!can((await planOf(user)).entitlements, 'saved.sync'))
      throw new ApiError(403, 'forbidden', 'saved.sync is not in this plan');
    await limit('saved', user.id, 3600, syncPerHour);
    const { items } = await body(req, schema);
    const merged = await need().db.rpc<unknown[]>('saved_sync', {
      p_user: user.id,
      p_items: items,
      p_keep_removed_days: keepRemovedDays,
      p_max: maxSaved,
    });
    return json({ items: merged }, 200, noStore);
  };
}
