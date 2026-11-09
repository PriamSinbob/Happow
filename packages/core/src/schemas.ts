import { z } from 'zod';

export const languageSchema = z.enum(['pl', 'en']);

const labelsSchema = z.object({ pl: z.string().min(1), en: z.string().min(1) });
const emailTemplateSchema = z.object({ subject: z.string().min(1), body: z.string().min(1) });
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
  /**
   * false: never show public attendance counts (going, co-presence, a sharer's link count) for
   * this category's events, because they would reveal religion or politics (GDPR Art. 9).
   * People can still mark themselves, for an opt-in friends' view.
   */
  publicAttendance: z.boolean().default(true),
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
  /**
   * District boundaries for the metrics: a GeoJSON file written by `pnpm districts` from
   * OSM `boundary=administrative` relations at this `admin_level`, inside the bbox.
   */
  districts: z
    .object({ file: z.string().min(1), adminLevel: z.number().int().min(2).max(11) })
    .optional(),
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
    /** Reach rail stops, ascending; past the last one is city mode (maxM), via pinch. */
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
  /** The dice. */
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
  /** The local atlas and the veil over the map. Kept on the device only. */
  atlas: z.object({
    /** H3 resolution of the recorded cells (9 ≈ 0.1 km²). */
    resolution: z.number().int().min(0).max(15),
    /** Location fixes less precise than this are not recorded. */
    maxAccuracyM: z.number().positive(),
    /** The app hidden this long starts a new session: a cell counts once per session. */
    sessionGapMin: z.number().positive(),
    /** Half the side of the veil canvas, around the area snapshot's centre. */
    veilRadiusM: z.number().positive(),
    /** Veil canvas size; low on purpose, the GPU's upscaling softens the edges. */
    canvasPx: z.number().int().min(64).max(2048),
    /** The veil is at full opacity from `full` in and gone at `gone` (city scale). */
    fadeZoom: z.object({ full: z.number(), gone: z.number() }),
    /** How clear a cell gets: opens are faint, arrivals strong, repeats brighter. */
    strength: z.object({
      open: z.number().min(0).max(1),
      arrival: z.number().min(0).max(1),
      repeat: z.number().min(0).max(1),
    }),
    blobsPerCell: z.number().int().min(1).max(12),
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
    /** Off-screen events shown as edge dots at once: the nearest ones. */
    maxEdgeDots: z.number().int().min(0),
    /** Cell size when hotspots are counted on the device (family mode). */
    deviceCellM: z.number().positive(),
  }),
  timeWindows: z.array(timeWindowSchema).min(1),
  /** The time line under the map. */
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
    /** Same place for the reward check: about what h3Ring 1 covers at resolution 9. */
    radiusM: z.number().positive(),
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
    /** Poster photos for autofill: the largest decoded image the API accepts. */
    photo: z.object({
      maxBytes: z.number().int().positive(),
      /** Shrunk on the device first: the long edge in px, and the JPEG quality (0–1). */
      maxEdge: z.number().int().positive(),
      jpegQuality: z.number().min(0.1).max(1),
    }),
    /** schema.org Event subtypes (lower-case) → category ids, for every crawled page and URL autofill. */
    schemaTypeMap: z.record(z.string()),
  }),
  submissions: z.object({
    /**
     * URL autofill on the add-event form: off, or for signed-in accounts within their monthly
     * quota (`autofill.perMonth`).
     */
    autofill: z.union([z.literal(false), z.literal('account')]),
    /**
     * Who may add events: "optional" = anyone, and submissions from an account count against its
     * monthly quota; "required" = accounts only (switched on with the form's sign-in).
     */
    account: z.enum(['optional', 'required']),
    /** Show user submissions on the map (as unverified) before a moderator approves them. */
    publishBeforeModeration: z.boolean(),
    /** Devices that must report an event as off (cancelled, venue closed…) before everyone sees it. */
    flagThreshold: z.number().int().min(1),
    /** Without an account: per device, and three times this per client IP. */
    maxPerDevicePerDay: z.number().int().positive(),
    /** With an account: a guard against loops on top of the monthly quota. */
    perHourPerAccount: z.number().int().positive(),
    /** Autofills per account per hour (loops); geocoding allows four times this per client IP. */
    autofillPerHour: z.number().int().positive(),
    reportsPerDayPerDevice: z.number().int().positive(),
    maxDescriptionChars: z.number().int().positive(),
    /**
     * "Happening here, now" on the add form: offered only with a location fix at least
     * this precise; the start is now, rounded down to `roundMin` minutes.
     */
    quickAdd: z.object({
      maxAccuracyM: z.number().positive(),
      roundMin: z.number().int().min(1).max(60),
    }),
    /** Weekly repeats on the add form: how far ahead, and how many dates at most. */
    recurring: z.object({
      maxWeeks: z.number().int().min(1).max(52),
      maxOccurrences: z.number().int().min(2).max(100),
    }),
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
  /** OpenStreetMap data beyond the map tiles: district boundaries, later venues. */
  osm: z.object({
    /** Overpass servers, tried in order: one alone can refuse or time out for hours. */
    overpassUrls: z.array(z.string().url()).min(1),
    /** overpass-api.de answers 406 to a User-Agent with a URL in it, so no crawler URL here. */
    userAgent: z.string().min(1),
  }),
  /** OSM venues, links to event venues and the website check. */
  venues: z.object({
    /** OSM tags that make a venue: key → values (e.g. amenity → theatre, cinema). */
    osmTags: z.record(z.array(z.string().min(1)).min(1)),
    link: z.object({
      /** An event venue links to the OSM venue with the most similar name within this distance. */
      radiusM: z.number().positive(),
      /** Name similarity (0–1, as for event titles) needed to link. */
      minSimilarity: z.number().min(0).max(1),
      /** Similarity needed to move the pin to OSM's point; closer than minMoveM it stays. */
      moveSimilarity: z.number().min(0).max(1),
      minMoveM: z.number().nonnegative(),
    }),
    probe: z.object({
      /** Websites checked per run, never checked first, then the oldest. */
      perRun: z.number().int().positive(),
      recheckDays: z.number().int().positive(),
      /** Words in a link (path or text) that make it the site's events page. */
      eventsPageWords: z.array(z.string().min(1)).min(1),
    }),
    /** Runs in a row an accepted site may fail before it is paused. */
    pauseAfterFailures: z.number().int().positive(),
  }),
  /** Per-event opens, routes and arrivals for "your impact". */
  counts: z.object({
    /** Counts accepted in one POST /api/counts. */
    maxBatch: z.number().int().positive(),
    perHourPerDevice: z.number().int().positive(),
  }),
  /** Shared event links. */
  sharing: z.object({
    /** Live events listed under an ended event's card, nearest first. */
    endedNearbyMax: z.number().int().min(0).max(20),
    /** Put before an ended event's link-preview description. */
    endedLabel: labelsSchema,
  }),
  /** "I'm going" and co-presence. */
  attendance: z.object({
    /** Public counts show only from this many people (no "be the first"). */
    publicMin: z.number().int().min(2),
    /** Counts are shown as the highest bucket reached, e.g. 5+, 10+, 25+. */
    buckets: z.array(z.number().int().positive()).min(1),
    /** A signal is kept this long after its event ends, then deleted. */
    keepAfterEndHours: z.number().int().min(0),
    perHourPerDevice: z.number().int().positive(),
    sharesPerHourPerDevice: z.number().int().positive(),
    /** "Looking": opened the card within this many minutes. */
    lookingMinutes: z.number().int().positive(),
    /** The card offers "I'm here" within this distance of a live event. */
    hereRadiusM: z.number().positive(),
  }),
  /** Plan ahead. */
  agenda: z.object({
    /** The views the bookmark in the top row switches between; "all" is the map as usual. */
    views: z
      .array(z.enum(['all', 'plans', 'saved', 'private']))
      .min(2)
      .refine((v) => v[0] === 'all' && new Set(v).size === v.length, {
        message: 'views start with "all" and list each view once',
      }),
    /** Ended events stay under "Past" this long, then leave the list. */
    keepPastDays: z.number().int().min(1),
    /** A removal is remembered this long, so an offline device doesn't bring it back. */
    keepRemovedDays: z.number().int().min(1),
    /** Saved events per device or account; the oldest go first. */
    maxSaved: z.number().int().min(10).max(1000),
    /** Saved events read by id in one request. */
    maxPerRead: z.number().int().min(1).max(500),
    /** Walks between events are rounded up to this many minutes. */
    walkRoundMin: z.number().int().min(1).max(15),
    /** The "leave at" stepper's step. */
    leaveStepMin: z.number().int().min(5).max(60),
    /** Sync calls per account per hour. */
    syncPerHour: z.number().int().positive(),
  }),
  /** Web push. */
  push: z.object({
    /** The Worker secret holding the VAPID private key (a P-256 JWK; `pnpm push:keys`). */
    secret: z.string().min(1),
    /** How long a push service keeps an undelivered message. */
    ttlSeconds: z.number().int().min(60).max(86_400),
    subscribePerHourPerDevice: z.number().int().positive(),
  }),
  /** Reminders before a start. */
  reminders: z.object({
    /** The choices on the bell: minutes before the start, or "dayBefore" (the evening before). */
    leads: z.array(z.union([z.string().regex(/^[0-9]{1,4}$/), z.literal('dayBefore')])).min(1),
    /** Chosen until the person picks another. */
    defaultLead: z.string(),
    /** "The day before" fires at this local time. */
    dayBeforeAt: z.string().regex(/^\d{2}:\d{2}$/),
    maxPerDevice: z.number().int().positive(),
    perHourPerDevice: z.number().int().positive(),
    /** The Cron Trigger's interval: a reminder goes at the last tick before its time. */
    cronMinutes: z.number().int().positive(),
    /** Reminders sent in one tick at most; the rest go on the next. */
    maxPerTick: z.number().int().positive(),
  }),
  /** Private events, contacts and invitations. */
  private: z.object({
    /** Private events and their invitations are deleted this many days after they end. */
    keepAfterEndDays: z.number().int().min(1),
    /** Contacts per account, and groups. */
    maxContacts: z.number().int().positive(),
    maxGroups: z.number().int().positive(),
    /** Invitations per event, people and links together. */
    maxInvitationsPerEvent: z.number().int().positive(),
    /** Contact, group and invitation changes per account per hour. */
    perHourPerAccount: z.number().int().positive(),
  }),
  /** Organisers: claims, posts and edits. */
  organiser: z.object({
    /** Posts per event per organiser per day. */
    postsPerEventPerDay: z.number().int().positive(),
    /** Site checks of a claim's code per account per hour. */
    checksPerHour: z.number().int().positive(),
    /** Edits per account per hour. */
    editsPerHour: z.number().int().positive(),
    /** A new event this close to a claimed venue publishes at once. */
    venueRadiusM: z.number().positive(),
    /** Posts are cached at the edge this long. */
    postsCacheSec: z.number().int().min(0),
  }),
  /** Search. */
  search: z.object({
    /** Trigram similarity a match needs (pg_trgm `%`), about 0.3. */
    minSimilarity: z.number().min(0).max(1),
    /** Word similarity for a query inside a longer name (pg_trgm `<%`), "podsiadlo" in "dawid podsiadlo". */
    minWordSimilarity: z.number().min(0).max(1),
    minChars: z.number().int().min(1),
    maxChars: z.number().int().min(2),
    maxResults: z.number().int().positive().max(100),
    perHourPerClient: z.number().int().positive(),
    /** Answers are cached this long at the edge and in the browser. */
    cacheSeconds: z.number().int().min(0),
    /** The app waits this long after the last keystroke before asking. */
    debounceMs: z.number().int().min(0),
  }),
  /** Followed artists. */
  follows: z.object({
    /** Names per device or account. */
    max: z.number().int().positive().max(500),
    /** Match requests per client and hour. */
    matchPerHourPerClient: z.number().int().positive(),
    /** The app asks again at most this often (on open, then hourly). */
    matchEveryMinutes: z.number().int().positive(),
    /** Nationwide Ticketmaster lookups. */
    nationwide: z.object({
      enabled: z.boolean(),
      /** The source in sources.json whose endpoint and secrets are used. */
      sourceId: z.string(),
      /** A cached lookup is used for this long. */
      maxAgeHours: z.number().positive(),
      /** New lookups per day across everyone, well inside the API key's 5,000. */
      perDay: z.number().int().min(0),
      /** New lookups one match request may make; the rest wait for the next. */
      perRequest: z.number().int().min(0),
      countryCode: z.string().length(2),
    }),
    /** New-date alerts: sent per cron tick at most, and how far back a new event counts. */
    alerts: z.object({
      maxPerTick: z.number().int().positive(),
      lookbackHours: z.number().int().positive(),
    }),
  }),
  notices: z.object({
    /** Devices one notice reaches at most. */
    maxAudience: z.number().int().positive(),
    /** Sent right away by the request that made the notice; the cron sends the rest. */
    inline: z.number().int().min(0),
    /** Sent per cron tick at most (Workers Free CPU, as reminders.maxPerTick). */
    maxPerTick: z.number().int().positive(),
  }),
  /** Metrics, in the default region's time zone. */
  metrics: z.object({
    /** "Tonight" runs from this hour to midnight. */
    eveningFromHour: z.number().int().min(0).max(23),
    /** The Worker's cron saves the week's row from this ISO weekday (1 = Monday) and hour on. */
    weekly: z.object({
      weekday: z.number().int().min(1).max(7),
      hour: z.number().int().min(0).max(23),
    }),
  }),
  /** The public site: its origin is the one place the domain is written. */
  site: z.object({
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://') && !u.endsWith('/'), 'https, no trailing slash'),
    name: z.string().min(1),
  }),
  legal: z.object({
    /** Takedown / DSA notice contact shown on the About page, the legal pages and the crawler's UA. */
    contactEmail: z.string().email().nullable(),
    /** Version of the terms and privacy notice an account accepts at sign-up. */
    termsVersion: z.string().min(1),
    /** The controller named in the terms and privacy policy; null until the owner sets it. */
    operator: z.string().min(1).nullable(),
    /** The operator's postal address, for the legal pages. */
    address: z.string().min(1).nullable(),
  }),
  /** The app's own email: sign-in codes with `auth.emailDelivery: "app"`, alerts. */
  email: z.object({
    provider: z.enum(['none', 'resend']),
    /** "Happow <hello@example.org>"; a sender verified with the provider. Null = no email. */
    from: z.string().min(3).nullable(),
    /** The Worker secret holding the provider's key. */
    secret: z.string().min(1),
    endpoint: z.string().url(),
  }),
  /** User accounts. */
  auth: z.object({
    /**
     * How sign-in codes reach people: "manual" = the app files a request and the admin sends the
     * code by hand from the admin panel; "supabase" = Supabase Auth emails it (custom SMTP);
     * "app" = the Worker makes the code and sends it with the app's email sender.
     */
    emailDelivery: z.enum(['manual', 'supabase', 'app']),
    /** Sign-in providers besides the email code, once set up in Supabase (docs/SETUP.md). */
    providers: z.array(z.enum(['google'])),
    codeRequestsPerHourPerClient: z.number().int().positive(),
    codeRequestsPerDayPerEmail: z.number().int().positive(),
    /** Unanswered or used code requests are deleted after this many days. */
    codeRequestRetentionDays: z.number().int().positive(),
    /** Must match Supabase Auth → Email OTP expiration (24 h at most); quoted in the email. */
    codeValidHours: z.number().int().positive().max(24),
    /** How long the API trusts a checked access token before asking Supabase again. */
    userCacheSec: z.number().int().min(0).max(300),
    /** The email the admin sends by hand, per language: {code}, {link} and {hours} are filled in. */
    codeEmail: z.object({ pl: emailTemplateSchema, en: emailTemplateSchema }),
  }),
  ingest: z.object({
    descriptionMaxChars: z.number().int().positive(),
    /** Fetch from this long ago, so events that started earlier and still run are kept. */
    lookbackHours: z.number().nonnegative(),
    lookaheadHours: z.number().positive(),
    /**
     * Identifies our crawler/API client to providers. `{siteUrl}` and `{contactEmail}` are filled
     * from `site.url` and `legal.contactEmail`; see `siteTemplate`.
     */
    userAgent: z.string().min(1),
    /** Crawler politeness. */
    politeness: z.object({
      /** Send If-None-Match / If-Modified-Since with the validators of the last read. */
      conditionalRequests: z.boolean(),
      /** Honour TDM reservations: a reserved page is never sent to the LLM. */
      respectTdm: z.boolean(),
      /** An event page read this recently is not fetched again… */
      revisitHours: z.number().min(0),
      /** …when every event it gave starts at least this many days ahead. */
      revisitFarDays: z.number().min(0),
    }),
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
      /**
       * A run that starts also takes sources due within this many hours (at most half their
       * interval early), so they share runs and save Actions minutes.
       */
      batchAheadHours: z.number().min(0).default(0),
    }),
  }),
});

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'use a colour like "#6A4CF5"');

/** Colours of one theme: the basemap, the chrome and notices. */
export const themeTokensSchema = z.object({
  land: hex,
  majorRoad: hex,
  minorRoad: hex,
  water: hex,
  park: hex,
  /** Covers unexplored areas (lit map). */
  veil: hex,
  veilOpacity: z.number().min(0).max(1),
  /** Text and glyphs. */
  ink: hex,
  muted: hex,
  /** Cards, sheets, pins. */
  paper: hex,
  /** Subtle fills on paper (segmented controls, chips). */
  paper2: hex,
  /** The track behind toggles. */
  sunken: hex,
  /** A toggle that is on, and what sits on it. */
  raised: hex,
  onRaised: hex,
  /** What is off in the settings sheet: toggles, language codes, clear. */
  quiet: hex,
  line: hex,
  /** Behind dialogs, at partial opacity. */
  scrim: hex,
  warn: hex,
  warnInk: hex,
  error: hex,
  errorInk: hex,
});

const liveSchema = z.object({ live: hex, onLive: hex });

/** A live-hue preset: the one colour that means "on now", and the glyph on it. */
export const themePresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  labels: labelsSchema,
  /** Who may pick it: everyone, signed-in users, premium. */
  tier: z.enum(['anonymous', 'account', 'premium']),
  day: liveSchema,
  night: liveSchema,
});

export const themeConfigSchema = z.object({
  themes: z.object({ day: themeTokensSchema, night: themeTokensSchema }),
  presets: z.array(themePresetSchema).min(1),
  defaultPreset: z.string(),
  /** Every preset must meet these in both themes (checked by the contrast test). */
  rules: z.object({
    minGlyphContrast: z.number().min(1),
    minLandContrast: z.number().min(1),
    minHueDistance: z.number().min(0).max(180),
    minInkContrast: z.number().min(1),
    minMutedContrast: z.number().min(1),
    /** The veil must dim unlit areas without hiding them. */
    veilOpacity: z.object({ min: z.number().min(0).max(1), max: z.number().min(0).max(1) }),
  }),
});

export const mapConfigSchema = z.object({
  styleUrl: z.string().url(),
  fallbackRaster: z.object({
    tiles: z.array(z.string()).min(1),
    tileSize: z.number().int().positive(),
    maxZoom: z.number(),
  }),
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
  /**
   * What must happen before a public launch while this source is on (consent, a switch-off);
   * `pnpm launch:check` lists it.
   */
  beforeLaunch: z.string().optional(),
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

/** Plans from lowest to highest; a higher plan never gets less. */
export const planIdSchema = z.enum(['anonymous', 'account', 'premium']);

const quotaSchema = z.number().int().min(0);

/** What a plan allows. Code asks for these, never for a plan. */
export const entitlementsSchema = z
  .object({
    'events.perMonth': quotaSchema,
    'autofill.perMonth': quotaSchema,
    'presets.account': z.boolean(),
    'presets.premium': z.boolean(),
    'atlas.export': z.boolean(),
    'atlas.sync': z.boolean(),
    'alerts.newDates': z.boolean(),
    /** Followed artists synced across the account's devices. */
    'follows.sync': z.boolean(),
    'saved.sync': z.boolean(),
    'private.create': z.boolean(),
    /** Private events a month. */
    'private.perMonth': quotaSchema,
    /** Info posts on your events; schedule changes and important posts are always free. */
    'organiser.infoPosts': z.boolean(),
    /** Edit your events and publish at a claimed venue at once. */
    'organiser.publish': z.boolean(),
  })
  .strict();

export const plansConfigSchema = z
  .object({
    plans: z.object({
      anonymous: entitlementsSchema,
      account: entitlementsSchema,
      premium: entitlementsSchema,
    }),
    /**
     * A promotion for every account, the same for all: `plan` through the whole `until`
     * day in the default region's time zone. Null = no promotion.
     */
    earlyAccess: z
      .object({
        plan: planIdSchema.exclude(['anonymous']),
        until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .nullable(),
    /** Rewards for adding events: only after moderation or trusted publishing. */
    contributions: z
      .object({
        /** Premium days per verified event, and at most this many earned per calendar month. */
        premiumDaysPerEvent: z.number().int().nonnegative(),
        premiumDaysPerMonth: z.number().int().nonnegative(),
        /** Verified events with no rejection after which new events skip the queue. */
        trustedAfter: z.number().int().positive(),
        /** Calendar feeds an account may import from. */
        feedsPerAccount: z.number().int().min(0).default(2),
        /**
         * "First added by you": no other live event within `radiusM` that ended in the
         * last `quietDays` or is still ahead.
         */
        firstPlace: z
          .object({ radiusM: z.number().positive(), quietDays: z.number().int().positive() })
          .default({ radiusM: 75, quietDays: 90 }),
        /** Ascending: a level needs both its verified events and opens of the account's events. */
        levels: z
          .array(
            z.object({
              id: z.string().min(1),
              events: z.number().int().nonnegative(),
              opens: z.number().int().nonnegative(),
            }),
          )
          .min(1),
      })
      .strict(),
  })
  .strict();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Season collections: while a season runs, events that fit it open as a themed list.
 * An event fits when it overlaps the dates (inclusive, in the region's time zone) and, where given,
 * has one of the categories and a keyword in its title (lower case, without diacritics).
 */
export const seasonSchema = z
  .object({
    id: z.string().min(1),
    labels: z.object({ pl: z.string().min(1), en: z.string().min(1) }),
    from: isoDay,
    to: isoDay,
    categories: z.array(z.string()).default([]),
    keywords: z.array(z.string().min(2)).default([]),
  })
  .refine((s) => s.categories.length > 0 || s.keywords.length > 0, {
    message: 'a season needs categories or keywords',
  })
  .refine((s) => s.from <= s.to, { message: 'a season ends on or after its start' });

export const seasonsConfigSchema = z.object({ seasons: z.array(seasonSchema) });
