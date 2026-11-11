import {
  can,
  getRegion,
  isInBbox,
  normName,
  type Entitlements,
  type EventHit,
  type HappowConfig,
  type NationwideDate,
  type Region,
} from '@happow/core';
import { z } from 'zod';
import type { User } from './accounts.js';
import { ApiError, body, json, type Limit, noStore, type Need } from './http.js';
import type { Supabase } from './supabase.js';

/**
 * Search and followed artists.
 * - GET /api/search?q=&lat=&lng=&region= — typo-tolerant search of the region's upcoming events.
 * - POST /api/follows/match — a device's follows against upcoming events, plus nationwide
 *   Ticketmaster dates for follows with an attraction id. The list is used and forgotten.
 * - POST /api/me/follows — follows synced across an account's devices (premium, `follows.sync`).
 * - GET/PUT /api/me/follows/alerts — new-date alerts on or off (premium, `alerts.newDates`).
 * Nothing about a search or an anonymous follow list is stored or logged.
 */

export interface FollowDeps {
  config: HappowConfig;
  env: Record<string, string | undefined>;
  need: Need;
  limit: Limit;
  clientHash: (req: Request, salt: string) => Promise<string>;
  requireUser: (req: Request) => Promise<User>;
  planOf: (user: { id: string }) => Promise<{ entitlements: Entitlements }>;
  now: () => Date;
  fetch: typeof fetch;
}

interface HitRow {
  id: string;
  title: string;
  category_ids: string[];
  start_at: string;
  end_at: string;
  timezone: string;
  venue_name: string | null;
  lat: number;
  lng: number;
  distance_m: number | null;
  is_free: boolean;
  status: string;
  performers: string[] | null;
  matched_performer: string | null;
  match?: EventHit['match'];
  matched_norm?: string;
  matched_external_id?: string | null;
}

function rowToHit(r: HitRow): EventHit {
  return {
    id: r.id,
    title: r.title,
    categoryIds: r.category_ids,
    startAt: r.start_at,
    endAt: r.end_at,
    timezone: r.timezone,
    venueName: r.venue_name,
    point: { lat: r.lat, lng: r.lng },
    distanceM: r.distance_m === null ? null : Math.round(r.distance_m),
    isFree: r.is_free,
    status: r.status,
    performers: r.performers ?? [],
    matchedPerformer: r.matched_performer,
    ...(r.match && { match: r.match }),
    ...(r.matched_norm !== undefined && { matchedNorm: r.matched_norm }),
    ...(r.matched_external_id !== undefined && { matchedExternalId: r.matched_external_id }),
  };
}

interface TmEvent {
  id: string;
  name?: string;
  url?: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string };
    status?: { code?: string };
  };
  _embedded?: {
    venues?: {
      name?: string;
      city?: { name?: string };
      location?: { latitude?: string; longitude?: string };
    }[];
    attractions?: { id?: string; name?: string }[];
  };
}

/** One Discovery API answer → the dates we cache (cancelled ones left out). */
export function nationwideDates(attractionId: string, body: unknown): NationwideDate[] {
  const events = (body as { _embedded?: { events?: TmEvent[] } })?._embedded?.events ?? [];
  return events.flatMap((e): NationwideDate[] => {
    if (!e.id || e.dates?.status?.code?.toLowerCase() === 'cancelled') return [];
    const v = e._embedded?.venues?.[0];
    const lat = Number(v?.location?.latitude);
    const lng = Number(v?.location?.longitude);
    const a = e._embedded?.attractions?.find((x) => x.id === attractionId);
    const url = e.url && /^https:\/\//.test(e.url) ? e.url : null;
    return [
      {
        id: e.id,
        attractionId,
        performer: a?.name ?? e.name ?? '',
        title: e.name ?? '',
        startAt: e.dates?.start?.dateTime ?? null,
        localDate: e.dates?.start?.localDate ?? null,
        city: v?.city?.name ?? null,
        venueName: v?.name ?? null,
        url,
        point: Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : null,
      },
    ];
  });
}

const followItem = z.object({
  name: z.string().trim().min(2).max(120),
  tmAttractionId: z.string().trim().min(1).max(100).nullable().optional(),
});

export function followRoutes(deps: FollowDeps) {
  const { config, env, need, limit, clientHash, requireUser, planOf, now } = deps;
  const { search: cfg, follows: fcfg } = config.app;
  const horizonMs = config.app.ingest.lookaheadHours * 3_600_000;

  const coord = (v: string | null, max: number) => {
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
  };
  const regionOf = (id: string | null | undefined): Region => {
    try {
      return getRegion(config, id ?? undefined);
    } catch {
      throw new ApiError(400, 'invalid_input', 'region');
    }
  };

  /** GET /api/search?q=&lat=&lng=&region= → {results}. */
  async function search(req: Request): Promise<Response> {
    const { db, salt } = need();
    const u = new URL(req.url);
    const q = (u.searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ');
    if (q.length < cfg.minChars || q.length > cfg.maxChars)
      throw new ApiError(400, 'invalid_input', 'q');
    const region = regionOf(u.searchParams.get('region'));
    await limit('search', await clientHash(req, salt), 3600, cfg.perHourPerClient);
    const t = now();
    const rows = await db.rpc<HitRow[]>('search_events', {
      q,
      p_region: region.id,
      p_lat: coord(u.searchParams.get('lat'), 90),
      p_lng: coord(u.searchParams.get('lng'), 180),
      from_ts: t.toISOString(),
      to_ts: new Date(t.getTime() + horizonMs).toISOString(),
      max_results: cfg.maxResults,
      min_similarity: cfg.minSimilarity,
      min_word_similarity: cfg.minWordSimilarity,
    });
    return json({ results: rows.map(rowToHit) }, 200, {
      'cache-control': `public, max-age=${cfg.cacheSeconds}`,
    });
  }

  const matchSchema = z.object({
    follows: z.array(followItem).max(fcfg.max),
    regionId: z.string().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  });

  /**
   * Nationwide dates for attraction ids: the 24-hour cache first, then at most `perRequest` new
   * Discovery calls, within the daily cap shared by everyone.
   */
  async function nationwide(
    db: Supabase,
    ids: Map<string, string>,
    region: Region,
  ): Promise<NationwideDate[]> {
    const nw = fcfg.nationwide;
    if (!nw.enabled || !ids.size) return [];
    const source = config.sources.find((s) => s.id === nw.sourceId);
    const key = source?.secrets[0] ? env[source.secrets[0]] : undefined;
    const endpoint = source?.options.endpoint;
    const cached = await db.rpc<Record<string, { fetchedAt: string; events: NationwideDate[] }>>(
      'follow_lookups_get',
      { p_ids: [...ids.keys()] },
    );
    const fresh = now().getTime() - nw.maxAgeHours * 3_600_000;
    const out: NationwideDate[] = [];
    let calls = 0;
    for (const id of ids.keys()) {
      const c = cached[id];
      if (c && new Date(c.fetchedAt).getTime() > fresh) {
        out.push(...c.events);
        continue;
      }
      if (!key || typeof endpoint !== 'string' || calls >= nw.perRequest) {
        if (c) out.push(...c.events);
        continue;
      }
      try {
        await limit('tm-follow-lookup', 'all', 86_400, nw.perDay);
      } catch {
        if (c) out.push(...c.events);
        continue;
      }
      calls++;
      const params = new URLSearchParams({
        apikey: key,
        attractionId: id,
        countryCode: nw.countryCode,
        size: '50',
        sort: 'date,asc',
        startDateTime: now()
          .toISOString()
          .replace(/\.\d{3}Z$/, 'Z'),
      });
      try {
        const res = await deps.fetch(`${endpoint}?${params}`, {
          headers: { 'user-agent': config.app.ingest.userAgent },
        });
        if (!res.ok) throw new Error(String(res.status));
        const dates = nationwideDates(id, await res.json());
        await db.rpc('follow_lookups_put', { p_id: id, p_events: dates });
        out.push(...dates);
      } catch {
        if (c) out.push(...c.events);
      }
    }
    // Dates inside the region are on the map already, through ingestion.
    const t = now().getTime();
    return out
      .filter((d) => !(d.point && isInBbox(d.point, region.bbox)))
      .filter((d) => !d.startAt || new Date(d.startAt).getTime() > t - 3_600_000)
      .sort((a, b) =>
        (a.startAt ?? a.localDate ?? '').localeCompare(b.startAt ?? b.localDate ?? ''),
      );
  }

  /** POST /api/follows/match {follows, regionId?, lat?, lng?} → {matches, nationwide}. */
  async function match(req: Request): Promise<Response> {
    const { db, salt } = need();
    const input = await body(req, matchSchema);
    const region = regionOf(input.regionId);
    await limit('follows-match', await clientHash(req, salt), 3600, fcfg.matchPerHourPerClient);
    const norms = [...new Set(input.follows.map((f) => normName(f.name)))].filter(
      (n) => n.length >= 2,
    );
    const tm = new Map<string, string>();
    for (const f of input.follows) if (f.tmAttractionId) tm.set(f.tmAttractionId, f.name);
    if (!norms.length) return json({ matches: [], nationwide: [] });
    const t = now();
    const rows = await db.rpc<HitRow[]>('follows_match', {
      p_norms: norms,
      p_tm_ids: [...tm.keys()],
      p_region: region.id,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      from_ts: t.toISOString(),
      to_ts: new Date(t.getTime() + horizonMs).toISOString(),
      max_results: 300,
    });
    return json(
      { matches: rows.map(rowToHit), nationwide: await nationwide(db, tm, region) },
      200,
      noStore,
    );
  }

  const syncSchema = z.object({
    items: z
      .array(
        followItem.extend({
          changedAt: z.string().datetime({ offset: true }),
          removed: z.boolean().default(false),
        }),
      )
      .max(fcfg.max * 3),
  });

  /** POST /api/me/follows {items} → {items}; GET/PUT /api/me/follows/alerts. */
  async function mine(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    const { db } = need();
    const { entitlements } = await planOf(user);
    if (path.join('/') === 'alerts') {
      if (req.method === 'GET')
        return json(await db.rpc('follow_settings_get', { p_user: user.id }));
      if (req.method !== 'PUT') throw new ApiError(404, 'not_found');
      const input = await body(req, z.object({ on: z.boolean(), email: z.boolean().optional() }));
      if ((input.on || input.email) && !can(entitlements, 'alerts.newDates'))
        throw new ApiError(403, 'forbidden', 'alerts.newDates is not in this plan');
      // Email needs the app's sender.
      if (input.email && config.app.email.provider === 'none')
        throw new ApiError(503, 'not_configured');
      await db.rpc('follow_alerts_set', { p_user: user.id, p_on: input.on });
      if (input.email !== undefined)
        await db.rpc('follow_alerts_email', { p_user: user.id, p_on: input.email });
      return json({ alerts: input.on, ...(input.email !== undefined && { email: input.email }) });
    }
    if (req.method !== 'POST' || path.length) throw new ApiError(404, 'not_found');
    if (!can(entitlements, 'follows.sync'))
      throw new ApiError(403, 'forbidden', 'follows.sync is not in this plan');
    await limit('follows-sync', user.id, 3600, fcfg.matchPerHourPerClient);
    const { items } = await body(req, syncSchema);
    const merged = await db.rpc<unknown[]>('follows_sync', {
      p_user: user.id,
      p_items: items.map((i) => ({ ...i, norm: normName(i.name) })),
      p_max: fcfg.max,
    });
    return json({ items: merged }, 200, noStore);
  }

  return { search, match, mine };
}
