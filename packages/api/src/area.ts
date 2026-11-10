import {
  areaFrom,
  areaSlackM,
  daysBounds,
  FAR_FUTURE,
  futureStart,
  isAreaKey,
  isInBbox,
  monthStarts,
  type HappowConfig,
} from '@happow/core';
import { ApiError, sha256 } from './http.js';
import type { Supabase } from './supabase.js';

/**
 * The public, cacheable reads the map is drawn from: events and open places around a grid point.
 * Both are keyed by the same snapped grid square, so everyone in it shares one cached answer.
 */

export interface AreaDeps {
  config: HappowConfig;
  /** Null while Supabase is not configured: the routes answer 503. */
  db: Supabase | null;
  now: () => Date;
}

export function areaRoutes({ config, db, now }: AreaDeps) {
  const { refresh } = config.app;

  /** `?lat&lng&r` as a grid key inside (or just beside) a configured region; anything else is 400. */
  function areaKey(req: Request) {
    const u = new URL(req.url);
    const key = {
      lat: Number(u.searchParams.get('lat')),
      lng: Number(u.searchParams.get('lng')),
      radiusM: Number(u.searchParams.get('r')),
    };
    const region = config.regions.find((r) =>
      isInBbox(key, {
        west: r.bbox.west - refresh.areaGridDeg,
        south: r.bbox.south - refresh.areaGridDeg,
        east: r.bbox.east + refresh.areaGridDeg,
        north: r.bbox.north + refresh.areaGridDeg,
      }),
    );
    if (!Object.values(key).every(Number.isFinite) || !isAreaKey(key, refresh) || !region)
      throw new ApiError(400, 'invalid_input', 'area');
    return { u, key, region };
  }

  /** A JSON answer with an ETag of its content; a revalidation that still matches gets a 304. */
  async function cached(
    req: Request,
    body: string,
    cache: Record<string, string>,
  ): Promise<Response> {
    const etag = `"${(await sha256(body)).slice(0, 16)}"`;
    const headers = { 'content-type': 'application/json', etag, ...cache };
    if (req.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers });
  }

  /**
   * GET /api/area?lat&lng&r[&range] → every listed event within r of a grid point for the next
   * hours, or with `range` (a multi-day time window) up to the end of that window's last day; the
   * future window reads from its first day on, with no end, or one `step` of it (a month). The response is public and expires at the end of its step (5 min; 30 min for a
   * range), so Cloudflare's Workers Caching (wrangler.jsonc) answers everyone in the same grid
   * square without running this, and Supabase is asked about once per busy area per step.
   * Revalidations get a 304 via the ETag.
   */
  async function area(req: Request): Promise<Response> {
    if (!db) throw new ApiError(503, 'not_configured');
    const { u, key, region } = areaKey(req);
    const rangeId = u.searchParams.get('range');
    const range = rangeId === null ? null : config.app.timeWindows.find((w) => w.id === rangeId);
    if (range !== null && !(range && ('days' in range || 'afterDays' in range)))
      throw new ApiError(400, 'invalid_input', 'range');

    const t = now();
    const stepMinutes = range ? refresh.longCacheMinutes : refresh.dataMinutes;
    const from = areaFrom(t, stepMinutes);
    // The future window starts after the day windows and has no end.
    const future = range && 'afterDays' in range ? range : null;
    // One step of it (a month, or the last one: everything later) is read on its own, so a busy
    // year is not cut at the snapshot's size.
    const stepParam = u.searchParams.get('step');
    const step = stepParam === null ? null : Number(stepParam);
    if (step !== null && !(future && Number.isInteger(step) && step >= 0 && step <= future.months))
      throw new ApiError(400, 'invalid_input', 'step');
    const steps = future
      ? monthStarts(
          futureStart(t, region.timezone, future.afterDays),
          region.timezone,
          future.months,
        )
      : [];
    const since = future ? steps[step ?? 0]! : from;
    const to = future
      ? step === null || step === future.months
        ? FAR_FUTURE
        : new Date(steps[step + 1]!.getTime() - 1)
      : range && 'days' in range
        ? daysBounds(t, region.timezone, range.days).end
        : new Date(from.getTime() + refresh.areaHours * 3_600_000);
    // Everyone's copy expires at the same step boundary, so caches and phones refresh together.
    const expires = from.getTime() + stepMinutes * 60_000;
    const maxAge = Math.max(15, Math.round((expires - t.getTime()) / 1000));
    const events = await db.rpc<unknown>('events_area', {
      lat: key.lat,
      lng: key.lng,
      radius_m: key.radiusM + areaSlackM(key.lat, refresh),
      from_ts: since.toISOString(),
      to_ts: to.toISOString(),
      max_events: refresh.areaMaxEvents,
    });
    const body = JSON.stringify({ from: from.toISOString(), to: to.toISOString(), events });
    return cached(req, body, { 'cache-control': `public, max-age=${maxAge}` });
  }

  /**
   * GET /api/places?lat&lng&r → the places with opening hours within r of a grid point, nearest
   * first (the same grid as /api/area), with people's corrections applied. The phone works out
   * "open now" itself, so the answer is public and cached for `places.cacheMinutes`. An empty
   * answer (before the first import) is not kept anywhere, or the map would stay empty.
   */
  async function places(req: Request): Promise<Response> {
    if (!db) throw new ApiError(503, 'not_configured');
    const { key } = areaKey(req);
    const { maxPerArea, cacheMinutes } = config.app.places;
    const rows = await db.rpc<unknown>('places_area', {
      lat: key.lat,
      lng: key.lng,
      radius_m: key.radiusM + areaSlackM(key.lat, refresh),
      max_places: maxPerArea,
    });
    const body = JSON.stringify({ places: rows });
    const some = Array.isArray(rows) && rows.length > 0;
    return cached(req, body, {
      'cache-control': some ? `public, max-age=${Math.round(cacheMinutes * 60)}` : 'no-store',
      // The service worker keeps only answers with this header.
      ...(some ? { 'x-places': 'some' } : {}),
    });
  }

  return { area, places };
}
