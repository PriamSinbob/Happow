import { z } from 'zod';

export const languageSchema = z.enum(['pl', 'en']);

const labelsSchema = z.object({ pl: z.string().min(1), en: z.string().min(1) });
const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Fixed: the event starts at a set time (a play, a film). Open: come and go while it runs. */
export const entrySchema = z.enum(['fixed', 'open']);
/** Youngest age let in: 0 = explicitly all ages, 18 = adults only. */
export const ageMinSchema = z.number().int().min(0).max(21);
export const graceMinSchema = z.number().int().min(0).max(120);

export const categorySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  labels: labelsSchema,
  defaultDurationMin: z.number().int().positive(),
  /** Entry type for events whose source does not say. */
  entry: entrySchema,
  /** Fixed entry: minutes after the start that arriving still counts as on time. */
  graceMin: graceMinSchema,
  /**
   * Family mode: "yes" shows every event, "likely" shows events without age information as
   * "not confirmed", "no" hides them. Absent: only events with their own age data count.
   */
  family: z.enum(['yes', 'likely', 'no']).optional(),
  icon: z.string().min(1),
  /** Monochrome glyph from the app's set (apps/web/src/glyphs.ts), on pins, cards and lists. */
  glyph: z
    .string()
    .regex(/^[a-z-]+$/)
    .default('dot'),
  /**
   * Per-event glyph variants: the first rule with a word in the event's title or venue wins
   * (core `eventGlyph`). A word ending in `*` matches any word starting with it.
   */
  glyphRules: z
    .array(
      z.object({
        glyph: z.string().regex(/^[a-z-]+$/),
        words: z.array(z.string().min(1)).min(1),
      }),
    )
    .optional(),
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
  /** City names that count as this region on crawled pages (listings also carry other cities). */
  localities: z.array(z.string().min(1)).optional(),
  /** ISO 4217 code that prices typed into the add-event form are in. */
  currency: z.string().length(3).default('EUR'),
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
  /**
   * Today plus the next days − 1 calendar days in the region's time zone ("week" = 7), so every
   * day starts and ends at local midnight, DST changes included. Served by a longer snapshot.
   */
  z.object({ id: z.string().regex(/^[a-z0-9-]+$/), days: z.number().int().min(1).max(60) }),
]);

export const appConfigSchema = z.object({
  defaultRegion: z.string(),
  languages: z.array(languageSchema).min(1),
  fallbackLanguage: languageSchema,
  radius: z.object({
    minM: z.number().positive(),
    maxM: z.number().positive(),
    defaultM: z.number().positive(),
    /** Reach rail stops (§5), ascending; past the last one is city mode (maxM), via pinch. */
    detentsM: z.array(z.number().positive()).min(2),
  }),
  walkingSpeedMPerMin: z.number().positive(),
  /** When the user would get to an event, for the late (dashed) state of pins. */
  arrival: z.object({
    /** Straight-line distance × this ≈ the walked distance, until routing is used. */
    detourFactor: z.number().min(1),
    /** Open entry: arriving this close to the end counts as too late. */
    openLastEntryMin: z.number().nonnegative(),
  }),
  family: z.object({
    /** "HH:MM" in the region's time zone: later starts are hidden in family mode. */
    latestEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use a time like "21:00"'),
  }),
  /** The dice (§7). */
  dice: z.object({
    /** Rolls only events this close to the user. */
    maxDistanceM: z.number().positive(),
    /** Live events, plus those starting within this many minutes. */
    soonMin: z.number().int().nonnegative(),
    /** An event beyond the reach widens it to the first detent at this × its distance. */
    reachMargin: z.number().min(1),
    /** Categories in the long-press fan. */
    fanSize: z.number().int().positive(),
  }),
  h3: z.object({
    eventResolution: z.number().int().min(0).max(15),
    /** Coarser cells (r8 ≈ 0.7 km²) that events are counted in for hotspots and off-screen hints. */
    densityResolution: z.number().int().min(0).max(15),
  }),
  density: z.object({
    /** How far around the user clusters, hotspots and the nearest event are searched. */
    searchRadiusM: z.number().positive(),
    /** A cell needs at least this many events to be called a hotspot. */
    hotspotMinEvents: z.number().int().positive(),
    /** Off-screen events shown as edge dots at once: the nearest ones (§5). */
    maxEdgeDots: z.number().int().min(0),
    /** Cell size when hotspots are counted on the device (family mode, slice G). */
    deviceCellM: z.number().positive(),
  }),
  timeWindows: z.array(timeWindowSchema).min(1),
  /** The time line under the map (§5, §13.3). */
  timeline: z.object({
    /** A drag ending this close to now snaps back to now. */
    snapNowMin: z.number().nonnegative(),
    /** Otherwise the Today line moves in steps of this many minutes. */
    stepMin: z.number().int().positive(),
    /** Width of the Today histogram's bins. */
    binMin: z.number().int().positive(),
    /** An event from an earlier day counts on a day only if it runs this long into it. */
    carryOverMin: z.number().int().nonnegative(),
  }),
  defaultTimeWindow: z.string(),
  dedup: z.object({
    /** Two listings starting further apart than this are never the same event. */
    startToleranceMin: z.number().nonnegative(),
    /** Minimum title similarity (0–1) for a merge. */
    titleSimilarity: z.number().min(0).max(1),
    /** H3 rings around the event's cell to search, so venues on a cell edge still match. */
    h3Ring: z.number().int().min(0).max(3),
  }),
  geocoding: z.object({
    provider: z.literal('nominatim'),
    endpoint: z.string().url(),
    minIntervalMs: z.number().int().nonnegative(),
    cacheDays: z.number().positive(),
  }),
  /**
   * Battery and data budget: how often the app reloads events and asks for a location fix, and
   * the shared "area" snapshot the server caches (a grid square + radius bucket, the next hours).
   */
  refresh: z.object({
    dataMinutes: z.number().positive(),
    locationMinutes: z.number().positive(),
    /** The search centre follows the user only after they move this far. */
    moveThresholdM: z.number().positive(),
    /** Grid step (degrees) that snaps the user's position to a shared cache key. */
    areaGridDeg: z.number().positive().max(1),
    /** Snapshot radii; the smallest one covering max(radius, density search radius) is used. */
    areaRadiiM: z.array(z.number().positive()).min(1),
    areaHours: z.number().positive().max(48),
    areaMaxEvents: z.number().int().positive(),
    /** Snapshot step for the multi-day windows: future events change slowly. */
    longCacheMinutes: z.number().positive(),
  }),
  /** "Going there": in-app walking route with live location, only while the user asks for it. */
  navigation: z.object({
    routing: z.object({
      provider: z.literal('openrouteservice'),
      endpoint: z.string().url(),
      /** Environment variable with the API key; without it the app draws a direct line. */
      secret: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      attribution: z.string(),
    }),
    routesPerHourPerClient: z.number().int().positive(),
    maxRouteKm: z.number().positive(),
    /** Within this distance of the venue the trip ends and GPS stops. */
    arriveM: z.number().positive(),
    /** Farther than this from the route line asks for a new route (rate-limited below). */
    offRouteM: z.number().positive(),
    rerouteMinSeconds: z.number().positive(),
    maxReroutes: z.number().int().nonnegative(),
    /** Safety cap: live GPS stops after this long. */
    maxMinutes: z.number().positive(),
    /** How often the event itself is re-read while on the way (flags, time changes). */
    eventRefreshSeconds: z.number().positive(),
  }),
  extraction: z.object({
    provider: z.literal('anthropic'),
    model: z.string().min(1),
    effort: z.enum(['low', 'medium', 'high']),
    /** Environment variable holding the API key; without it, LLM extraction is off. */
    secret: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    maxInputChars: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    /** Extractions below this go to the moderation queue instead of the map. */
    minConfidence: z.number().min(0).max(1),
    maxPageBytes: z.number().int().positive(),
    /** Most LLM calls URL autofill may make per day across all users (cost cap). */
    autofillLlmPerDay: z.number().int().nonnegative(),
    /** schema.org Event subtypes (lower-case) → category ids, for every crawled page and URL autofill. */
    schemaTypeMap: z.record(z.string()),
  }),
  submissions: z.object({
    /** URL autofill on the add-event form (planned as a paid add-on; off in the PoC). */
    autofill: z.boolean(),
    /** Show user submissions on the map (as unverified) before a moderator approves them. */
    publishBeforeModeration: z.boolean(),
    /** Devices that must report an event as off (cancelled, venue closed…) before everyone sees it. */
    flagThreshold: z.number().int().min(1),
    maxPerDevicePerDay: z.number().int().positive(),
    autofillPerHourPerClient: z.number().int().positive(),
    reportsPerDayPerDevice: z.number().int().positive(),
    maxDescriptionChars: z.number().int().positive(),
  }),
  /** Inputs to scoreConfidence (see confidence.ts); each is a factor between 0 and 1. */
  confidence: z.object({
    /** By the source's trust level. */
    trust: z.object({
      api: z.number().min(0).max(1),
      crawled: z.number().min(0).max(1),
      community: z.number().min(0).max(1),
    }),
    /** When the source gives no end time. */
    missingEnd: z.number().min(0).max(1),
    /** When the source names no venue, only a street or an area. */
    missingVenue: z.number().min(0).max(1),
  }),
  analytics: z.object({
    /** Plausible site domain; null = no analytics script at all. */
    plausibleDomain: z.string().min(1).nullable(),
    /** Plausible's manual-pageview script (page views carry screen names, not URLs). */
    scriptUrl: z.string().url(),
  }),
  legal: z.object({
    /** Takedown / DSA notice contact shown on the About page. */
    contactEmail: z.string().email().nullable(),
  }),
  ingest: z.object({
    descriptionMaxChars: z.number().int().positive(),
    /** Fetch from this long ago, so events that started earlier and still run are kept. */
    lookbackHours: z.number().nonnegative(),
    lookaheadHours: z.number().positive(),
    /** Identifies our crawler/API client to providers. */
    userAgent: z.string().min(1),
    /** Runs in a row a complete-listing source must miss an event before it is "possibly cancelled". */
    missedRunsToFlag: z.number().int().min(1),
    /**
     * The Worker's Cron Trigger starts the GitHub ingest workflow (workflow_dispatch) only when a
     * source is due, so a frequent schedule costs no CI minutes while nothing is due.
     */
    dispatch: z.object({
      /** owner/name of the repository that runs `.github/workflows/<workflow>`. */
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      workflow: z.string().min(1),
      ref: z.string().min(1),
      /** Name of the Worker secret holding a GitHub token with Actions: write on `repo`. */
      tokenSecret: z.string().min(1),
      skippedBackoffHours: z.number().positive(),
      failedRetryMinutes: z.number().positive(),
      runningTimeoutMinutes: z.number().positive(),
    }),
  }),
});

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'use a colour like "#6A4CF5"');

/** §3.1 colours of one theme: the basemap, the chrome and notices. */
export const themeTokensSchema = z.object({
  land: hex,
  majorRoad: hex,
  minorRoad: hex,
  water: hex,
  park: hex,
  /** Covers unexplored areas (lit map, slice H). */
  veil: hex,
  veilOpacity: z.number().min(0).max(1),
  /** Text and glyphs. */
  ink: hex,
  muted: hex,
  /** Cards, sheets, pins. */
  paper: hex,
  /** Subtle fills on paper (segmented controls, chips). */
  paper2: hex,
  /** The track behind toggles (§15). */
  sunken: hex,
  /** A toggle that is on, and what sits on it (§15). */
  raised: hex,
  onRaised: hex,
  line: hex,
  /** Behind dialogs, at partial opacity. */
  scrim: hex,
  warn: hex,
  warnInk: hex,
  error: hex,
  errorInk: hex,
});

const liveSchema = z.object({ live: hex, onLive: hex });

/** A live-hue preset (§3.2): the one colour that means "on now", and the glyph on it. */
export const themePresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  labels: labelsSchema,
  /** Who may pick it: everyone, signed-in users, premium (§8). */
  tier: z.enum(['anonymous', 'account', 'premium']),
  day: liveSchema,
  night: liveSchema,
});

export const themeConfigSchema = z.object({
  themes: z.object({ day: themeTokensSchema, night: themeTokensSchema }),
  presets: z.array(themePresetSchema).min(1),
  defaultPreset: z.string(),
  /** §3.2: every preset must meet these in both themes (checked by the contrast test). */
  rules: z.object({
    minGlyphContrast: z.number().min(1),
    minLandContrast: z.number().min(1),
    minHueDistance: z.number().min(0).max(180),
    minInkContrast: z.number().min(1),
    minMutedContrast: z.number().min(1),
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
  /**
   * Basemap recolouring per theme: layer ids of the style (a trailing "*" matches a prefix) and
   * the paint properties to set to a theme token. Layers not listed keep the style's colours.
   */
  themeLayers: z
    .array(
      z.object({
        layers: z.array(z.string().min(1)).min(1),
        paint: z.record(themeTokensSchema.keyof()),
      }),
    )
    .default([]),
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
  /** Crawled pages: facts only. Store the page's description / images only where allowed. */
  republishDescription: z.boolean().default(true),
  republishImages: z.boolean().default(true),
  /**
   * The source returns every event it has in the fetch window (official APIs), so an event it
   * stops returning may be off: after `ingest.missedRunsToFlag` runs it shows "possibly cancelled".
   */
  completeListing: z.boolean().default(false),
  /**
   * Single-venue sources (a concert hall, theatre, club): where an event is when its page gives
   * no location at all. Geocoded through the normal pipeline, so no coordinates live here.
   */
  defaultVenue: z
    .object({
      name: z.string().min(1),
      street: z.string().min(1),
      postalCode: z.string().nullable().default(null),
      city: z.string().min(1),
      /** Other names for the building, so its halls ("NFM, Sala Czerwona") resolve to it. */
      aliases: z.array(z.string().min(1)).default([]),
    })
    .optional(),
});
export const sourcesConfigSchema = z.object({ sources: z.array(sourceSchema) });

/** Free-text extras shown on the card. Age has its own fields (`ageMin`, `family`). */
export const rulesSchema = z.object({
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
  ageMin: ageMinSchema.optional(),
  family: z.boolean().optional(),
  entry: entrySchema.optional(),
  officialUrl: z.string().url().optional(),
  ticketUrl: z.string().url().optional(),
});

export const seedFileSchema = z.object({
  region: z.string(),
  venues: z.array(seedVenueSchema),
  events: z.array(seedEventSchema),
});
