import { rateLimitIntervalMs, type HappowConfig, type Region, type Source } from '@happow/core';
import { HttpClient } from '../http.js';
import { overpass } from '../overpass.js';
import { robotsGate } from '../robots.js';
import type { EventStore } from '../store.js';
import { linkVenues, parseOsmVenues, venueQuery } from './osm.js';
import { probeSite } from './probe.js';

/**
 * Scheduled jobs that keep venues and the website check up to date (M12 §2.2). They are sources
 * in config/sources.json like any other, so the Worker's cron and `source_runs` schedule them,
 * but they write venues and candidates, not events.
 */

export interface JobContext {
  source: Source;
  region: Region;
  config: HappowConfig;
  now: Date;
  /** Null for a dry run: fetch and report, write nothing. */
  store: EventStore | null;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log: (msg: string) => void;
}

export type JobStats = Record<string, number | string>;
export type VenueJob = (ctx: JobContext) => Promise<JobStats>;

/** OSM venues in the region's bbox, then links from the venues events use. */
export const osmVenuesJob: VenueJob = async (ctx) => {
  const { osm, venues: cfg } = ctx.config.app;
  const elements = await overpass(venueQuery(cfg.osmTags, ctx.region.bbox), {
    urls: osm.overpassUrls,
    userAgent: osm.userAgent,
    fetch: ctx.fetch,
  });
  const osmVenues = parseOsmVenues(elements, cfg.osmTags);
  const stats: JobStats = {
    osmVenues: osmVenues.length,
    withWebsite: osmVenues.filter((v) => v.website).length,
  };
  if (!ctx.store) return stats;
  const db = ctx.store.venues();
  await db.upsertOsmVenues(ctx.region.id, osmVenues);
  const links = linkVenues(await db.eventVenues(ctx.region.id), osmVenues, cfg.link);
  stats.linked = links.length;
  stats.moved = await db.applyLinks(links);
  return stats;
};

/** Up to `probe.perRun` venue websites, never checked first, then the oldest checks. */
export const venueProbeJob: VenueJob = async (ctx) => {
  if (!ctx.store) return { skipped: 'dry run: the check reads its list from the database' };
  const { ingest, venues: cfg } = ctx.config.app;
  const db = ctx.store.venues();
  const http = new HttpClient({
    userAgent: ingest.userAgent,
    minIntervalMs: ctx.source.rateLimit ? rateLimitIntervalMs(ctx.source.rateLimit) : 0,
    retries: 1,
    fetch: ctx.fetch,
    sleep: ctx.sleep,
  });
  const allowed = robotsGate(http, ingest.userAgent);
  const horizonDays =
    typeof ctx.source.options.horizonDays === 'number' ? ctx.source.options.horizonDays : 60;
  const sites = await db.sitesToCheck(ctx.region.id, cfg.probe.perRun, cfg.probe.recheckDays);
  const stats = { checked: 0, found: 0, none: 0, blocked: 0, errors: 0, candidates: 0 };
  for (const site of sites) {
    const result = await probeSite(site.website, {
      http,
      allowed,
      timeZone: ctx.region.timezone,
      now: ctx.now,
      horizonDays,
      eventsPageWords: cfg.probe.eventsPageWords,
    });
    stats.checked++;
    if (result.status === 'error') stats.errors++;
    else stats[result.status]++;
    stats.candidates += await db.saveProbe(ctx.region.id, site, result);
    if (result.candidates.length)
      ctx.log(`  ${site.name}: ${result.candidates.map((c) => `${c.kind} ${c.count}`).join(', ')}`);
  }
  return stats;
};

/** Jobs by the `adapter` name used in config/sources.json. */
export const venueJobs: Record<string, VenueJob> = {
  'osm-venues': osmVenuesJob,
  'venue-probe': venueProbeJob,
};
