import {
  getRegion,
  quota,
  usageMonth,
  type Entitlements,
  type HappowConfig,
  type LatLng,
  type Prefill,
  type Region,
} from '@happow/core';
import {
  eventsFromJsonLd,
  extractJsonLd,
  FetchPageError,
  fetchPage,
  htmlToText,
  pageMeta,
  resolveInstant,
  UnsafeUrlError,
  type ExtractedEvent,
  type Extractor,
  type Geocoder,
} from '@happow/extract';
import { z } from 'zod';
import { quotaExceeded, type User } from './accounts.js';
import { ApiError, body, json, type Limit, type Need } from './http.js';

/**
 * Filling the add-event form from a link or a poster photo, and finding a typed address.
 * - POST /api/autofill {url}: the page's events (JSON-LD first, the LLM as a paid fallback).
 * - POST /api/autofill/photo {image, mediaType}: a poster read by the LLM.
 * - POST /api/geocode {q}: a point inside the region.
 */

export interface AutofillDeps {
  config: HappowConfig;
  need: Need;
  limit: Limit;
  now: () => Date;
  /** The default region's time zone: the monthly allowance counts there. */
  timeZone: string;
  clientHash: (req: Request, salt: string) => Promise<string>;
  requireUser: (req: Request) => Promise<User>;
  planOf: (user: { id: string }) => Promise<{ entitlements: Entitlements }>;
  geocoder: Geocoder;
  /** Null while no LLM key is set: links still fill from JSON-LD. */
  extractor: Extractor | null;
  fetch: typeof fetch;
}

/** "2026-10-24T19:00" in the region's time zone, for <input type="datetime-local">. */
function localInputValue(at: Date, timeZone: string): string {
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

export function autofillRoutes({
  config,
  need,
  limit,
  now,
  timeZone,
  clientHash,
  requireUser,
  planOf,
  geocoder,
  extractor,
  fetch: doFetch,
}: AutofillDeps) {
  const { submissions: limits, extraction, ingest } = config.app;
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
      performers: e.performers ?? [],
    };
  }

  /**
   * The autofill quota, checked before any fetch or LLM call so a used-up quota costs nothing.
   * One fill is taken later, in `prefillsFor`, only when it gave something.
   */
  async function autofillAllowance(user: { id: string }) {
    const { db } = need();
    await limit('autofill', user.id, 3600, limits.autofillPerHour);
    const usage = usageMonth(now(), timeZone);
    const max = quota((await planOf(user)).entitlements, 'autofill.perMonth');
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
   * POST /api/autofill/photo {image, mediaType}: a poster photo, shrunk on the device,
   * read by the LLM into the same prefills as a link. The photo is passed on to be read and is
   * not stored; the event never gets it as its image.
   */
  async function photo(req: Request): Promise<Response> {
    if (!limits.autofill) throw new ApiError(404, 'not_found');
    need();
    const user = await requireUser(req);
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
    need();
    const user = await requireUser(req);
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

  return { autofill, photo, geocode };
}
