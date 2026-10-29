import {
  ageMinSchema,
  areaFrom,
  distanceM,
  areaSlackM,
  daysBounds,
  entrySchema,
  getRegion,
  isAreaKey,
  isInBbox,
  loadConfig,
  quota,
  shiftWall,
  usageMonth,
  wallMinutes,
  weeklyStarts,
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
import { accountRoutes, quotaExceeded } from './accounts.js';
import { contributionRoutes } from './contributions.js';
import { feedRoutes } from './feeds.js';
import { ApiError, body, json, sha256 } from './http.js';
import { premiumProviders, premiumRoutes, type PremiumProvider } from './premium.js';
import { dispatchDueIngest, type ScheduleEnv } from './schedule.js';
import { Supabase, SupabaseError } from './supabase.js';

/** Secrets and settings from the host (Cloudflare Pages env, or .env in development). */
export interface ApiEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Salt for hashing device ids and IPs; rotate to forget them. */
  SUBMITTER_SALT?: string;
  ANTHROPIC_API_KEY?: string;
  /** Walking routes for "Going there" (name set in config: navigation.routing.secret). */
  ORS_API_KEY?: string;
}

export interface ApiDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  config?: HappowConfig;
  /** Overrides for tests. */
  geocoder?: Geocoder;
  extractor?: Extractor | null;
  /** Instead of the providers named in config (premium.providers). */
  premiumProviders?: PremiumProvider[];
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
    /** The form offers none / 0+ / 12+ / 16+ / 18+; a prefilled page value may be another age. */
    ageMin: ageMinSchema.nullable().optional(),
    family: z.boolean().nullable().optional(),
    /** Sent only when the user changes it; otherwise the category default applies. */
    entry: entrySchema.nullable().optional(),
  }),
  /** Weekly on these ISO weekdays (1 = Monday) until a day, inclusive (M12 §4.5). */
  repeat: z
    .object({
      days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
});

const reportSchema = z.object({
  deviceId,
  eventId: z.string().min(1).max(300),
  reason: z.enum([
    'cancelled',
    'venue_closed',
    'weather',
    'moved',
    'wrong_info',
    'inappropriate',
    'other',
  ]),
  note: z.string().trim().max(500).nullable().optional(),
});

const moderateSchema = z.object({
  action: z.enum(['approve', 'reject', 'dismiss', 'cancel', 'hide']),
  note: z.string().trim().max(500).nullable().optional(),
});

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
  url: string | null;
  ticketUrl: string | null;
  ageMin: number | null;
  family: boolean | null;
  entry: 'fixed' | 'open' | null;
}

export function createApi(env: ApiEnv, deps: ApiDeps = {}) {
  const config = deps.config ?? loadConfig();
  const doFetch = boundFetch(deps.fetch);
  const now = deps.now ?? (() => new Date());
  const { submissions: limits, extraction, geocoding, ingest, refresh, navigation } = config.app;
  const routingKey = (env as Record<string, string | undefined>)[navigation.routing.secret];
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

  // Quotas count per calendar month, and the promotion ends, in the default region's time zone.
  const accountZone = getRegion(config).timezone;
  const accounts = accountRoutes({
    app: config.app,
    plans: config.plans,
    timeZone: accountZone,
    need,
    now,
    limit,
    clientHash,
  });
  const contributions = contributionRoutes({
    config,
    timeZone: accountZone,
    need,
    now,
    limit,
  });
  /** A reward that fails must not undo the approval or the submission it follows. */
  const award = async (submissionId: string, eventId: string | null) => {
    try {
      return await contributions.award(submissionId, eventId);
    } catch (err) {
      console.error(JSON.stringify({ award: submissionId, error: String(err) }));
      return null;
    }
  };
  const premium = premiumRoutes({
    providers:
      deps.premiumProviders ??
      premiumProviders(config.app.premium.providers, env as Record<string, string | undefined>),
    need,
    requireUser: accounts.requireUser,
    planOf: accounts.planOf,
  });

  const feeds = feedRoutes({ config, need, requireUser: accounts.requireUser, limit });

  const regionFor = (id?: string): Region => getRegion(config, id);
  /** The signed-in user when the request carries a token (a bad token is 401), else null. */
  const optionalUser = (req: Request) =>
    req.headers.has('authorization') ? accounts.requireUser(req) : Promise.resolve(null);

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

  async function toPrefill(
    e: ExtractedEvent,
    pageUrl: string | null,
    region: Region,
  ): Promise<Prefill> {
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
      ageMin: e.ageMin ?? null,
      family: e.family ?? null,
      entry: e.entry ?? null,
    };
  }

  /**
   * The autofill quota, checked before any fetch or LLM call so a used-up quota costs nothing.
   * One fill is taken later, in `prefillsFor`, only when it gave something.
   */
  async function autofillAllowance(user: { id: string }) {
    const { db } = need();
    await limit('autofill', user.id, 3600, limits.autofillPerHour);
    const usage = usageMonth(now(), accountZone);
    const max = quota((await accounts.planOf(user)).entitlements, 'autofill.perMonth');
    const used = await db.rpc<{ autofills: number }>('usage_get', {
      p_user: user.id,
      p_month: usage.month,
    });
    if (used.autofills >= max) throw quotaExceeded('autofill', max, usage.resetsAt);
    return { userId: user.id, usage, max };
  }

  /** One call from the global daily LLM budget (the paid fallback's cost cap). */
  const llmToday = () =>
    need().db.rpc<boolean>('rate_limit_hit', {
      p_bucket: 'autofill-llm',
      p_actor: 'global',
      p_window_seconds: 86_400,
      p_max: extraction.autofillLlmPerDay,
    });

  /** Up to 5 upcoming in-person events as prefills; takes one autofill when there is any. */
  async function prefillsFor(
    events: ExtractedEvent[],
    pageUrl: string | null,
    region: Region,
    allowance: Awaited<ReturnType<typeof autofillAllowance>>,
  ): Promise<Prefill[]> {
    const soon = now().getTime() - 6 * 3_600_000;
    const usable = events
      .filter((e) => !e.online)
      .map((e) => ({ e, at: resolveInstant(e.start, region.timezone)?.at.getTime() ?? 0 }))
      .filter(({ at }) => at >= soon)
      .sort((a, b) => a.at - b.at)
      .slice(0, 5);
    const prefills = await Promise.all(usable.map(({ e }) => toPrefill(e, pageUrl, region)));
    if (
      prefills.length &&
      !(await need().db.rpc<boolean>('usage_take', {
        p_user: allowance.userId,
        p_month: allowance.usage.month,
        p_kind: 'autofills',
        p_max: allowance.max,
      }))
    )
      // Another request took the last one in the meantime.
      throw quotaExceeded('autofill', allowance.max, allowance.usage.resetsAt);
    return prefills;
  }

  /**
   * POST /api/autofill/photo {image, mediaType} (M12 §4.2): a poster photo, shrunk on the device,
   * read by the LLM into the same prefills as a link. The photo is passed on to be read and is
   * not stored; the event never gets it as its image.
   */
  async function autofillPhoto(req: Request): Promise<Response> {
    if (!limits.autofill) throw new ApiError(404, 'not_found');
    need();
    const user = await accounts.requireUser(req);
    const { maxBytes } = extraction.photo;
    // Base64 grows by a third; anything well past that is refused before it is read.
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > Math.ceil(maxBytes * 1.4) + 2048) throw new ApiError(413, 'photo_too_large');
    const input = await body(
      req,
      z.object({
        image: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
        mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        regionId: z.string().optional(),
      }),
    );
    if (Math.floor((input.image.length * 3) / 4) > maxBytes)
      throw new ApiError(413, 'photo_too_large');
    const allowance = await autofillAllowance(user);
    const region = regionFor(input.regionId);
    // No reader, or today's LLM budget is spent: say so rather than "nothing found".
    if (!extractor?.extractImage || !(await llmToday()))
      throw new ApiError(503, 'photo_unavailable');
    let events: ExtractedEvent[];
    try {
      events = await extractor.extractImage({
        data: input.image,
        mediaType: input.mediaType,
        today: localInputValue(now(), region.timezone).slice(0, 10),
        timeZone: region.timezone,
        categories: config.categories.map((c) => ({ id: c.id, label: c.labels[region.locale] })),
      });
    } catch (err) {
      console.error('photo extraction failed', (err as Error).message);
      events = [];
    }
    const prefills = await prefillsFor(events, null, region, allowance);
    return json({ method: prefills.length ? 'llm' : 'none', url: null, events: prefills });
  }

  /** POST /api/autofill {url} → up to 5 prefills from the page (JSON-LD first, LLM fallback). */
  async function autofill(req: Request): Promise<Response> {
    if (!limits.autofill) throw new ApiError(404, 'not_found');
    const { db } = need();
    const user = await accounts.requireUser(req);
    const { url, regionId } = await body(
      req,
      z.object({ url: z.string().min(4).max(2000), regionId: z.string().optional() }),
    );
    const allowance = await autofillAllowance(user);
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
    if (!events.length && extractor && (await llmToday())) {
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
    const prefills = await prefillsFor(events, page.url, region, allowance);
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
    await limit('geocode', await clientHash(req, salt), 3600, limits.autofillPerHour * 4);
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
    const user = await optionalUser(req);
    if (!user && limits.account === 'required') throw new ApiError(401, 'account_required');
    const input = await body(req, submissionSchema);
    const region = regionFor(input.regionId);
    const e = input.event;
    const known = new Set(config.categories.map((c) => c.id));
    if (!e.categoryIds.every((c) => known.has(c)))
      throw new ApiError(400, 'invalid_input', 'category');
    if (!isInBbox(e.point, region.bbox)) throw new ApiError(400, 'outside_region');
    // A weekly repeat is one event per date (M12 §4.5), each its own length after its start.
    const { recurring } = limits;
    if (input.repeat && !user) throw new ApiError(401, 'account_required');
    const starts = input.repeat
      ? weeklyStarts(e.start, input.repeat, recurring.maxWeeks)
      : [e.start];
    if (!starts.length || starts.length > recurring.maxOccurrences)
      throw new ApiError(400, 'invalid_input', 'repeat');
    const length = e.end ? wallMinutes(e.start, e.end) : null;
    const t = now().getTime();
    const dates = starts.map((wall) => {
      const start = resolveInstant(wall, region.timezone)?.at;
      if (!start || start.getTime() < t - 86_400_000 || start.getTime() > t + 366 * 86_400_000)
        throw new ApiError(400, 'invalid_input', 'start');
      const endWall = length === null ? null : shiftWall(wall, length);
      const end = endWall ? resolveInstant(endWall, region.timezone)?.at : null;
      if (length !== null && (!end || end.getTime() <= start.getTime()))
        throw new ApiError(400, 'invalid_input', 'end');
      return { wall, endWall, start, end: end ?? null };
    });
    if (e.url) {
      try {
        // Same rules as autofill: public http(s) links only.
        checkPublicUrl(e.url);
      } catch {
        throw new ApiError(400, 'unsafe_url');
      }
    }

    const submitter = await sha256(`${salt}:device:${input.deviceId}`);
    // An account has a monthly quota (checked as the event is stored) and an hourly guard;
    // without one, the per-device and per-IP daily caps apply.
    let quotaMax = 0;
    let trusted = false;
    if (user) {
      await limit('submit-account', user.id, 3600, limits.perHourPerAccount);
      quotaMax = quota((await accounts.planOf(user)).entitlements, 'events.perMonth');
      trusted = await contributions.trusted(user.id);
    } else {
      await limit('submit', submitter, 86_400, limits.maxPerDevicePerDay);
      await limit('submit-ip', await clientHash(req, salt), 86_400, limits.maxPerDevicePerDay * 3);
    }
    const usage = usageMonth(now(), accountZone);

    // A series shares one venue row; every date is its own submission and event.
    const seriesId = input.repeat ? crypto.randomUUID() : null;
    const items = dates.map((d) => {
      const id = crypto.randomUUID();
      const res = normalize(
        {
          externalId: id,
          sourceUrl: e.url ?? null,
          title: e.title,
          description: e.description ?? null,
          startAt: d.start.toISOString(),
          endAt: d.end ? d.end.toISOString() : null,
          categoryLabels: [],
          categoryIds: e.categoryIds,
          venue: {
            externalId: seriesId ?? id,
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
          ageMin: e.ageMin ?? null,
          family: e.family ?? null,
          entry: e.entry ?? null,
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
      return {
        id,
        eventId: res.value.event.id,
        // Each date keeps its own form, so "add again" copies the date it was opened from.
        p: {
          id,
          form: { ...e, start: d.wall, end: d.endWall, url: e.url ?? null },
          normalized: res.value,
        },
      };
    });
    const publish = limits.publishBeforeModeration;
    const common = {
      p_submitter: submitter,
      p_region: region.id,
      p_publish: publish,
      p_user: user?.id ?? null,
      p_month: user ? usage.month : null,
      p_max: quotaMax,
      p_trusted: trusted,
    };
    try {
      if (seriesId)
        await db.rpc('submit_series', {
          p_series: seriesId,
          p_items: items.map((i) => i.p),
          ...common,
        });
      else await db.rpc('submit_event', { p: items[0]!.p, ...common });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'HQ001')
        throw quotaExceeded('events', quotaMax, usage.resetsAt);
      throw err;
    }
    // Published by a trusted account: the reward follows at once, as an approval would give it.
    // A series earns as one event, on its first date.
    const first = items[0]!;
    const reward = trusted ? await award(first.id, first.eventId) : null;
    // Nothing at this place lately: "first added by you" on the adder's card (M12 §6.1).
    const firstPlace = user ? await contributions.firstPlace(first.id) : false;
    const shown = publish || trusted;
    return json(
      {
        id: first.id,
        eventId: shown ? first.eventId : null,
        status: shown ? 'published' : 'pending',
        trusted,
        firstPlace,
        ...(seriesId && {
          seriesId,
          dates: items.map((i) => ({ id: i.id, eventId: shown ? i.eventId : null })),
        }),
        ...(reward && { reward }),
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
    const user = await accounts.requireUser(req);
    if (!user.role) throw new ApiError(403, 'forbidden');
    return user.email;
  }

  async function moderation(req: Request, path: string[]): Promise<Response> {
    const email = await moderator(req);
    const { db } = need();
    if (req.method === 'GET' && path.length === 0)
      return json({
        moderator: email,
        ...(await db.rpc<object>('moderation_queue', {})),
        // Spot checks of what trusted accounts published (M12 §5.3).
        trusted: await db.rpc<object[]>('trusted_recent', { p_days: 7 }),
      });
    if (req.method !== 'POST' || path.length !== 2) throw new ApiError(404, 'not_found');
    const { action, note } = await body(req, moderateSchema);
    const [kind, id] = path as [string, string];
    try {
      if (kind === 'submissions' && (action === 'approve' || action === 'reject')) {
        const done = await db.rpc<{ id: string; eventId: string | null; action: string }>(
          'moderate_submission',
          { p_id: id, p_action: action, p_note: note ?? null, p_moderator: email },
        );
        // Rewards come only after moderation (M12 §5).
        const reward = action === 'approve' ? await award(id, done.eventId) : null;
        return json({ ...done, ...(reward && { reward }) });
      }
      // A weekly repeat is decided once, for all its pending dates (M12 §4.5). It earns as one
      // event, on its earliest date.
      if (kind === 'series' && (action === 'approve' || action === 'reject')) {
        if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, 'not_found');
        const dates = await db.rpc<{ id: string; eventId: string | null; action: string }[]>(
          'moderate_series',
          { p_series: id, p_action: action, p_note: note ?? null, p_moderator: email },
        );
        const first = dates[0]!;
        const reward = action === 'approve' ? await award(first.id, first.eventId) : null;
        return json({ seriesId: id, action, dates, ...(reward && { reward }) });
      }
      if (kind === 'trusted' && action === 'reject')
        return json(
          await db.rpc('moderate_trusted', {
            p_id: id,
            p_note: note ?? null,
            p_moderator: email,
          }),
        );
      if (
        kind === 'reports' &&
        (action === 'dismiss' || action === 'cancel' || action === 'hide')
      ) {
        const resolved = await db.rpc<number>('resolve_reports', {
          p_event: id,
          p_action: action,
          p_note: note ?? null,
          p_moderator: email,
        });
        // Hidden as wrong: its reward stops counting, and days not yet started are taken back.
        if (action === 'hide') await db.rpc('contribution_revoke_event', { p_event: id });
        return json({ resolved });
      }
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'not_found');
      if (err instanceof SupabaseError && err.code === 'P0001')
        throw new ApiError(409, 'already_reviewed');
      throw err;
    }
    throw new ApiError(400, 'invalid_input', 'action');
  }

  /**
   * GET /api/area?lat&lng&r[&range] → every listed event within r of a grid point for the next
   * hours, or with `range` (a multi-day time window: week, later) up to the end of that window's
   * last day. The response is public and expires at the end of its step (5 min; 30 min for a
   * range), so Cloudflare's Workers Caching (wrangler.jsonc) answers everyone in the same grid
   * square without running this, and Supabase is asked about once per busy area per step.
   * Revalidations get a 304 via the ETag.
   */
  async function area(req: Request): Promise<Response> {
    if (!db) throw new ApiError(503, 'not_configured');
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
    const rangeId = u.searchParams.get('range');
    const range = rangeId === null ? null : config.app.timeWindows.find((w) => w.id === rangeId);
    if (range !== null && !(range && 'days' in range))
      throw new ApiError(400, 'invalid_input', 'range');

    const t = now();
    const stepMinutes = range ? refresh.longCacheMinutes : refresh.dataMinutes;
    const from = areaFrom(t, stepMinutes);
    const to = range
      ? daysBounds(t, region.timezone, range.days).end
      : new Date(from.getTime() + refresh.areaHours * 3_600_000);
    // Everyone's copy expires at the same step boundary, so caches and phones refresh together.
    const expires = from.getTime() + stepMinutes * 60_000;
    const maxAge = Math.max(15, Math.round((expires - t.getTime()) / 1000));
    const events = await db.rpc<unknown>('events_area', {
      lat: key.lat,
      lng: key.lng,
      radius_m: key.radiusM + areaSlackM(key.lat, refresh),
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
      max_events: refresh.areaMaxEvents,
    });
    const body = JSON.stringify({ from: from.toISOString(), to: to.toISOString(), events });
    const etag = `"${(await sha256(body)).slice(0, 16)}"`;
    const headers = {
      'content-type': 'application/json',
      etag,
      'cache-control': `public, max-age=${maxAge}`,
    };
    if (req.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers });
  }

  /**
   * POST /api/route {from, to} → a walking route for "Going there". One call per trip (plus a
   * few re-routes); the app draws a direct line when this answers 503 or 429.
   */
  async function route(req: Request): Promise<Response> {
    const { salt } = need();
    if (!routingKey) throw new ApiError(503, 'not_configured');
    const { from, to } = await body(req, z.object({ from: latLng, to: latLng }));
    if (!config.regions.some((r) => isInBbox(to, r.bbox)))
      throw new ApiError(400, 'outside_region');
    if (distanceM(from, to) > navigation.maxRouteKm * 1000)
      throw new ApiError(400, 'invalid_input', 'too far');
    await limit('route', await clientHash(req, salt), 3600, navigation.routesPerHourPerClient);
    const res = await doFetch(navigation.routing.endpoint, {
      method: 'POST',
      headers: {
        authorization: routingKey,
        'content-type': 'application/json',
        accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
    });
    // Quota used up (403 daily, 429 per minute) or provider down: the app draws a direct line.
    if (res.status === 403 || res.status === 429) throw new ApiError(429, 'rate_limited');
    if (!res.ok) throw new ApiError(503, 'not_configured', `routing ${res.status}`);
    const geo = (await res.json()) as {
      features?: {
        geometry?: { coordinates?: [number, number][] };
        properties?: { summary?: { distance?: number; duration?: number } };
      }[];
    };
    const f = geo.features?.[0];
    const coords = f?.geometry?.coordinates;
    if (!coords?.length) throw new ApiError(503, 'not_configured', 'no route');
    return json({
      path: coords.map(([lng, lat]) => ({ lat, lng })),
      distanceM: Math.round(f?.properties?.summary?.distance ?? 0),
      durationS: Math.round(f?.properties?.summary?.duration ?? 0),
      attribution: navigation.routing.attribution,
    });
  }

  /**
   * GET /api/ingest/status → what the Cron Trigger would start right now, and whether its token
   * is configured. Read-only; reveals source ids only, never the token or run errors.
   */
  async function ingestStatus(): Promise<Response> {
    const t = now();
    const r = await dispatchDueIngest(
      env as ScheduleEnv,
      t,
      { fetch: doFetch, config },
      { dryRun: true },
    );
    return new Response(JSON.stringify({ checkedAt: t.toISOString(), ...r }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
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
      if (head === 'me' && rest.join('/') === 'contributions' && req.method === 'GET')
        return json(await contributions.mine((await accounts.requireUser(req)).id));
      if (head === 'me' && rest[0] === 'feeds') return await feeds.mine(req, rest.slice(1));
      if (head === 'me') return await accounts.me(req, rest);
      if (head === 'auth') return await accounts.auth(req, rest);
      if (head === 'admin' && rest[0] === 'feeds') return await feeds.admin(req, rest.slice(1));
      if (head === 'admin') return await accounts.admin(req, rest);
      if (head === 'premium') return await premium(req, rest);
      if (head === 'area' && req.method === 'GET' && !rest.length) return await area(req);
      if (head === 'ingest' && req.method === 'GET' && rest.join('/') === 'status')
        return await ingestStatus();
      if (head === 'autofill' && req.method === 'POST' && rest.join('/') === 'photo')
        return await autofillPhoto(req);
      if (req.method !== 'POST' || rest.length) throw new ApiError(404, 'not_found');
      if (head === 'autofill') return await autofill(req);
      if (head === 'geocode') return await geocode(req);
      if (head === 'submissions') return await submit(req);
      if (head === 'reports') return await report(req);
      if (head === 'thanks' && !rest.length) return await contributions.thanks(req);
      if (head === 'counts' && req.method === 'POST' && !rest.length)
        return await contributions.counts(req);
      if (head === 'route') return await route(req);
      throw new ApiError(404, 'not_found');
    } catch (err) {
      if (err instanceof ApiError)
        return json({ error: err.code, message: err.message, ...err.details }, err.status);
      console.error(err);
      return json({ error: 'server_error' }, 500);
    }
  };
}
