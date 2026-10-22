import type { LatLng } from '@happow/core';
import { boundFetch } from './fetch.js';
import type { KeyValueCache } from './types.js';

export interface GeoQuery {
  venueName?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
}

export type GeoPrecision = 'address' | 'venue' | 'postcode';

export interface GeoResult {
  point: LatLng;
  precision: GeoPrecision;
  label: string;
}

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Address → point. Swappable (Nominatim for the PoC, self-hosted Photon later). */
export interface Geocoder {
  geocode(q: GeoQuery, bbox: Bbox): Promise<GeoResult | null>;
}

/** How much a place found at each precision can be trusted for a 500 m radius app. */
export const PRECISION_CONFIDENCE: Record<GeoPrecision, number> = {
  address: 1,
  venue: 0.95,
  postcode: 0.8,
};

export interface NominatimOptions {
  endpoint: string;
  userAgent: string;
  /** Nominatim's usage policy allows at most one request per second. */
  minIntervalMs: number;
  language?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() || null;
/** "ul. Wystawowa 1" → "Wystawowa 1": Nominatim matches street names better without the prefix. */
const street = (s: string | null | undefined) =>
  clean(s)?.replace(/^(ul\.|ulica|al\.|aleja|pl\.|plac|os\.)\s+/i, '') ?? null;

/** OpenStreetMap Nominatim, bounded to the region, tried from most to least precise. */
export class NominatimGeocoder implements Geocoder {
  private next = 0;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: NominatimOptions) {
    this.doFetch = boundFetch(opts.fetch);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async geocode(q: GeoQuery, bbox: Bbox): Promise<GeoResult | null> {
    const city = clean(q.city);
    const postal = clean(q.postalCode);
    const attempts: [GeoPrecision, Record<string, string>][] = [];
    if (street(q.street) && (city || postal))
      attempts.push([
        'address',
        { street: street(q.street)!, ...(city && { city }), ...(postal && { postalcode: postal }) },
      ]);
    if (clean(q.venueName) && (city || postal))
      attempts.push([
        'venue',
        { q: [clean(q.venueName), postal, city].filter(Boolean).join(', ') },
      ]);
    if (postal) attempts.push(['postcode', { postalcode: postal, ...(city && { city }) }]);

    for (const [precision, params] of attempts) {
      const hit = await this.search(params, q.countryCode, bbox, postal);
      if (hit) return { ...hit, precision };
    }
    return null;
  }

  /**
   * One lookup. A hit whose postcode differs from the one we know is a same-named street
   * elsewhere in the bbox (a village's "Wolności 1" for the city's "pl. Wolności 1"): not a match.
   */
  private async search(
    params: Record<string, string>,
    countryCode: string | null | undefined,
    bbox: Bbox,
    postal: string | null,
  ): Promise<{ point: LatLng; label: string } | null> {
    const wait = this.next - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.next = Math.max(Date.now(), this.next) + this.opts.minIntervalMs;

    const search = new URLSearchParams({
      ...params,
      format: 'jsonv2',
      limit: '1',
      viewbox: `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`,
      bounded: '1',
      addressdetails: '1',
      ...(countryCode && { countrycodes: countryCode.toLowerCase() }),
      ...(this.opts.language && { 'accept-language': this.opts.language }),
    });
    const res = await this.doFetch(`${this.opts.endpoint}?${search}`, {
      headers: { 'User-Agent': this.opts.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    const rows = (await res.json()) as {
      lat: string;
      lon: string;
      display_name: string;
      address?: { postcode?: string };
    }[];
    const r = rows[0];
    if (!r) return null;
    const digits = (s: string) => s.replace(/\D/g, '');
    if (postal && r.address?.postcode && digits(r.address.postcode) !== digits(postal)) return null;
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { point: { lat, lng }, label: r.display_name }
      : null;
  }
}

/** Remembers answers, including "not found", so the same address is looked up once. */
export class CachedGeocoder implements Geocoder {
  constructor(
    private readonly inner: Geocoder,
    private readonly cache: KeyValueCache<GeoResult | null>,
  ) {}

  static key(q: GeoQuery, bbox: Bbox): string {
    const norm = (s: string | null | undefined) => clean(s)?.toLowerCase() ?? '';
    return [
      norm(q.venueName),
      norm(street(q.street)),
      norm(q.postalCode),
      norm(q.city),
      norm(q.countryCode),
      [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(3)).join(','),
    ].join('|');
  }

  async geocode(q: GeoQuery, bbox: Bbox): Promise<GeoResult | null> {
    const key = CachedGeocoder.key(q, bbox);
    const hit = await this.cache.get(key);
    if (hit !== undefined) return hit;
    const result = await this.inner.geocode(q, bbox);
    await this.cache.set(key, result);
    return result;
  }
}
