import {
  eventsFromJsonLd,
  extractJsonLd,
  findLinks,
  findUrlsInText,
  htmlToText,
  nextDate,
  parseTdmRep,
  reservedByHeader,
  reservedByMeta,
  reservedByRules,
  resolveInstant,
  type ExtractedEvent,
  type TdmRule,
} from '@happow/extract';
import { HttpError, isTimeout } from '../http.js';
import { robotsGate } from '../robots.js';
import type { AdapterContext, PageEntry, ParsedEvent, RawEvent, SourceAdapter } from '../types.js';
import { inRegion, llmExtract, localDate, sha256 } from './extraction.js';

/** What a crawled item carries into raw_payloads: the page it came from and the extraction. */
export interface CrawlPayload {
  pageUrl: string;
  event: ExtractedEvent;
}

interface CrawlOptions {
  startUrls: string[];
  followPattern: RegExp | null;
  maxFollow: number;
  llmFallback: boolean;
  /**
   * The start pages list one summary item per show or tour (first date, several cities), not
   * performances: store nothing from them and follow each item's own page (matching
   * `followPattern`) for the real dates and venues.
   */
  summaryListing: boolean;
  /** Occurrences further ahead than this are not stored (series can list a year of dates). */
  horizonDays: number;
  /** Also follow matching URLs found in the page's text (links rendered from embedded JSON). */
  followInText: boolean;
}

function options(ctx: AdapterContext): CrawlOptions {
  const o = ctx.source.options;
  const startUrls = Array.isArray(o.startUrls)
    ? o.startUrls.filter((u) => typeof u === 'string')
    : [];
  if (!startUrls.length) throw new Error(`source "${ctx.source.id}": options.startUrls is empty`);
  return {
    startUrls,
    followPattern: typeof o.followPattern === 'string' ? new RegExp(o.followPattern) : null,
    maxFollow: typeof o.maxFollow === 'number' ? o.maxFollow : 0,
    llmFallback: o.llmFallback === true,
    summaryListing: o.summaryListing === true,
    horizonDays: typeof o.horizonDays === 'number' ? o.horizonDays : 60,
    followInText: o.followInText === true,
  };
}

/**
 * Generic crawler for venues, ticketing sites and portals. Reads schema.org Event JSON-LD from
 * the start pages and from linked event pages; pages without it go to LLM extraction when the
 * source allows it. robots.txt is honoured for every URL.
 */
export const crawler: SourceAdapter = {
  async fetch(ctx: AdapterContext): Promise<RawEvent[]> {
    const opts = options(ctx);
    const services = ctx.services;
    if (!services) throw new Error('crawler needs adapter services');
    const allowed = robotsGate(ctx.http, services.userAgent);

    const out: RawEvent[] = [];
    const fetchedAt = ctx.now.toISOString();
    const today = localDate(ctx.now, ctx.region.timezone);

    const earliest = ctx.window.from.getTime() - 24 * 3_600_000;
    const latest = ctx.now.getTime() + opts.horizonDays * 24 * 3_600_000;
    const collect = async (url: string, events: ExtractedEvent[]) => {
      for (const event of events) {
        if (event.online || !inRegion(event, ctx)) continue;
        const start = resolveInstant(event.start, ctx.region.timezone)?.at.getTime();
        if (start === undefined || start < earliest || start > latest) continue;
        const pageUrl = url;
        const id = (await sha256(`${event.url ?? pageUrl}|${event.start}|${event.title}`)).slice(
          0,
          24,
        );
        out.push({
          sourceId: ctx.source.id,
          externalId: id,
          sourceUrl: event.url ?? pageUrl,
          fetchedAt,
          payload: { pageUrl, event } satisfies CrawlPayload,
        });
      }
    };

    // Politeness (M13 §3): validators and content hashes per page, TDM reservations per origin.
    const pages = services.pages;
    const polite = services.politeness;
    const tdmRules = new Map<string, Promise<TdmRule[]>>();
    const rulesFor = (origin: string) => {
      let r = tdmRules.get(origin);
      if (!r) {
        r = ctx.http
          .text(`${origin}/.well-known/tdmrep.json`)
          .then(parseTdmRep)
          .catch(() => []);
        tdmRules.set(origin, r);
      }
      return r;
    };
    const reserved = async (url: string, headers: Headers, html: string) => {
      if (!polite?.respectTdm) return false;
      const u = new URL(url);
      return (
        reservedByHeader(headers) ||
        reservedByMeta(html) ||
        reservedByRules(await rulesFor(u.origin), u.pathname)
      );
    };
    /** JSON-LD first; the LLM only when the page has none, allows it and reserves no TDM rights. */
    const extract = async (
      url: string,
      html: string,
      headers: Headers = new Headers(),
    ): Promise<ExtractedEvent[]> => {
      const found = eventsFromJsonLd(extractJsonLd(html), url);
      if (found.length || !opts.llmFallback) return found;
      if (await reserved(url, headers, html)) {
        if (polite) polite.stats.tdmReserved++;
        return found;
      }
      return llmExtract(services, ctx, {
        url,
        text: htmlToText(html, services.maxInputChars),
        today,
      });
    };
    const farAhead = (events: ExtractedEvent[]) => {
      const min = ctx.now.getTime() + (polite?.revisitFarDays ?? 0) * 86_400_000;
      return events.every(
        (e) => (resolveInstant(e.start, ctx.region.timezone)?.at.getTime() ?? 0) >= min,
      );
    };
    /** One page's events and links, from the network or, when nothing changed, the cache. */
    const read = async (
      url: string,
      linksOf: (html: string, events: ExtractedEvent[]) => string[],
      follow: boolean,
    ): Promise<Pick<PageEntry, 'events' | 'links'>> => {
      const cached = pages ? await pages.get(url) : undefined;
      const stats = polite?.stats;
      if (
        cached &&
        follow &&
        polite &&
        ctx.now.getTime() - Date.parse(cached.fetchedAt) < polite.revisitHours * 3_600_000 &&
        cached.events.length > 0 &&
        farAhead(cached.events)
      ) {
        if (stats) stats.revisitSkipped++;
        return cached;
      }
      const r = await ctx.http.page(
        url,
        cached && polite?.conditionalRequests ? cached : undefined,
      );
      const keep = async (entry: PageEntry) => {
        if (pages) await pages.set(url, entry);
        return entry;
      };
      if (r.status === 304 && cached) {
        if (stats) stats.notModified++;
        return keep({ ...cached, fetchedAt });
      }
      if (r.status === 304) return { events: [], links: [] };
      const hash = await sha256(r.body);
      const meta = { etag: r.etag, lastModified: r.lastModified, hash, fetchedAt };
      if (cached && cached.hash === hash) {
        if (stats) stats.unchanged++;
        return keep({ ...cached, ...meta });
      }
      const events = await extract(url, r.body, r.headers);
      return keep({ ...meta, events, links: linksOf(r.body, events) });
    };

    const follow: string[] = [];
    for (const start of opts.startUrls) {
      if (!(await allowed(start))) continue;
      const { events: listed, links } = await read(
        start,
        (html, found) =>
          opts.summaryListing
            ? found.flatMap((e) => (e.url && opts.followPattern?.test(e.url) ? [e.url] : []))
            : opts.followPattern
              ? [
                  ...new Set([
                    ...findLinks(html, start, opts.followPattern),
                    ...(opts.followInText ? findUrlsInText(html, opts.followPattern) : []),
                  ]),
                ]
              : [],
        false,
      );
      if (!opts.summaryListing) await collect(start, listed);
      for (const link of links)
        if (!follow.includes(link) && !opts.startUrls.includes(link)) follow.push(link);
    }
    for (const link of follow.slice(0, opts.maxFollow)) {
      if (!(await allowed(link))) continue;
      try {
        await collect(link, (await read(link, () => [], true)).events);
      } catch (err) {
        // One broken or slow event page must not lose the rest of the crawl.
        if (err instanceof HttpError && err.status >= 400 && err.status < 500) continue;
        if (isTimeout(err)) continue;
        throw err;
      }
    }
    return out;
  },

  parse(raw: RawEvent, { region }): ParsedEvent | null {
    const { event: e, pageUrl } = raw.payload as CrawlPayload;
    const start = resolveInstant(e.start, region.timezone);
    if (!start) return null;
    const end = e.end ? resolveInstant(e.end, region.timezone) : null;
    let endAt: Date | null = end ? end.at : null;
    // Portals also write date-only runs as clock times: "2026-10-23T00:00" → "2026-10-29T23:59"
    // (a week-long festival). Midnight to the end of a later day is whole days, not a timed show.
    const wholeDays =
      !!e.end && /T00:00(?::00)?$/.test(e.start) && /T(23:59|00:00)(?::\d\d)?$/.test(e.end);
    if (wholeDays && e.end!.slice(0, 10) > e.start.slice(0, 10)) {
      // "…T00:00" already is the next day's start; "…T23:59" runs through that date.
      endAt = /T00:00/.test(e.end!)
        ? end!.at
        : (resolveInstant(nextDate(e.end!.slice(0, 10)), region.timezone)?.at ?? null);
    } else if (start.allDay && (!end || end.allDay)) {
      // Date-only listing: whole days, through the end date (or the start date).
      endAt =
        resolveInstant(nextDate((e.end ?? e.start).slice(0, 10)), region.timezone)?.at ?? null;
    } else if (endAt && endAt.getTime() - start.at.getTime() > 24 * 3_600_000) {
      // A timed show with a far end date is a multi-date run (tours, repertoire): end unknown.
      endAt = null;
    }

    // URL path segments ("/muzyka/piosenka/…", "/wydarzenia/dla-dzieci/…") are useful category hints.
    const pathHints = (u: string | null) =>
      u ? new URL(u).pathname.split('/').filter((s) => s && !/^\d/.test(s)) : [];
    const address = [
      e.address.street,
      [e.address.postalCode, e.address.city].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');

    return {
      externalId: raw.externalId,
      sourceUrl: raw.sourceUrl,
      title: e.title,
      description: e.description,
      startAt: start.at.toISOString(),
      endAt: endAt ? endAt.toISOString() : null,
      categoryLabels: [e.categoryHints, pathHints(e.url ?? pageUrl)].filter((l) => l.length),
      categoryIds: e.categoryIds,
      venue:
        e.venueName || address
          ? {
              externalId: null,
              name: e.venueName ?? address,
              address: address || null,
              point: e.point,
              website: null,
            }
          : null,
      point: e.point,
      isFree: e.isFree,
      priceMin: e.priceMin,
      priceMax: e.priceMax,
      currency: e.currency,
      rules: {},
      // Extractions cached before these fields existed lack them.
      ageMin: e.ageMin ?? null,
      family: e.family ?? null,
      entry: e.entry ?? null,
      officialUrl: e.url ?? pageUrl,
      ticketUrl: e.ticketUrl,
      imageUrl: e.imageUrl,
      status: e.status,
      locationQuery: {
        venueName: e.venueName,
        street: e.address.street,
        postalCode: e.address.postalCode,
        city: e.address.city,
      },
      confidence: e.confidence,
      performers: (e.performers ?? []).map((name) => ({ name })),
    };
  },
};
