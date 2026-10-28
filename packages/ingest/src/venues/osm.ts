import type { HappowConfig, LatLng } from '@happow/core';
import { titleSimilarity } from '../dedup.js';
import { overpassBbox, type OverpassElement } from '../overpass.js';

/** A venue as OSM lists it (osm_venues). */
export interface OsmVenue {
  osmId: string;
  name: string;
  kind: string;
  point: LatLng;
  address: string | null;
  website: string | null;
  openingHours: string | null;
  wheelchair: string | null;
  serviceTimes: string | null;
}

type VenueConfig = HappowConfig['app']['venues'];

/** One query for every configured tag, nodes, ways and relations, with way/relation centres. */
export function venueQuery(tags: VenueConfig['osmTags'], bbox: Parameters<typeof overpassBbox>[0]) {
  const box = overpassBbox(bbox);
  const parts = Object.entries(tags).map(
    ([key, values]) => `nwr["${key}"~"^(${values.join('|')})$"]["name"]${box};`,
  );
  return `[out:json][timeout:120];(${parts.join('')});out center tags;`;
}

/** "example.org" or "http://example.org/x" → an https-able absolute URL; null if it is not one. */
export function websiteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(';')[0]!.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(first) ? first : `https://${first}`);
    if (!/\./.test(u.hostname)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function parseOsmVenues(
  elements: OverpassElement[],
  tags: VenueConfig['osmTags'],
): OsmVenue[] {
  const out: OsmVenue[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    const name = t.name?.trim();
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!name || lat === undefined || lon === undefined) continue;
    const key = Object.keys(tags).find((k) => t[k] && tags[k]!.includes(t[k]!));
    if (!key) continue;
    const street = [t['addr:street'] ?? t['addr:place'], t['addr:housenumber']]
      .filter(Boolean)
      .join(' ');
    const town = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
    out.push({
      osmId: `${e.type}/${e.id}`,
      name,
      kind: `${key}=${t[key]}`,
      point: { lat, lng: lon },
      address: [street, town].filter(Boolean).join(', ') || null,
      website: websiteUrl(t.website ?? t['contact:website'] ?? t.url),
      openingHours: t.opening_hours ?? null,
      wheelchair: t.wheelchair ?? null,
      serviceTimes: t.service_times ?? null,
    });
  }
  return out;
}

export function distanceM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** A venue events use, as the linker sees it. */
export interface EventVenue {
  id: string;
  name: string;
  point: LatLng;
  osmId: string | null;
  osmPoint: LatLng | null;
}

export interface VenueLink {
  venueId: string;
  osmId: string;
  similarity: number;
  distanceM: number;
  /** OSM's point when the pin should move there; null leaves the pin where the source put it. */
  moveTo: LatLng | null;
}

/**
 * Links each event venue to the OSM venue with the most similar name within `radiusM`. A pin
 * moves only on a close name match and a real distance (`minMoveM`). The venue's own point
 * (from its source) is measured, not an earlier OSM point, so a link can also be dropped.
 */
export function linkVenues(
  venues: EventVenue[],
  osm: OsmVenue[],
  cfg: VenueConfig['link'],
): VenueLink[] {
  const links: VenueLink[] = [];
  for (const v of venues) {
    let best: { o: OsmVenue; sim: number; d: number } | null = null;
    for (const o of osm) {
      const d = distanceM(v.point, o.point);
      if (d > cfg.radiusM) continue;
      const sim = titleSimilarity(v.name, o.name);
      if (sim < cfg.minSimilarity) continue;
      if (!best || sim > best.sim || (sim === best.sim && d < best.d)) best = { o, sim, d };
    }
    if (!best) continue;
    const move = best.sim >= cfg.moveSimilarity && best.d >= cfg.minMoveM;
    links.push({
      venueId: v.id,
      osmId: best.o.osmId,
      similarity: Math.round(best.sim * 100) / 100,
      distanceM: Math.round(best.d),
      moveTo: move ? best.o.point : null,
    });
  }
  return links;
}
