import { z } from 'zod';

export const languageSchema = z.enum(['pl', 'en']);

const labelsSchema = z.object({ pl: z.string().min(1), en: z.string().min(1) });
const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const categorySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  labels: labelsSchema,
  defaultDurationMin: z.number().int().positive(),
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export const categoriesConfigSchema = z.object({ categories: z.array(categorySchema).min(1) });

export const regionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: labelsSchema,
  timezone: z.string().min(1),
  locale: languageSchema,
  /** ISO 3166-1 alpha-2, passed to sources that filter by country. */
  countryCode: z.string().length(2).optional(),
  center: latLngSchema,
  defaultZoom: z.number().min(0).max(22),
  bbox: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
  enabledSources: z.array(z.string()),
  seedFile: z.string().optional(),
});
export const regionsConfigSchema = z.object({ regions: z.array(regionSchema).min(1) });

export const timeWindowSchema = z.union([
  z.object({ id: z.string().regex(/^[a-z0-9-]+$/), hours: z.number().nonnegative() }),
  z.object({ id: z.string().regex(/^[a-z0-9-]+$/), endOfDay: z.literal(true) }),
]);

export const appConfigSchema = z.object({
  defaultRegion: z.string(),
  languages: z.array(languageSchema).min(1),
  fallbackLanguage: languageSchema,
  radius: z.object({
    minM: z.number().positive(),
    maxM: z.number().positive(),
    defaultM: z.number().positive(),
  }),
  walkingSpeedMPerMin: z.number().positive(),
  h3: z.object({
    eventResolution: z.number().int().min(0).max(15),
    weatherResolution: z.number().int().min(0).max(15),
  }),
  timeWindows: z.array(timeWindowSchema).min(1),
  defaultTimeWindow: z.string(),
  dedup: z.object({
    /** Two listings starting further apart than this are never the same event. */
    startToleranceMin: z.number().nonnegative(),
    /** Minimum title similarity (0–1) for a merge. */
    titleSimilarity: z.number().min(0).max(1),
    /** H3 rings around the event's cell to search, so venues on a cell edge still match. */
    h3Ring: z.number().int().min(0).max(3),
  }),
  ingest: z.object({
    descriptionMaxChars: z.number().int().positive(),
    /** Fetch from this long ago, so events that started earlier and still run are kept. */
    lookbackHours: z.number().nonnegative(),
    lookaheadHours: z.number().positive(),
    /** Identifies our crawler/API client to providers. */
    userAgent: z.string().min(1),
  }),
});

export const mapConfigSchema = z.object({
  provider: z.string(),
  styleUrl: z.string().url(),
  fallbackRaster: z.object({
    tiles: z.array(z.string()).min(1),
    tileSize: z.number().int().positive(),
    maxZoom: z.number(),
  }),
  attribution: z.string(),
  minZoom: z.number(),
  maxZoom: z.number(),
});

export const trustSchema = z.enum(['api', 'crawled', 'community']);

/** "30m", "2h": how often the scheduler runs a source. */
export const intervalSchema = z.string().regex(/^\d+(m|h)$/, 'use an interval like "30m" or "2h"');
/** "5/s", "200/h": at most N requests per unit. */
export const rateLimitSchema = z.string().regex(/^\d+\/(s|m|h)$/, 'use a rate like "5/s"');

export const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Shown on event details as the source badge ("via Ticketmaster"). */
  name: z.string().min(1),
  adapter: z.string(),
  regionIds: z.array(z.string()),
  schedule: intervalSchema.nullable(),
  rateLimit: rateLimitSchema.nullable(),
  trustLevel: trustSchema,
  enabled: z.boolean(),
  termsNotes: z.string(),
  /** Names of environment variables the adapter needs; the source is skipped when any is missing. */
  secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
  /** Longest time an event may be shown after this source last confirmed it (API terms). */
  maxCacheAgeHours: z.number().positive().optional(),
  /** Adapter-specific settings (endpoints, page sizes). */
  options: z.record(z.unknown()).default({}),
  /** Source classification label (lower-case) → category id. Most specific label wins. */
  categoryMap: z.record(z.string()).default({}),
  /** Categories used when no label maps. */
  defaultCategories: z.array(z.string()).default(['other']),
});
export const sourcesConfigSchema = z.object({ sources: z.array(sourceSchema) });

export const rulesSchema = z.object({
  age: z.string().optional(),
  pets: z.string().optional(),
  accessibility: z.string().optional(),
  dress: z.string().optional(),
});

export const seedVenueSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  website: z.string().url().nullable(),
});

export const seedEventSchema = z.object({
  externalId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  categoryIds: z.array(z.string()).min(1),
  venueId: z.string(),
  startOffsetMin: z.number().int(),
  durationMin: z.number().int().positive().nullable(),
  isFree: z.boolean(),
  priceMin: z.number().nonnegative().optional(),
  priceMax: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  rules: rulesSchema.default({}),
  officialUrl: z.string().url().optional(),
  ticketUrl: z.string().url().optional(),
});

export const seedFileSchema = z.object({
  region: z.string(),
  venues: z.array(seedVenueSchema),
  events: z.array(seedEventSchema),
});
