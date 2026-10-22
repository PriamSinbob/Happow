import {
  eventsFromJsonLd,
  extractJsonLd,
  findLinks,
  htmlToText,
  nextDate,
  parseRobots,
  productToken,
  resolveInstant,
  type ExtractedEvent,
  type Robots,
} from '@happow/extract';
import { HttpError, isTimeout } from '../http.js';
import type { AdapterContext, ParsedEvent, RawEvent, SourceAdapter } from '../types.js';
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
    const robotsByOrigin = new Map<string, Robots>();

    const allowed = async (url: string): Promise<boolean> => {
      const origin = new URL(url).origin;
      let robots = robotsByOrigin.get(origin);
      if (!robots) {
        let txt = '';
        try {
          txt = await ctx.http.text(`${origin}/robots.txt`);
        } catch (err) {
          // No robots.txt (4xx) means no restrictions; anything else, stay away from the site.
          if (!(err instanceof HttpError && err.status >= 400 && err.status < 500)) throw err;
        }
        robots = parseRobots(txt, productToken(services.userAgent));
        robotsByOrigin.set(origin, robots);
      }
      return robots.isAllowed(url);
    };

    const out: RawEvent[] = [];
    const fetchedAt = ctx.now.toISOString();
    const today = localDate(ctx.now, ctx.region.timezone);

    const extract = async (url: string, html: string): Promise<ExtractedEvent[]> => {
      const found = eventsFromJsonLd(extractJsonLd(html), url);
      if (found.length || !opts.llmFallback) return found;
      return llmExtract(services, ctx, {
        url,
        text: htmlToText(html, services.maxInputChars),
        today,
      });
    };

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

    const follow: string[] = [];
    for (const start of opts.startUrls) {
      if (!(await allowed(start))) continue;
      const html = await ctx.http.text(start);
      const listed = await extract(start, html);
      const links = opts.summaryListing
        ? listed.flatMap((e) => (e.url && opts.followPattern?.test(e.url) ? [e.url] : []))
        : opts.followPattern
          ? findLinks(html, start, opts.followPattern)
          : [];
      if (!opts.summaryListing) await collect(start, listed);
      for (const link of links)
        if (!follow.includes(link) && !opts.startUrls.includes(link)) follow.push(link);
    }
    for (const link of follow.slice(0, opts.maxFollow)) {
      if (!(await allowed(link))) continue;
      try {
        const html = await ctx.http.text(link);
        await collect(link, await extract(link, html));
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
    };
  },
};
