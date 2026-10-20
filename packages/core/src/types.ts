import type { z } from 'zod';
import type {
  appConfigSchema,
  categorySchema,
  languageSchema,
  mapConfigSchema,
  regionSchema,
  rulesSchema,
  seedFileSchema,
  sourceSchema,
  timeWindowSchema,
  trustSchema,
} from './schemas.js';

export type Language = z.infer<typeof languageSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Region = z.infer<typeof regionSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type MapConfig = z.infer<typeof mapConfigSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Trust = z.infer<typeof trustSchema>;
export type EventRules = z.infer<typeof rulesSchema>;
export type SeedFile = z.infer<typeof seedFileSchema>;
export type TimeWindow = z.infer<typeof timeWindowSchema>;

export interface LatLng {
  lat: number;
  lng: number;
}

export type EventStatus = 'scheduled' | 'cancelled' | 'postponed';

/** Normalized event, mirroring the `events` table (schema.org/Event-shaped). */
export interface HappowEvent {
  id: string;
  title: string;
  description: string | null;
  categoryIds: string[];
  startAt: string; // ISO 8601
  endAt: string; // ISO 8601; estimated from the category default when the source gives none
  endEstimated: boolean;
  timezone: string;
  venue: { id: string; name: string; address: string | null; website?: string | null } | null;
  point: LatLng;
  h3r9: string;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  isFree: boolean;
  rules: EventRules;
  officialUrl: string | null;
  ticketUrl: string | null;
  imageUrl: string | null;
  status: EventStatus;
  trust: Trust;
  confidence: number;
  lastSeenAt: string;
  /** The source whose listing fills the primary fields, and that listing's page. */
  sourceId?: string | null;
  sourceUrl?: string | null;
}

/** An event plus its distance from the query point. */
export interface NearbyEvent extends HappowEvent {
  distanceM: number;
}

export type PriceFilter = 'any' | 'free' | 'paid';

export interface EventFilters {
  /** Category ids; empty means every category. */
  categories: string[];
  price: PriceFilter;
}

export interface EventQuery extends Partial<EventFilters> {
  center: LatLng;
  radiusM: number;
  from: Date;
  to: Date;
}
