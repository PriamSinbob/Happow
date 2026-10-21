import {
  getRegion,
  isInBbox,
  loadConfig,
  type HappowConfig,
  type LatLng,
  type Region,
} from '@happow/core';
import {
  boundFetch,
  CachedGeocoder,
  checkPublicUrl,
  ClaudeExtractor,
  eventsFromJsonLd,
  extractJsonLd,
  FetchPageError,
  fetchPage,
  htmlToText,
  MemoryCache,
  NominatimGeocoder,
  pageMeta,
  resolveInstant,
  UnsafeUrlError,
  type ExtractedEvent,
  type Extractor,
  type Geocoder,
} from '@happow/extract';
import { normalize } from '@happow/ingest/normalize';
import { z } from 'zod';
import { Supabase, SupabaseError } from './supabase.js';

/** Secrets and settings from the host (Cloudflare Pages env, or .env in development). */
export interface ApiEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Salt for hashing device ids and IPs; rotate to forget them. */
  SUBMITTER_SALT?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface ApiDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  config?: HappowConfig;
  /** Overrides for tests. */
  geocoder?: Geocoder;
  extractor?: Extractor | null;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "2026-10-24T19:00" in the region's time zone, for <input type="datetime-local">. */
export function localInputValue(at: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const deviceId = z.string().min(8).max(100);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const submissionSchema = z.object({
  deviceId,
  regionId: z.string().optional(),
  event: z.object({
    title: z.string().trim().min(3).max(140),
    categoryIds: z.array(z.string()).min(1).max(3),
    venueName: z.string().trim().min(2).max(140),
    address: z.string().trim().max(200).optional().default(''),
    point: latLng,
    start: localDateTime,
    end: localDateTime.nullable().optional(),
    isFree: z.boolean(),
    priceMin: z.number().min(0).max(100_000).nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
    url: z.string().url().max(500).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  }),
});

const reportSchema = z.object({
  deviceId,
  eventId: z.string().min(1).max(300),
  reason: z.enum(['wrong_info', 'cancelled', 'inappropriate', 'other']),
  note: z.string().trim().max(500).nullable().optional(),
});

const moderateSchema = z.object({
  action: z.enum(['approve', 'reject', 'dismiss', 'cancel', 'hide']),
  note: z.string().trim().max(500).nullable().optional(),
});

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'invalid_input', parsed.error.issues[0]?.message);
  return parsed.data;
}

/** One prefill the add-event form can use. */
export interface Prefill {
  title: string;
  categoryIds: string[];
  start: string | null;
  end: string | null;
  venueName: string | null;
  address: string | null;
  point: LatLng | null;
  isFree: boolean | null;
  priceMin: number | null;
  currency: string | null;
  url: string;
  ticketUrl: string | null;
}

export function createApi(env: ApiEnv, deps: ApiDeps = {}) {
  const config = deps.config ?? loadConfig();
  const doFetch = boundFetch(deps.fetch);
  const now = deps.now ?? (() => new Date());
  const { submissions: limits, extraction, geocoding, ingest } = config.app;
  const db =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, doFetch)
      : null;
  const need = () => {
    if (!db || !env.SUBMITTER_SALT) throw new ApiError(503, 'not_configured');
    return { db, salt: env.SUBMITTER_SALT };
  };
  const geocoder =
    deps.geocoder ??
    new CachedGeocoder(
      new NominatimGeocoder({
        endpoint: geocoding.endpoint,
        userAgent: ingest.userAgent,
        minIntervalMs: geocoding.minIntervalMs,
        fetch: doFetch,
      }),
      db ? db.geocodeCache(geocoding.provider, geocoding.cacheDays) : new MemoryCache(),
    );
  const extractor =
    deps.extractor !== undefined
      ? deps.extractor
      : env.ANTHROPIC_API_KEY
        ? new ClaudeExtractor({
            apiKey: env.ANTHROPIC_API_KEY,
            model: extraction.model,
            effort: extraction.effort,
            maxInputChars: extraction.maxInputChars,
            maxTokens: extraction.maxTokens,
            fetch: doFetch,
          })
        : null;
  const submissionsSource = config.sources.find((s) => s.adapter === 'user-submission');

  const limit = async (bucket: string, actor: string, windowSeconds: number, max: number) => {
    const { db } = need();
    const ok = await db.rpc<boolean>('rate_limit_hit', {
      p_bucket: bucket,
      p_actor: actor,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (!ok) throw new ApiError(429, 'rate_limited');
  };
  const clientHash = async (req: Request, salt: string) =>
    sha256(
      `${salt}:ip:${req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'local'}`,
    );

  const regionFor = (id?: string): Region => getRegion(config, id);

  async function locate(e: ExtractedEvent, region: Region): Promise<LatLng | null> {
    if (e.point) return e.point;
    const hit = await geocoder.geocode(
      {
        venueName: e.venueName,
        street: e.address.street,
        postalCode: e.address.postalCode,
        city: e.address.city ?? region.localities?.[0] ?? region.name[region.locale],
        countryCode: region.countryCode,
      },
      region.bbox,
    );
    return hit?.point ?? null;
  }

  async function toPrefill(e: ExtractedEvent, pageUrl: string, region: Region): Promise<Prefill> {
    const start = resolveInstant(e.start, region.timezone);
    const end = e.end ? resolveInstant(e.end, region.timezone) : null;
    const known = new Set(config.categories.map((c) => c.id));
    const mapped = e.categoryHints
      .map((h) => extraction.schemaTypeMap[h])
      .filter((c): c is string => !!c && known.has(c));
    const address = [
      e.address.street,
      [e.address.postalCode, e.address.city].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    return {
      title: e.title,
      categoryIds: [...new Set([...e.categoryIds.filter((c) => known.has(c)), ...mapped])].slice(
        0,
        3,
      ),
      start: start ? localInputValue(start.at, region.timezone) : null,
      end: end && !end.allDay ? localInputValue(end.at, region.timezone) : null,
      venueName: e.venueName,
      address: address || null,
      point: await locate(e, region),
      isFree: e.isFree,
      priceMin: e.priceMin,
      currency: e.currency,
      url: e.url ?? pageUrl,
      ticketUrl: e.ticketUrl,
    };
  }

  /** POST /api/autofill {url} → up to 5 prefills from the page (JSON-LD first, LLM fallback). */
  async function autofill(req: Request): Promise<Response> {
    const { db, salt } = need();
    const { url, regionId } = await body(
      req,
      z.object({ url: z.string().min(4).max(2000), regionId: z.string().optional() }),
    );
    await limit('autofill', await clientHash(req, salt), 3600, limits.autofillPerHourPerClient);
    const region = regionFor(regionId);
    let page;
    try {
      page = await fetchPage(url.trim(), {
        userAgent: ingest.userAgent,
        fetch: doFetch,
        maxBytes: extraction.maxPageBytes,
      });
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw new ApiError(400, 'unsafe_url', err.message);
      if (err instanceof FetchPageError) throw new ApiError(422, 'page_unavailable', err.message);
      throw new ApiError(422, 'page_unavailable');
    }

    let method: 'jsonld' | 'llm' | 'none' = 'jsonld';
    let events = eventsFromJsonLd(extractJsonLd(page.html), page.url);
    // The LLM is a paid fallback: a global daily cap bounds the bill however many people paste
    // links, and any failure (cap, outage, spend limit) just leaves the form for manual entry.
    if (
      !events.length &&
      extractor &&
      (await db.rpc<boolean>('rate_limit_hit', {
        p_bucket: 'autofill-llm',
        p_actor: 'global',
        p_window_seconds: 86_400,
        p_max: extraction.autofillLlmPerDay,
      }))
    ) {
      method = 'llm';
      try {
        events = await extractor.extract({
          url: page.url,
          text: htmlToText(page.html, extraction.maxInputChars),
          today: localInputValue(now(), region.timezone).slice(0, 10),
          timeZone: region.timezone,
          categories: config.categories.map((c) => ({ id: c.id, label: c.labels[region.locale] })),
        });
      } catch (err) {
        console.error('autofill extraction failed', (err as Error).message);
        events = [];
      }
    }
    const soon = now().getTime() - 6 * 3_600_000;
    const usable = events
      .filter((e) => !e.online)
      .map((e) => ({ e, at: resolveInstant(e.start, region.timezone)?.at.getTime() ?? 0 }))
      .filter(({ at }) => at >= soon)
      .sort((a, b) => a.at - b.at)
      .slice(0, 5);
    const prefills = await Promise.all(usable.map(({ e }) => toPrefill(e, page.url, region)));
    if (!prefills.length) method = 'none';
    const meta = pageMeta(page.html);
    return json({ method, url: page.url, title: meta.title, events: prefills });
  }

  /** POST /api/geocode {q} → a point inside the region for a typed address or place name. */
  async function geocode(req: Request): Promise<Response> {
    const { salt } = need();
    const { q, regionId } = await body(
      req,
      z.object({ q: z.string().trim().min(3).max(200), regionId: z.string().optional() }),
    );
    await limit('geocode', await clientHash(req, salt), 3600, limits.autofillPerHourPerClient * 4);
    const region = regionFor(regionId);
    const hit = await geocoder.geocode(
      {
        street: q,
        venueName: q,
        city: region.localities?.[0] ?? region.name[region.locale],
        countryCode: region.countryCode,
      },
      region.bbox,
    );
    return json({ result: hit });
  }

  /** POST /api/submissions → stored for moderation; shown at once as unverified if config says so. */
  async function submit(req: Request): Promise<Response> {
    const { db, salt } = need();
    if (!submissionsSource) throw new ApiError(503, 'not_configured');
    const input = await body(req, submissionSchema);
    const region = regionFor(input.regionId);
    const e = input.event;
    const known = new Set(config.categories.map((c) => c.id));
    if (!e.categoryIds.every((c) => known.has(c)))
      throw new ApiError(400, 'invalid_input', 'category');
    if (!isInBbox(e.point, region.bbox)) throw new ApiError(400, 'outside_region');
    const start = resolveInstant(e.start, region.timezone)?.at;
    const end = e.end ? resolveInstant(e.end, region.timezone)?.at : null;
    const t = now().getTime();
    if (!start || start.getTime() < t - 86_400_000 || start.getTime() > t + 366 * 86_400_000)
      throw new ApiError(400, 'invalid_input', 'start');
    if (end && end.getTime() <= start.getTime()) throw new ApiError(400, 'invalid_input', 'end');
    if (e.url) {
      try {
        // Same rules as autofill: public http(s) links only.
        checkPublicUrl(e.url);
      } catch {
        throw new ApiError(400, 'unsafe_url');
      }
    }

    const submitter = await sha256(`${salt}:device:${input.deviceId}`);
    await limit('submit', submitter, 86_400, limits.maxPerDevicePerDay);
    await limit('submit-ip', await clientHash(req, salt), 86_400, limits.maxPerDevicePerDay * 3);

    const id = crypto.randomUUID();
    const res = normalize(
      {
        externalId: id,
        sourceUrl: e.url ?? null,
        title: e.title,
        description: e.description ?? null,
        startAt: start.toISOString(),
        endAt: end ? end.toISOString() : null,
        categoryLabels: [],
        categoryIds: e.categoryIds,
        venue: {
          externalId: id,
          name: e.venueName,
          address: e.address || null,
          point: e.point,
          website: null,
        },
        point: e.point,
        isFree: e.isFree,
        priceMin: e.isFree ? 0 : (e.priceMin ?? null),
        priceMax: e.isFree ? 0 : (e.priceMin ?? null),
        currency: e.isFree ? null : (e.currency ?? region.currency),
        rules: {},
        officialUrl: e.url ?? null,
        ticketUrl: null,
        imageUrl: null,
        status: 'scheduled',
      },
      {
        source: submissionsSource,
        region,
        categories: config.categories,
        h3Resolution: config.app.h3.eventResolution,
        densityResolution: config.app.h3.densityResolution,
        descriptionMaxChars: limits.maxDescriptionChars,
        now: now(),
      },
    );
    if (!res.ok) throw new ApiError(400, 'invalid_input', res.reason);
    const publish = limits.publishBeforeModeration;
    await db.rpc('submit_event', {
      p: { id, form: { ...e, url: e.url ?? null }, normalized: res.value },
      p_submitter: submitter,
      p_region: region.id,
      p_publish: publish,
    });
    return json(
      {
        id,
        eventId: publish ? res.value.event.id : null,
        status: publish ? 'published' : 'pending',
      },
      201,
    );
  }

  /** POST /api/reports → one open report per device per event. */
  async function report(req: Request): Promise<Response> {
    const { db, salt } = need();
    const input = await body(req, reportSchema);
    const reporter = await sha256(`${salt}:device:${input.deviceId}`);
    await limit('report', reporter, 86_400, limits.reportsPerDayPerDevice);
    try {
      await db.rpc('report_event', {
        p_event: input.eventId,
        p_reason: input.reason,
        p_note: input.note ?? null,
        p_reporter: reporter,
      });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'unknown_event');
      throw err;
    }
    return json({ ok: true }, 201);
  }

  async function moderator(req: Request): Promise<string> {
    const { db } = need();
    const token = /^Bearer (.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!token) throw new ApiError(401, 'unauthorized');
    const email = await db.userEmail(token);
    if (!email) throw new ApiError(401, 'unauthorized');
    if (!(await db.rpc<boolean>('is_moderator', { p_email: email })))
      throw new ApiError(403, 'forbidden');
    return email;
  }

  async function moderation(req: Request, path: string[]): Promise<Response> {
    const email = await moderator(req);
    const { db } = need();
    if (req.method === 'GET' && path.length === 0)
      return json({ moderator: email, ...(await db.rpc<object>('moderation_queue', {})) });
    if (req.method !== 'POST' || path.length !== 2) throw new ApiError(404, 'not_found');
    const { action, note } = await body(req, moderateSchema);
    const [kind, id] = path as [string, string];
    try {
      if (kind === 'submissions' && (action === 'approve' || action === 'reject'))
        return json(
          await db.rpc('moderate_submission', {
            p_id: id,
            p_action: action,
            p_note: note ?? null,
            p_moderator: email,
          }),
        );
      if (kind === 'reports' && (action === 'dismiss' || action === 'cancel' || action === 'hide'))
        return json({
          resolved: await db.rpc<number>('resolve_reports', {
            p_event: id,
            p_action: action,
            p_note: note ?? null,
            p_moderator: email,
          }),
        });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'not_found');
      if (err instanceof SupabaseError && err.code === 'P0001')
        throw new ApiError(409, 'already_reviewed');
      throw err;
    }
    throw new ApiError(400, 'invalid_input', 'action');
  }

  /** Routes /api/*. Everything else is 404. */
  return async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
      .replace(/^\/api\/?/, '')
      .split('/')
      .filter(Boolean);
    try {
      // Event ids carry ':' (source:id), which clients percent-encode.
      for (let i = 0; i < path.length; i++) path[i] = decodeURIComponent(path[i]!);
      const [head, ...rest] = path;
      if (head === 'moderation') return await moderation(req, rest);
      if (req.method !== 'POST' || rest.length) throw new ApiError(404, 'not_found');
      if (head === 'autofill') return await autofill(req);
      if (head === 'geocode') return await geocode(req);
      if (head === 'submissions') return await submit(req);
      if (head === 'reports') return await report(req);
      throw new ApiError(404, 'not_found');
    } catch (err) {
      if (err instanceof ApiError)
        return json({ error: err.code, message: err.message }, err.status);
      console.error(err);
      return json({ error: 'server_error' }, 500);
    }
  };
}
