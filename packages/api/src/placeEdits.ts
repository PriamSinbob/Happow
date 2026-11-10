import { getRegion, isInBbox, parseOpeningHours, type HappowConfig } from '@happow/core';
import { checkPublicUrl } from '@happow/extract';
import { z } from 'zod';
import type { User } from './accounts.js';
import { ApiError, body, json } from './http.js';
import { SupabaseError, type Supabase } from './supabase.js';

/**
 * Places people add and correct. Both need an account and show at once (no moderation):
 * every change is logged with who made it, and each account has a daily limit.
 */

export interface PlaceEditDeps {
  config: HappowConfig;
  need: () => { db: Supabase };
  requireUser: (req: Request) => Promise<User>;
  limit: (bucket: string, actor: string, windowSeconds: number, max: number) => Promise<void>;
  now: () => Date;
}

/** Hours this app can read: anything else could never show as open. */
const hours = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => parseOpeningHours(v)?.some((d) => d.length) ?? false, 'openingHours');
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

const addSchema = z.object({
  regionId: z.string().optional(),
  name: z.string().trim().min(2).max(140),
  kind: z.string(),
  point: z.object({ lat: z.number(), lng: z.number() }),
  openingHours: hours,
  address: text(200),
  website: text(500),
});
/** Exactly one correction per call. */
const changeSchema = z
  .object({
    id: z.string().min(3).max(80),
    openingHours: hours.optional(),
    closed: z.boolean().optional(),
    /** A private party until then; null: it is over. */
    privateUntil: z.string().datetime().nullable().optional(),
  })
  .refine(
    (v) => [v.openingHours, v.closed, v.privateUntil].filter((x) => x !== undefined).length === 1,
    'one change',
  );

export function placeEditRoutes({ config, need, requireUser, limit, now }: PlaceEditDeps) {
  const cfg = config.app.places;

  /** POST /api/places {name, kind, point, openingHours, address?, website?} → {id}. */
  async function add(req: Request): Promise<Response> {
    const user = await requireUser(req);
    const { db } = need();
    const input = await body(req, addSchema);
    const region = getRegion(config, input.regionId);
    if (!cfg.kinds.some((k) => k.tag === input.kind))
      throw new ApiError(400, 'invalid_input', 'kind');
    if (!isInBbox(input.point, region.bbox)) throw new ApiError(400, 'outside_region');
    let website: string | null = null;
    if (input.website) {
      const url = /^https?:\/\//i.test(input.website) ? input.website : `https://${input.website}`;
      try {
        checkPublicUrl(url);
        website = new URL(url).toString();
      } catch {
        throw new ApiError(400, 'unsafe_url');
      }
    }
    await limit('place-add', user.id, 86_400, cfg.addsPerDayPerAccount);
    const id = await db.rpc<string>('place_add', {
      p_user: user.id,
      p_region: region.id,
      p_name: input.name,
      p_kind: input.kind,
      p_lat: input.point.lat,
      p_lng: input.point.lng,
      p_address: input.address ?? null,
      p_website: website,
      p_hours: input.openingHours,
      p_same_m: cfg.sameWithinM,
    });
    return json({ id }, 201);
  }

  /** POST /api/places/change {id, openingHours | closed | privateUntil} → {ok}. */
  async function change(req: Request): Promise<Response> {
    const user = await requireUser(req);
    const { db } = need();
    const input = await body(req, changeSchema);
    let until: string | null = null;
    if (input.privateUntil) {
      const at = Date.parse(input.privateUntil);
      const t = now().getTime();
      if (at <= t || at > t + cfg.privateMaxHours * 3_600_000)
        throw new ApiError(400, 'invalid_input', 'privateUntil');
      until = new Date(at).toISOString();
    }
    await limit('place-change', user.id, 86_400, cfg.changesPerDayPerAccount);
    try {
      await db.rpc('place_change', {
        p_user: user.id,
        p_place: input.id,
        p_hours: input.openingHours ?? null,
        p_closed: input.closed ?? null,
        p_private: input.privateUntil === undefined ? null : input.privateUntil !== null,
        p_private_until: until,
      });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'not_found');
      throw err;
    }
    return json({ ok: true });
  }

  return { add, change };
}
