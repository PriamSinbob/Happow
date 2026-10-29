import { getRegion, type HappowConfig } from '@happow/core';
import { checkPublicUrl } from '@happow/extract';
import { z } from 'zod';
import type { User } from './accounts.js';
import { ApiError, body, json } from './http.js';
import { SupabaseError, type Supabase } from './supabase.js';

/**
 * Calendar feeds an account imports its events from (M12 §4.6, slice L). The account adds and
 * removes its own; the ingest job reads them; an admin can stop one (and start it again).
 */

export interface FeedDeps {
  config: HappowConfig;
  need: () => { db: Supabase };
  requireUser: (req: Request) => Promise<User>;
  limit: (bucket: string, actor: string, windowSeconds: number, max: number) => Promise<void>;
}

const addSchema = z.object({
  url: z.string().trim().min(8).max(500),
  regionId: z.string().optional(),
});
const statusSchema = z.object({ action: z.enum(['stop', 'resume']) });
const id = z.coerce.number().int().positive();
const noStore = { 'cache-control': 'private, no-store' };

/** "webcal://…" is how calendars hand out feeds; it is plain https. */
export function feedUrl(raw: string): string {
  const url = raw.replace(/^webcals?:\/\//i, 'https://');
  try {
    checkPublicUrl(url);
  } catch {
    throw new ApiError(400, 'unsafe_url');
  }
  return new URL(url).toString();
}

export function feedRoutes({ config, need, requireUser, limit }: FeedDeps) {
  const max = config.plans.contributions.feedsPerAccount;

  /** GET /api/me/feeds, POST /api/me/feeds {url}, DELETE /api/me/feeds/:id. */
  async function mine(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    const { db } = need();
    const list = async () =>
      json({ feeds: await db.rpc<object[]>('feeds_list', { p_user: user.id }), max }, 200, noStore);
    if (req.method === 'GET' && !path.length) return list();
    if (req.method === 'POST' && !path.length) {
      await limit('feeds', user.id, 3600, 20);
      const input = await body(req, addSchema);
      try {
        await db.rpc('feed_add', {
          p_user: user.id,
          p_url: feedUrl(input.url),
          p_region: getRegion(config, input.regionId).id,
          p_max: max,
        });
      } catch (err) {
        if (err instanceof SupabaseError && err.code === 'HQ002')
          throw new ApiError(409, 'too_many_feeds', undefined, { max });
        if (err instanceof SupabaseError && err.code === 'HQ003')
          throw new ApiError(409, 'feed_stopped');
        throw err;
      }
      return list();
    }
    if (req.method === 'DELETE' && path.length === 1 && id.safeParse(path[0]).success) {
      const gone = await db.rpc<boolean>('feed_remove', { p_user: user.id, p_id: Number(path[0]) });
      if (!gone) throw new ApiError(404, 'not_found');
      return list();
    }
    throw new ApiError(404, 'not_found');
  }

  /** POST /api/admin/feeds/:id {action: stop | resume}, admin only. */
  async function admin(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    if (user.role !== 'admin') throw new ApiError(403, 'forbidden');
    if (req.method !== 'POST' || path.length !== 1 || !id.safeParse(path[0]).success)
      throw new ApiError(404, 'not_found');
    const { action } = await body(req, statusSchema);
    try {
      return json(
        await need().db.rpc('feed_set_status', {
          p_feed: Number(path[0]),
          p_status: action === 'stop' ? 'stopped' : 'active',
          p_by: user.email,
        }),
      );
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'not_found');
      throw err;
    }
  }

  return { mine, admin };
}
