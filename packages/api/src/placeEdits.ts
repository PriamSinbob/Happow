import {
  getRegion,
  isInBbox,
  parseOpeningHours,
  placeKindTag,
  type HappowConfig,
  type PlacePhotoResult,
  type PlacePrefill,
} from '@happow/core';
import { checkPublicUrl, type Extractor } from '@happow/extract';
import { z } from 'zod';
import type { User } from './accounts.js';
import {
  ApiError,
  body,
  checkPass,
  deviceHash,
  deviceId,
  issuePass,
  json,
  type Limit,
  type Need,
} from './http.js';
import { SupabaseError } from './supabase.js';

/**
 * Places people add and correct. They show at once (no moderation first): every change is logged
 * with who made it (the account, or the hashed device), with daily limits for each. Closed for
 * good is the exception: it is a report, made at the place, and the place leaves the map only
 * after `places.closed.reports` accounts reported it (or a moderator did). Reports go to the
 * moderators' queue (moderation.ts).
 * An account adds and corrects freely. Without one, a place comes only from a photo of its door:
 * POST /api/places/photo reads it and hands out a pass, good for one place (a new one, or new
 * hours for one already listed) from that device.
 */

export interface PlaceEditDeps {
  config: HappowConfig;
  need: Need;
  requireUser: (req: Request) => Promise<User>;
  optionalUser: (req: Request) => Promise<User | null>;
  limit: Limit;
  clientHash: (req: Request, salt: string) => Promise<string>;
  now: () => Date;
  /** Null while no LLM key is set: photos then can't be read. */
  extractor: Extractor | null;
}

const PASS = 'place-photo';

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
  /** Without an account: the device and the pass from its photo read. */
  deviceId: deviceId.optional(),
  photoPass: z.string().max(100).optional(),
});
/** Exactly one correction per call. */
const changeSchema = z
  .object({
    id: z.string().min(3).max(80),
    openingHours: hours.optional(),
    closed: z.boolean().optional(),
    /** A private party until then; null: it is over. */
    privateUntil: z.string().datetime().nullable().optional(),
    /** With `closed: true`: where the phone is, which must be at the place. */
    at: z.object({ lat: z.number(), lng: z.number() }).optional(),
    deviceId: deviceId.optional(),
    photoPass: z.string().max(100).optional(),
  })
  .refine(
    (v) => [v.openingHours, v.closed, v.privateUntil].filter((x) => x !== undefined).length === 1,
    'one change',
  );

export function placeEditRoutes({
  config,
  need,
  requireUser,
  optionalUser,
  limit,
  clientHash,
  now,
  extractor,
}: PlaceEditDeps) {
  const cfg = config.app.places;
  const { maxBytes } = config.app.extraction.photo;

  /**
   * The activated account, or null for a caller that may go on with a photo pass. A waiting
   * account that sends no pass is told to activate, as before passes existed.
   */
  async function caller(req: Request): Promise<User | null> {
    const user = await optionalUser(req);
    if (user || !req.headers.has('authorization')) return user;
    const sent = (await req
      .clone()
      .json()
      .catch(() => null)) as { photoPass?: unknown } | null;
    if (!sent?.photoPass) await requireUser(req);
    return null;
  }

  /**
   * Who a change is by: the account, or (without one) the device whose photo pass is genuine,
   * fresh and unused, within its daily limit. The pass is used up here, so call this last.
   */
  async function author(
    user: User | null,
    input: { deviceId?: string; photoPass?: string },
  ): Promise<{ user: string | null; device: string | null }> {
    if (user) return { user: user.id, device: null };
    const { db, salt } = need();
    if (!input.deviceId || !input.photoPass) throw new ApiError(401, 'photo_required');
    const device = await deviceHash(salt, input.deviceId);
    const id = await checkPass(salt, PASS, device, input.photoPass, now());
    if (!id) throw new ApiError(401, 'photo_required');
    await limit('place-device', device, 86_400, cfg.photo.perDayPerDevice);
    const fresh = await db.rpc<boolean>('rate_limit_hit', {
      p_bucket: 'place-pass',
      p_actor: id,
      p_window_seconds: cfg.photo.passMinutes * 60,
      p_max: 1,
    });
    if (!fresh) throw new ApiError(401, 'photo_required');
    return { user: null, device };
  }

  /**
   * POST /api/places/photo {image, mediaType, deviceId, regionId?}: one photo of a place's door,
   * shrunk on the device, read into the add-place form, with where in the photo each field was
   * read. The photo is passed on to be read and is not stored. → PlacePhotoResult.
   */
  async function photo(req: Request): Promise<Response> {
    const { db, salt } = need();
    const user = await optionalUser(req);
    // Base64 grows by a third; anything well past that is refused before it is read.
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > Math.ceil(maxBytes * 1.4) + 2048) throw new ApiError(413, 'photo_too_large');
    const input = await body(
      req,
      z.object({
        image: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
        mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        deviceId,
        regionId: z.string().optional(),
      }),
    );
    if (Math.floor((input.image.length * 3) / 4) > maxBytes)
      throw new ApiError(413, 'photo_too_large');
    const device = await deviceHash(salt, input.deviceId);
    await limit('place-photo', user?.id ?? device, 3600, cfg.photo.readsPerHour);
    if (!user)
      await limit(
        'place-photo-net',
        await clientHash(req, salt),
        86_400,
        cfg.photo.readsPerDayPerNetwork,
      );
    const region = getRegion(config, input.regionId);
    // The same global daily budget as the poster photo: it bounds the bill.
    if (
      !extractor?.extractPlace ||
      !(await db.rpc<boolean>('rate_limit_hit', {
        p_bucket: 'autofill-llm',
        p_actor: 'global',
        p_window_seconds: 86_400,
        p_max: config.app.extraction.autofillLlmPerDay,
      }))
    )
      throw new ApiError(503, 'photo_unavailable');
    let read = null;
    try {
      read = await extractor.extractPlace({
        data: input.image,
        mediaType: input.mediaType,
        kinds: cfg.kinds.map((k) => ({ id: k.tag, label: k.labels[region.locale] })),
      });
    } catch (err) {
      console.error('place photo failed', (err as Error).message);
    }
    if (!read) return json({ place: null, pass: null } satisfies PlacePhotoResult);
    const place: PlacePrefill = {
      name: read.name,
      kind: read.kind,
      openingHours: read.openingHours,
      address: read.street
        ? [read.street, read.houseNumber].filter(Boolean).join(' ')
        : read.houseNumber,
      website: read.website,
      marks: read.boxes,
    };
    const expires = new Date(now().getTime() + cfg.photo.passMinutes * 60_000);
    return json({
      place,
      pass: await issuePass(salt, PASS, device, expires),
    } satisfies PlacePhotoResult);
  }

  /**
   * POST /api/places {name, kind, point, openingHours, address?, website?, deviceId?, photoPass?}
   * → {id}. With an account, or with the pass from a photo read.
   */
  async function add(req: Request): Promise<Response> {
    const user = await caller(req);
    const { db } = need();
    const input = await body(req, addSchema);
    const region = getRegion(config, input.regionId);
    // An app with older config may still send a merged kind ("amenity=bar"): stored as the pub.
    const kind = placeKindTag(cfg.kinds, input.kind);
    if (!kind) throw new ApiError(400, 'invalid_input', 'kind');
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
    if (user) await limit('place-add', user.id, 86_400, cfg.addsPerDayPerAccount);
    const by = await author(user, input);
    const id = await db.rpc<string>('place_add', {
      p_user: by.user,
      p_device: by.device,
      p_region: region.id,
      p_name: input.name,
      p_kind: kind,
      p_lat: input.point.lat,
      p_lng: input.point.lng,
      p_address: input.address ?? null,
      p_website: website,
      p_hours: input.openingHours,
      p_same_m: cfg.sameWithinM,
    });
    return json({ id }, 201);
  }

  /**
   * POST /api/places/change {id, openingHours | closed | privateUntil} → {ok}. Without an account
   * only new hours, with the pass from a photo read. `closed: true` with `at` (the phone's
   * position) reports it closed for good → {ok, closed, reports, needed}; `closed: false` says it
   * is still open and clears the reports.
   */
  async function change(req: Request): Promise<Response> {
    const user = await caller(req);
    const { db } = need();
    const input = await body(req, changeSchema);
    if (!user && input.openingHours === undefined) await requireUser(req);
    if (user && input.closed !== undefined) return closed(user, input.id, input.closed, input.at);
    let until: string | null = null;
    if (input.privateUntil) {
      const at = Date.parse(input.privateUntil);
      const t = now().getTime();
      if (at <= t || at > t + cfg.privateMaxHours * 3_600_000)
        throw new ApiError(400, 'invalid_input', 'privateUntil');
      until = new Date(at).toISOString();
    }
    if (user) await limit('place-change', user.id, 86_400, cfg.changesPerDayPerAccount);
    const by = await author(user, input);
    try {
      await db.rpc('place_change', {
        p_user: by.user,
        p_device: by.device,
        p_place: input.id,
        p_hours: input.openingHours ?? null,
        p_closed: input.closed ?? null,
        p_private: input.privateUntil === undefined ? null : input.privateUntil !== null,
        p_private_until: until,
      });
      // New hours say the place is open: any closed-for-good reports are cleared.
      if (input.openingHours !== undefined)
        await db.rpc('place_reports_clear', {
          p_user: by.user,
          p_place: input.id,
          p_reopen: false,
        });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'not_found');
      throw err;
    }
    return json({ ok: true });
  }

  /**
   * Closed for good, from an account: a report from within `places.closed.withinM` of the place
   * (a moderator's closes it at once), or "still open", which clears the reports (and, from a
   * moderator, opens a closed place again).
   */
  async function closed(
    user: User,
    id: string,
    isClosed: boolean,
    at: { lat: number; lng: number } | undefined,
  ): Promise<Response> {
    const { db } = need();
    const rule = cfg.closed;
    await limit('place-change', user.id, 86_400, cfg.changesPerDayPerAccount);
    try {
      if (!isClosed) {
        await db.rpc('place_reports_clear', {
          p_user: user.id,
          p_place: id,
          p_reopen: user.role !== null,
        });
        return json({ ok: true });
      }
      if (!at) throw new ApiError(400, 'invalid_input', 'at');
      const done = await db.rpc<{
        closed: boolean;
        reports: number;
        distanceM: number;
        tooFar: boolean;
      }>('place_report_closed', {
        p_user: user.id,
        p_place: id,
        p_lat: at.lat,
        p_lng: at.lng,
        p_within_m: rule.withinM,
        p_needed: rule.reports,
        p_days: rule.days,
        p_now: user.role !== null,
      });
      if (done.tooFar)
        throw new ApiError(400, 'too_far', undefined, {
          withinM: rule.withinM,
          distanceM: done.distanceM,
        });
      return json({ ok: true, closed: done.closed, reports: done.reports, needed: rule.reports });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'not_found');
      throw err;
    }
  }

  return { photo, add, change };
}
