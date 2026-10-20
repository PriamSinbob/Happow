import { h3Cell } from './h3.js';
import { resolveEnd } from './events.js';
import { seedFileSchema } from './schemas.js';
import type { Category, HappowEvent, Region } from './types.js';

/**
 * Turn the hand-entered seed file (times as offsets) into concrete events anchored at `now`.
 * Used by the DB seed script and by the web app's offline fallback, so both see identical data.
 */
export function materializeSeed(
  raw: unknown,
  region: Region,
  categories: Category[],
  now: Date,
  h3Resolution: number,
): HappowEvent[] {
  const seed = seedFileSchema.parse(raw);
  const venues = new Map(seed.venues.map((v) => [v.id, v]));
  const durations = new Map(categories.map((c) => [c.id, c.defaultDurationMin]));
  // Round the anchor to 5 minutes so times read like real listings (18:05, not 18:07).
  const anchor = Math.floor(now.getTime() / 300_000) * 300_000;

  return seed.events.map((e) => {
    const venue = venues.get(e.venueId);
    if (!venue) throw new Error(`seed event ${e.externalId}: unknown venue "${e.venueId}"`);
    for (const c of e.categoryIds)
      if (!durations.has(c)) throw new Error(`seed event ${e.externalId}: unknown category "${c}"`);
    const startAt = new Date(anchor + e.startOffsetMin * 60_000);
    const { endAt, endEstimated } = resolveEnd(
      startAt,
      e.durationMin ? new Date(startAt.getTime() + e.durationMin * 60_000) : null,
      e.categoryIds,
      (c) => durations.get(c),
    );
    const point = { lat: venue.lat, lng: venue.lng };
    return {
      id: `${region.id}:${e.externalId}`,
      title: e.title,
      description: e.description ?? null,
      categoryIds: e.categoryIds,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      endEstimated,
      timezone: region.timezone,
      venue: { id: venue.id, name: venue.name, address: venue.address, website: venue.website },
      point,
      h3r9: h3Cell(point, h3Resolution),
      priceMin: e.priceMin ?? (e.isFree ? 0 : null),
      priceMax: e.priceMax ?? (e.isFree ? 0 : null),
      currency: e.currency ?? null,
      isFree: e.isFree,
      rules: e.rules,
      officialUrl: e.officialUrl ?? venue.website,
      ticketUrl: e.ticketUrl ?? null,
      imageUrl: null,
      status: 'scheduled',
      trust: 'community',
      confidence: 1,
      lastSeenAt: new Date(now).toISOString(),
      sourceId: 'seed',
      sourceUrl: null,
    };
  });
}

export function seedVenues(raw: unknown) {
  return seedFileSchema.parse(raw).venues;
}

export { h3Cell } from './h3.js';
