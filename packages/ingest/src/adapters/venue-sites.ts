import {
  eventsFromJsonLd,
  extractJsonLd,
  resolveInstant,
  type ExtractedEvent,
} from '@happow/extract';
import { robotsGate } from '../robots.js';
import type { AdapterContext, RawEvent, SiteTarget, SourceAdapter } from '../types.js';
import { readIcal, readTribe, tribeFirstPage, type TribePage } from '../venues/formats.js';
import { crawler, type CrawlPayload } from './crawler.js';
import { inRegion, sha256 } from './extraction.js';

/** Pages of The Events Calendar's API read per site and run (50 events each). */
const TRIBE_MAX_PAGES = 4;

/**
 * Sites an admin accepted from the website check (M12 §2.2): iCal feeds, The Events Calendar's
 * REST API and pages with Event JSON-LD. The list comes from `source_candidates`, not config;
 * the source itself (trust, schedule, terms) is in config/sources.json. Items reuse the crawler's
 * payload and parse step. An event with no place of its own is at the site's venue.
 */
export const venueSites: SourceAdapter = {
  async fetch(ctx: AdapterContext): Promise<RawEvent[]> {
    const services = ctx.services;
    if (!services) throw new Error('venue-sites needs adapter services');
    const targets = services.siteTargets ?? [];
    const allowed = robotsGate(ctx.http, services.userAgent);
    const horizonDays =
      typeof ctx.source.options.horizonDays === 'number' ? ctx.source.options.horizonDays : 60;
    const from = ctx.window.from;
    const to = new Date(ctx.now.getTime() + horizonDays * 86_400_000);
    const fetchedAt = ctx.now.toISOString();
    const out: RawEvent[] = [];

    const read = async (t: SiteTarget): Promise<ExtractedEvent[]> => {
      if (!(await allowed(t.url))) throw new Error('robots.txt disallows it now');
      if (t.kind === 'ical')
        return readIcal(await ctx.http.text(t.url), t.url, {
          timeZone: ctx.region.timezone,
          from,
          to,
        });
      if (t.kind === 'jsonld')
        return eventsFromJsonLd(extractJsonLd(await ctx.http.text(t.url)), t.url);
      const origin = new URL(t.url).origin;
      const events: ExtractedEvent[] = [];
      let next: string | undefined = tribeFirstPage(t.url, ctx.now);
      for (let n = 0; next && n < TRIBE_MAX_PAGES; n++) {
        let page: TribePage;
        try {
          page = await ctx.http.json<TribePage>(next);
        } catch (err) {
          // A later page failing keeps the pages already read.
          if (n === 0) throw err;
          break;
        }
        events.push(...readTribe(page, t.url));
        // Only the site's own next page: never follow the API to another host.
        next =
          page.next_rest_url && new URL(page.next_rest_url, t.url).origin === origin
            ? page.next_rest_url
            : undefined;
      }
      return events;
    };

    for (const t of targets) {
      let events: ExtractedEvent[];
      try {
        events = await read(t);
      } catch (err) {
        // One failing site must not lose the others; it is counted towards pausing it.
        services.onSiteResult?.(t.id, (err as Error).message.slice(0, 300), 0);
        continue;
      }
      let kept = 0;
      for (const found of events) {
        if (found.online) continue;
        const start = resolveInstant(found.start, ctx.region.timezone)?.at.getTime();
        if (start === undefined || start > to.getTime()) continue;
        const end = found.end
          ? resolveInstant(found.end, ctx.region.timezone)?.at.getTime()
          : start;
        if ((end ?? start) < from.getTime()) continue;
        // No place of its own: the site's venue.
        const event: ExtractedEvent =
          found.point || found.venueName || found.address.street
            ? found
            : { ...found, venueName: t.venueName, point: t.point };
        if (!inRegion(event, ctx)) continue;
        const id = (
          await sha256(`${t.url}|${event.url ?? ''}|${event.start}|${event.title}`)
        ).slice(0, 24);
        out.push({
          sourceId: ctx.source.id,
          externalId: id,
          sourceUrl: event.url ?? t.url,
          fetchedAt,
          payload: { pageUrl: t.url, event } satisfies CrawlPayload,
        });
        kept++;
      }
      services.onSiteResult?.(t.id, null, kept);
    }
    return out;
  },

  parse: crawler.parse,
};
