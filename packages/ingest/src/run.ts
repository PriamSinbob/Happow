import {
  intervalMs,
  rateLimitIntervalMs,
  scoreConfidence,
  type Category,
  type HappowConfig,
  type Region,
  type Source,
} from '@happow/core';
import {
  MemoryCache,
  PRECISION_CONFIDENCE,
  type ExtractedEvent,
  type Extractor,
  type Geocoder,
  type KeyValueCache,
} from '@happow/extract';
import { adapters } from './adapters/index.js';
import { sourceRanker } from './dedup.js';
import { HttpClient, redact } from './http.js';
import { normalize, type RejectReason } from './normalize.js';
import type { EventStore } from './store.js';
import type { NormalizedEvent, RawEvent, SourceAdapter } from './types.js';

export interface IngestOptions {
  config: HappowConfig;
  env: Record<string, string | undefined>;
  now?: Date;
  /** Null for a dry run: fetch and normalize, write nothing. */
  store: EventStore | null;
  sourceIds?: string[];
  regionIds?: string[];
  /** Ignore schedules and run every selected source now. */
  force?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onResponse?: (sourceId: string, url: string, body: string) => void;
  log?: (msg: string) => void;
  /** Address lookup for sources without coordinates; null = such events are rejected. */
  geocoder?: Geocoder | null;
  /** LLM extraction for crawled pages without structured data; null = off. */
  extractor?: Extractor | null;
  extractionCache?: KeyValueCache<ExtractedEvent[]>;
}

export interface SourceRunSummary {
  sourceId: string;
  regionId: string;
  status: 'ok' | 'failed' | 'skipped';
  reason?: string;
  fetched?: number;
  dropped?: number;
  missing?: number;
  rejected?: Partial<Record<RejectReason, number>>;
  geocoded?: number;
  inserted?: number;
  updated?: number;
  merged?: number;
  queued?: number;
  events?: NormalizedEvent[];
}

/** Grace so a cron tick that fires a few minutes early still counts as due. */
const SCHEDULE_SLACK_MS = 5 * 60_000;

export function isDue(source: Source, lastSuccess: Date | null, now: Date): boolean {
  if (!source.schedule) return false;
  if (!lastSuccess) return true;
  return now.getTime() - lastSuccess.getTime() >= intervalMs(source.schedule) - SCHEDULE_SLACK_MS;
}

export function missingSecrets(source: Source, env: IngestOptions['env']): string[] {
  return source.secrets.filter((s) => !env[s]);
}

/** Every (region, source) pair the config enables, in sources.json order. */
export function plannedRuns(config: HappowConfig): { region: Region; source: Source }[] {
  return config.regions.flatMap((region) =>
    config.sources
      .filter(
        (s) => s.enabled && s.regionIds.includes(region.id) && region.enabledSources.includes(s.id),
      )
      .map((source) => ({ region, source })),
  );
}

/** Fetch → store raw → parse → normalize → dedup + write, for every due source. */
export async function runIngest(opts: IngestOptions): Promise<SourceRunSummary[]> {
  const { config, env, store } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const rank = sourceRanker(config.sources);
  const summaries: SourceRunSummary[] = [];
  // New sources and regions in config must exist before their events are written.
  if (store) await store.syncConfig(config);

  for (const { region, source } of plannedRuns(config)) {
    if (opts.regionIds?.length && !opts.regionIds.includes(region.id)) continue;
    if (opts.sourceIds?.length && !opts.sourceIds.includes(source.id)) continue;
    const base = { sourceId: source.id, regionId: region.id };
    const skip = (reason: string) => {
      log(`- ${source.id}@${region.id}: skipped (${reason})`);
      summaries.push({ ...base, status: 'skipped', reason });
    };

    const adapter = adapters[source.adapter];
    if (!adapter) {
      // e.g. the manual seed, loaded by `pnpm db:seed`.
      if (opts.sourceIds?.includes(source.id)) skip(`no ingest adapter "${source.adapter}"`);
      continue;
    }
    const missing = missingSecrets(source, env);
    if (missing.length) {
      skip(`missing ${missing.join(', ')}`);
      continue;
    }
    if (!opts.force && store) {
      if (!isDue(source, await store.lastSuccess(source.id, region.id), now)) {
        skip('not due');
        continue;
      }
    }

    const runId = store ? await store.startRun(source.id, region.id) : null;
    try {
      const result = await runSource(adapter, source, region, config, now, opts);
      const applied = store
        ? await store.apply(result.events, result.raws, {
            regionId: region.id,
            rank,
            dedup: config.app.dedup,
            minConfidence: config.app.extraction.minConfidence,
            missing: source.completeListing
              ? missedWindow(result.window, result.events, config.app.ingest.missedRunsToFlag)
              : null,
          })
        : { inserted: 0, updated: 0, merged: 0, queued: 0, missing: 0 };
      const stats = {
        fetched: result.raws.length,
        dropped: result.dropped,
        geocoded: result.geocoded,
        rejected: result.rejected,
        ...applied,
      };
      if (runId !== null) await store!.finishRun(runId, 'ok', stats);
      log(
        `✓ ${source.id}@${region.id}: fetched ${stats.fetched}, inserted ${stats.inserted}, ` +
          `updated ${stats.updated}, merged ${stats.merged}, queued ${stats.queued}, ` +
          `missing ${stats.missing}, ` +
          `geocoded ${stats.geocoded}, dropped ${stats.dropped}, rejected ${JSON.stringify(stats.rejected)}`,
      );
      summaries.push({ ...base, status: 'ok', ...stats, events: result.events });
    } catch (err) {
      const message = redact((err as Error).message);
      if (runId !== null) await store!.finishRun(runId, 'failed', {}, message);
      log(`✗ ${source.id}@${region.id}: ${message}`);
      summaries.push({ ...base, status: 'failed', reason: message });
    }
  }
  return summaries;
}

/**
 * Where a missing listing means something: the fetch window, but only up to the latest start
 * this run returned, since paged APIs sorted by date may cut off the tail of a busy window.
 */
export function missedWindow(
  window: { from: Date; to: Date },
  events: NormalizedEvent[],
  afterRuns: number,
): { from: Date; to: Date; afterRuns: number } | null {
  if (!events.length) return null;
  const latest = Math.max(...events.map((e) => Date.parse(e.event.startAt)));
  return { from: window.from, to: new Date(Math.min(window.to.getTime(), latest)), afterRuns };
}

async function runSource(
  adapter: SourceAdapter,
  source: Source,
  region: Region,
  config: HappowConfig,
  now: Date,
  opts: IngestOptions,
): Promise<{
  raws: RawEvent[];
  window: { from: Date; to: Date };
  events: NormalizedEvent[];
  dropped: number;
  geocoded: number;
  rejected: Partial<Record<RejectReason, number>>;
}> {
  const { ingest, h3, extraction } = config.app;
  const http = new HttpClient({
    userAgent: ingest.userAgent,
    minIntervalMs: source.rateLimit ? rateLimitIntervalMs(source.rateLimit) : 0,
    fetch: opts.fetch,
    sleep: opts.sleep,
    onResponse: opts.onResponse && ((url, body) => opts.onResponse!(source.id, url, body)),
  });
  const window = {
    from: new Date(now.getTime() - ingest.lookbackHours * 3_600_000),
    to: new Date(now.getTime() + ingest.lookaheadHours * 3_600_000),
  };
  const raws = await adapter.fetch({
    source,
    region,
    window,
    http,
    env: opts.env,
    now,
    services: {
      extractor: opts.extractor ?? null,
      extractionCache: opts.extractionCache ?? new MemoryCache(),
      categories: config.categories,
      userAgent: ingest.userAgent,
      maxInputChars: extraction.maxInputChars,
      maxPageBytes: extraction.maxPageBytes,
    },
  });

  const categories: Category[] = config.categories;
  const events: NormalizedEvent[] = [];
  const rejected: Partial<Record<RejectReason, number>> = {};
  let dropped = 0;
  let geocoded = 0;
  const seen = new Set<string>();
  for (const raw of raws) {
    if (seen.has(raw.externalId)) continue; // overlapping pages
    seen.add(raw.externalId);
    let parsed = adapter.parse(raw, { source, region });
    if (!parsed) {
      dropped++;
      continue;
    }
    // Pipeline step 4: places without coordinates are geocoded; a coarse match lowers confidence.
    if (!parsed.point && !parsed.venue?.point && parsed.locationQuery && opts.geocoder) {
      const hit = await opts.geocoder.geocode(
        { ...parsed.locationQuery, countryCode: region.countryCode },
        region.bbox,
      );
      if (hit) {
        geocoded++;
        parsed = {
          ...parsed,
          point: hit.point,
          venue: parsed.venue && { ...parsed.venue, point: hit.point },
          confidence: (parsed.confidence ?? 1) * PRECISION_CONFIDENCE[hit.precision],
        };
      }
    }
    parsed = {
      ...parsed,
      confidence: scoreConfidence(
        {
          extracted: parsed.confidence ?? 1,
          trust: source.trustLevel,
          hasEnd: parsed.endAt !== null,
          // Crawled items without a venue name use the address as the name.
          hasVenue: !!parsed.venue && parsed.venue.name !== parsed.venue.address,
        },
        config.app.confidence,
      ),
    };
    const res = normalize(parsed, {
      source,
      region,
      categories,
      h3Resolution: h3.eventResolution,
      densityResolution: h3.densityResolution,
      descriptionMaxChars: ingest.descriptionMaxChars,
      now,
      sharedCategoryMap: extraction.schemaTypeMap,
    });
    if (res.ok) events.push(res.value);
    else rejected[res.reason] = (rejected[res.reason] ?? 0) + 1;
  }
  return { raws, window, events, dropped, geocoded, rejected };
}
