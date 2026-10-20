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
  center: latLngSchema,
  defaultZoom: z.number().min(0).max(22),
  bbox: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
  enabledSources: z.array(z.string()),
  seedFile: z.string().optional(),
});
export const regionsConfigSchema = z.object({ regions: z.array(regionSchema).min(1) });

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

export const sourceSchema = z.object({
  id: z.string(),
  adapter: z.string(),
  regionIds: z.array(z.string()),
  schedule: z.string().nullable(),
  rateLimit: z.string().nullable(),
  trustLevel: trustSchema,
  enabled: z.boolean(),
  termsNotes: z.string(),
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
