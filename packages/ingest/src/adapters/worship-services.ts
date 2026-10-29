import { localDay } from '@happow/core';
import { resolveInstant } from '@happow/extract';
import type { AdapterContext, ParsedEvent, RawEvent, SourceAdapter } from '../types.js';
import type { OsmVenue } from '../venues/osm.js';
import { parseServiceTimes, serviceDates } from '../venues/services.js';

/** What one service carries from fetch to parse. */
export interface ServicePayload {
  place: Pick<OsmVenue, 'osmId' | 'name' | 'address' | 'point' | 'website'>;
  /** Wall-clock values in the region's time zone. */
  start: string;
  end: string | null;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);

/**
 * Regular services at places of worship (M12 §2.3), from the OSM venues slice C loads: each
 * place's `service_times` becomes one event per service for the next `options.horizonDays` (14).
 * They are never merged into one card (time-first); a report from the card removes one. The
 * title, the confidence and the category come from the source's config.
 */
export const worshipServices: SourceAdapter = {
  async fetch(ctx: AdapterContext): Promise<RawEvent[]> {
    const places = ctx.services?.worshipPlaces;
    if (!places) throw new Error('worship-services needs the OSM venues');
    const { options } = ctx.source;
    const horizon = num(options.horizonDays, 14);
    const today = localDay(ctx.now, ctx.region.timezone);
    const fetchedAt = ctx.now.toISOString();
    const out: RawEvent[] = [];
    for (const p of places) {
      if (!p.serviceTimes) continue;
      const { rules } = parseServiceTimes(p.serviceTimes);
      for (const d of serviceDates(rules, today, horizon)) {
        const at = resolveInstant(d.start, ctx.region.timezone)?.at;
        // Today's services already over are left out.
        if (!at || at.getTime() < ctx.now.getTime()) continue;
        out.push({
          sourceId: ctx.source.id,
          externalId: `${p.osmId}|${d.start}`,
          sourceUrl: p.website,
          fetchedAt,
          payload: {
            place: {
              osmId: p.osmId,
              name: p.name,
              address: p.address,
              point: p.point,
              website: p.website,
            },
            start: d.start,
            end: d.end,
          } satisfies ServicePayload,
        });
      }
    }
    return out;
  },

  parse(raw: RawEvent, { source, region }): ParsedEvent | null {
    const { place, start, end } = raw.payload as ServicePayload;
    const startAt = resolveInstant(start, region.timezone)?.at;
    if (!startAt) return null;
    const endAt = end ? resolveInstant(end, region.timezone)?.at : null;
    const title = typeof source.options.title === 'string' ? source.options.title : place.name;
    return {
      externalId: raw.externalId,
      sourceUrl: raw.sourceUrl,
      title,
      description: null,
      startAt: startAt.toISOString(),
      endAt: endAt ? endAt.toISOString() : null,
      categoryLabels: [],
      categoryIds: source.defaultCategories,
      venue: {
        externalId: place.osmId,
        name: place.name,
        address: place.address,
        point: place.point,
        website: place.website,
      },
      point: place.point,
      isFree: true,
      priceMin: 0,
      priceMax: 0,
      currency: null,
      rules: {},
      ageMin: null,
      family: null,
      entry: 'fixed',
      officialUrl: place.website,
      ticketUrl: null,
      imageUrl: null,
      status: 'scheduled',
      confidence: num(source.options.confidence, 0.8),
    };
  },
};
