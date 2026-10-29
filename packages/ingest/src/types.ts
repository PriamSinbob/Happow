import { z } from 'zod';
import type { Category, HappowEvent, Region, Source } from '@happow/core';
import type { ExtractedEvent, Extractor, KeyValueCache } from '@happow/extract';
import type { HttpClient } from './http.js';
import type { OsmVenue } from './venues/osm.js';

/** One item exactly as a source returned it. Stored unchanged so it can be re-parsed later. */
export interface RawEvent {
  sourceId: string;
  externalId: string;
  sourceUrl: string | null;
  fetchedAt: string;
  payload: unknown;
}

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** A source item mapped to common fields, before config-driven normalization. */
export const parsedEventSchema = z.object({
  externalId: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  /** ISO 8601 instant. */
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }).nullable(),
  /**
   * Source classifications, one list per classification, each most specific label first
   * (["Alternative Rock", "Rock", "Music"]). Mapped via the source's categoryMap.
   */
  categoryLabels: z.array(z.array(z.string())),
  venue: z
    .object({
      externalId: z.string().nullable(),
      name: z.string().min(1),
      address: z.string().nullable(),
      point: latLng.nullable(),
      website: z.string().url().nullable(),
    })
    .nullable(),
  point: latLng.nullable(),
  isFree: z.boolean().nullable(),
  priceMin: z.number().nonnegative().nullable(),
  priceMax: z.number().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  rules: z.object({
    pets: z.string().optional(),
    accessibility: z.string().optional(),
    dress: z.string().optional(),
  }),
  /** Youngest age let in (0 = all ages, 18 = 18+); null when the source says nothing. */
  ageMin: z.number().int().min(0).max(21).nullable().default(null),
  /** Explicitly for children or families. */
  family: z.boolean().nullable().default(null),
  /** Fixed start or come-and-go; null leaves it to the category default. */
  entry: z.enum(['fixed', 'open']).nullable().default(null),
  officialUrl: z.string().url().nullable(),
  ticketUrl: z.string().url().nullable(),
  imageUrl: z.string().url().nullable(),
  status: z.enum(['scheduled', 'cancelled', 'postponed']),
  /** Category ids already in our taxonomy (LLM extraction); used before categoryLabels. */
  categoryIds: z.array(z.string()).optional(),
  /** Address parts to geocode when the source gives no coordinates. */
  locationQuery: z
    .object({
      venueName: z.string().nullable(),
      street: z.string().nullable(),
      postalCode: z.string().nullable(),
      city: z.string().nullable(),
    })
    .optional(),
  /** 0–1; defaults to 1 for API sources. */
  confidence: z.number().min(0).max(1).optional(),
});
export type ParsedEvent = z.infer<typeof parsedEventSchema>;

export interface FetchWindow {
  from: Date;
  to: Date;
}

/** Shared helpers some adapters need (the crawler); absent ones mean the feature is off. */
export interface AdapterServices {
  extractor: Extractor | null;
  extractionCache: KeyValueCache<ExtractedEvent[]>;
  categories: Category[];
  userAgent: string;
  maxInputChars: number;
  maxPageBytes: number;
  /** Accepted website-check candidates in the region (the `venue-sites` source). */
  siteTargets?: SiteTarget[];
  /** Per site after a run: an error, or null and how many events it gave. */
  onSiteResult?: (id: number, error: string | null, events: number) => void;
  /** OSM places with `service_times` (the `worship-services` source, M12 §2.3). */
  worshipPlaces?: OsmVenue[];
}

/** A site an admin accepted from the website check (source_candidates). */
export interface SiteTarget {
  id: number;
  url: string;
  kind: 'ical' | 'tribe' | 'jsonld';
  venueName: string;
  point: { lat: number; lng: number };
}

export interface AdapterContext {
  source: Source;
  region: Region;
  window: FetchWindow;
  http: HttpClient;
  env: Record<string, string | undefined>;
  now: Date;
  services?: AdapterServices;
}

/** One adapter per source type. Everything source-specific (endpoints, sizes, labels) comes from config. */
export interface SourceAdapter {
  fetch(ctx: AdapterContext): Promise<RawEvent[]>;
  /** Null when the item is not a physical event we can place (online-only, no date). */
  parse(raw: RawEvent, ctx: Pick<AdapterContext, 'source' | 'region'>): ParsedEvent | null;
}

export interface VenueRecord {
  id: string;
  name: string;
  address: string | null;
  point: { lat: number; lng: number };
  h3r9: string;
  website: string | null;
}

/** A normalized event plus where it came from; the unit the store deduplicates and writes. */
export interface NormalizedEvent {
  event: HappowEvent;
  venue: VenueRecord | null;
  sourceId: string;
  externalId: string;
  sourceUrl: string | null;
  /** When the event stops being shown unless the source confirms it again (API cache rules). */
  staleAfter: string | null;
}
