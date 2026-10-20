import { z } from 'zod';
import type { HappowEvent, Region, Source } from '@happow/core';
import type { HttpClient } from './http.js';

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
    age: z.string().optional(),
    pets: z.string().optional(),
    accessibility: z.string().optional(),
    dress: z.string().optional(),
  }),
  officialUrl: z.string().url().nullable(),
  ticketUrl: z.string().url().nullable(),
  imageUrl: z.string().url().nullable(),
  status: z.enum(['scheduled', 'cancelled', 'postponed']),
});
export type ParsedEvent = z.infer<typeof parsedEventSchema>;

export interface FetchWindow {
  from: Date;
  to: Date;
}

export interface AdapterContext {
  source: Source;
  region: Region;
  window: FetchWindow;
  http: HttpClient;
  env: Record<string, string | undefined>;
  now: Date;
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
