import { createHash } from 'node:crypto';
import type pg from 'pg';
import { mergePerformers, type HappowConfig, type HappowEvent } from '@happow/core';
import type { ExtractedEvent, GeoResult, KeyValueCache } from '@happow/extract';
import { decide, type DedupConfig, type Listing, type StoredEvent } from './dedup.js';
import { h3Neighbourhood } from './geo.js';
import type { NormalizedEvent, PageCache, PageEntry, RawEvent } from './types.js';
import { VenueStore } from './venues/store.js';
import { FeedStore } from './feeds.js';

export interface ApplyStats {
  inserted: number;
  updated: number;
  merged: number;
  /** Low-confidence new events sent to the moderation queue instead of the map. */
  queued: number;
  /** Events newly marked "possibly cancelled" because this source stopped listing them. */
  missing: number;
}

export interface ApplyOptions {
  regionId: string;
  rank: (sourceId: string | null) => number;
  dedup: DedupConfig & { h3Ring: number };
  minConfidence: number;
  /**
   * For sources that return everything they have in the fetch window: listings of events
   * starting in [from, to] that this run did not return count as missed, and an event whose
   * primary listing was missed `afterRuns` runs in a row is marked "possibly cancelled".
   */
  missing?: { from: Date; to: Date; afterRuns: number } | null;
}

const EVENT_COLUMNS = `
  e.id, e.title, e.description, e.category_ids, e.start_at, e.end_at, e.end_estimated, e.timezone,
  e.venue_id, v.name as venue_name, v.address as venue_address,
  st_y(e.point::geometry) as lat, st_x(e.point::geometry) as lng, e.h3_r9, e.price_min,
  e.price_max, e.currency, e.is_free, e.rules, e.official_url, e.ticket_url, e.image_url,
  e.status, e.trust, e.confidence, e.last_seen_at, e.primary_source_id, e.primary_external_id,
  e.entry, e.grace_min, e.age_min, e.family,
  (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'externalId', p.external_id)
     order by p.ord), '[]'::jsonb) from event_performers p where p.event_id = e.id) as performers`;

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  category_ids: string[];
  start_at: Date;
  end_at: Date;
  end_estimated: boolean;
  timezone: string;
  venue_id: string | null;
  venue_name: string | null;
  venue_address: string | null;
  lat: number;
  lng: number;
  h3_r9: string;
  price_min: string | null;
  price_max: string | null;
  currency: string | null;
  is_free: boolean;
  rules: HappowEvent['rules'];
  official_url: string | null;
  ticket_url: string | null;
  image_url: string | null;
  status: HappowEvent['status'];
  trust: HappowEvent['trust'];
  confidence: number;
  last_seen_at: Date;
  primary_source_id: string | null;
  primary_external_id: string | null;
  entry: HappowEvent['entry'];
  grace_min: number | null;
  age_min: number | null;
  family: boolean | null;
  performers: { name: string; externalId: string | null }[] | null;
}

function toStored(r: EventRow): StoredEvent {
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    primarySourceId: r.primary_source_id,
    primaryExternalId: r.primary_external_id,
    event: {
      id: r.id,
      title: r.title,
      description: r.description,
      categoryIds: r.category_ids,
      startAt: r.start_at.toISOString(),
      endAt: r.end_at.toISOString(),
      endEstimated: r.end_estimated,
      timezone: r.timezone,
      venue: r.venue_id
        ? { id: r.venue_id, name: r.venue_name ?? '', address: r.venue_address }
        : null,
      point: { lat: r.lat, lng: r.lng },
      h3r9: r.h3_r9,
      priceMin: num(r.price_min),
      priceMax: num(r.price_max),
      currency: r.currency?.trim() ?? null,
      isFree: r.is_free,
      rules: r.rules ?? {},
      entry: r.entry,
      graceMin: r.grace_min,
      ageMin: r.age_min,
      family: r.family,
      officialUrl: r.official_url,
      ticketUrl: r.ticket_url,
      imageUrl: r.image_url,
      status: r.status,
      trust: r.trust,
      confidence: r.confidence,
      lastSeenAt: r.last_seen_at.toISOString(),
      performers: (r.performers ?? []).map((p) =>
        p.externalId ? { name: p.name, externalId: p.externalId } : { name: p.name },
      ),
    },
  };
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Postgres side of ingestion. Expects `search_path` to include the PostGIS schema. */
export class EventStore {
  constructor(private readonly db: pg.ClientBase) {}

  /** Account calendar feeds, on the same connection. */
  feeds(): FeedStore {
    return new FeedStore(this.db);
  }

  /** OSM venues, links and the website check, on the same connection. */
  venues(): VenueStore {
    return new VenueStore(this.db);
  }

  /** Start of the latest successful run, or null. */
  async lastSuccess(sourceId: string, regionId: string): Promise<Date | null> {
    const { rows } = await this.db.query<{ started_at: Date }>(
      `select started_at from source_runs where source_id = $1 and region_id = $2 and status = 'ok'
       order by started_at desc limit 1`,
      [sourceId, regionId],
    );
    return rows[0]?.started_at ?? null;
  }

  async startRun(sourceId: string, regionId: string): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into source_runs (source_id, region_id, status) values ($1, $2, 'running') returning id`,
      [sourceId, regionId],
    );
    return Number(rows[0]!.id);
  }

  /** A source the run could not attempt (for example missing secrets), for the scheduler. */
  async recordSkip(sourceId: string, regionId: string, reason: string): Promise<void> {
    await this.db.query(
      `insert into source_runs (source_id, region_id, status, finished_at, error)
       values ($1, $2, 'skipped', now(), $3)`,
      [sourceId, regionId, reason],
    );
  }

  async finishRun(id: number, status: 'ok' | 'failed', stats: object, error?: string) {
    await this.db.query(
      `update source_runs set finished_at = now(), status = $2, stats = $3, error = $4 where id = $1`,
      [id, status, stats, error ?? null],
    );
  }

  /**
   * Store raw payloads, then insert, update or merge every event, all in one transaction.
   * Work goes in chunks of `APPLY_CHUNK` items: each chunk reads what it needs in two queries
   * (linked listings, merge candidates) and writes in a handful of set-based statements, so a
   * run costs a few round trips per chunk instead of several per event. The ingest runner is far
   * from the database (a GitHub runner in the US, Supabase in Frankfurt), where one round trip
   * is about 0.1 s: per-event statements made 3,000 church services take 40 minutes.
   */
  async apply(items: NormalizedEvent[], raws: RawEvent[], opts: ApplyOptions): Promise<ApplyStats> {
    const stats: ApplyStats = { inserted: 0, updated: 0, merged: 0, queued: 0, missing: 0 };
    await this.db.query('begin');
    try {
      for (let i = 0; i < raws.length; i += APPLY_CHUNK)
        await this.saveRaws(raws.slice(i, i + APPLY_CHUNK));
      // Events this run has written so far, by id: later items see them as merge candidates
      // and as their linked event, exactly as if each had been written on its own.
      const written = new Map<string, StoredEvent>();
      for (let i = 0; i < items.length; i += APPLY_CHUNK)
        await this.applyChunk(items.slice(i, i + APPLY_CHUNK), opts, stats, written);
      // An empty run is more likely an outage or an API change than every event being called off.
      if (opts.missing && raws.length) {
        stats.missing = await this.markMissing(raws, opts.regionId, opts.missing);
      }
      await this.db.query('commit');
    } catch (err) {
      await this.db.query('rollback');
      throw err;
    }
    return stats;
  }

  private async applyChunk(
    items: NormalizedEvent[],
    opts: ApplyOptions,
    stats: ApplyStats,
    written: Map<string, StoredEvent>,
  ) {
    const linkedRows = await this.linkedMany(items);
    const candidates = await this.nearbyMany(items, opts.dedup);
    const pending = new Map<string, PendingWrite>();
    const venues = new Map<string, NonNullable<NormalizedEvent['venue']>>();
    const sources = new Map<string, SourceLink>();
    const fresh = (s: StoredEvent): StoredEvent => written.get(s.event.id) ?? s;

    for (const item of items) {
      const listing = { sourceId: item.sourceId, externalId: item.externalId };
      const found = linkedRows.get(`${item.sourceId}\u0000${item.externalId}`);
      const linked = found ? fresh(found) : null;
      const ring = new Set(h3Neighbourhood(item.event.h3r9, opts.dedup.h3Ring));
      const at = Date.parse(item.event.startAt);
      const tol = opts.dedup.startToleranceMin * 60_000;
      const near = new Map<string, StoredEvent>();
      for (const c of [...candidates, ...written.values()]) {
        const s = fresh(c);
        if (ring.has(s.event.h3r9) && Math.abs(Date.parse(s.event.startAt) - at) <= tol)
          near.set(s.event.id, s);
      }
      const d = decide(item.event, listing, linked, [...near.values()], opts.rank, opts.dedup);
      // Unsure extractions wait for a moderator, unless a moderator already approved the
      // listing or another source already lists the same event (corroboration).
      if (!linked && d.action === 'insert' && item.event.confidence < opts.minConfidence) {
        await this.queueForReview(item, opts.regionId);
        stats.queued++;
        continue;
      }
      if (item.venue) venues.set(item.venue.id, item.venue);
      const owns =
        d.action === 'insert' ||
        (d.owner.sourceId === listing.sourceId && d.owner.externalId === listing.externalId);
      const before = pending.get(d.event.id);
      pending.set(d.event.id, {
        event: d.event,
        owner: d.owner,
        // Only the owning listing may set it; otherwise an earlier write of this run stands.
        staleAfter: owns ? item.staleAfter : before?.staleAfter,
        insert: before ? before.insert : d.action === 'insert',
      });
      if (d.action === 'insert') stats.inserted++;
      else if (d.merged) stats.merged++;
      else stats.updated++;
      written.set(d.event.id, {
        primarySourceId: d.owner.sourceId,
        primaryExternalId: d.owner.externalId,
        event: d.event,
      });
      sources.set(`${item.sourceId}\u0000${item.externalId}`, {
        eventId: d.event.id,
        sourceId: item.sourceId,
        externalId: item.externalId,
        sourceUrl: item.sourceUrl,
      });
    }
    await this.saveVenues([...venues.values()]);
    await this.writeEvents([...pending.values()], opts.regionId);
    await this.saveSourceLinks([...sources.values()]);
  }

  /** Counts missed listings and sets or clears `source_missing_at`; returns events newly marked. */
  private async markMissing(
    raws: RawEvent[],
    regionId: string,
    { from, to, afterRuns }: NonNullable<ApplyOptions['missing']>,
  ): Promise<number> {
    const sourceId = raws[0]!.sourceId;
    // Every listing the source still returns counts as seen, even ones normalization rejected.
    const seen = raws.map((r) => r.externalId);
    await this.db.query(
      `update event_sources set missed_runs = 0
       where source_id = $1 and external_id = any($2::text[]) and missed_runs > 0`,
      [sourceId, seen],
    );
    const marked = await this.db.query<{ id: string }>(
      `with missed as (
         update event_sources es set missed_runs = es.missed_runs + 1
         from events e
         where es.event_id = e.id and es.source_id = $1 and e.region_id = $2
           and not (es.external_id = any($3::text[]))
           and e.start_at >= $4 and e.start_at <= $5 and e.status = 'scheduled'
         returning es.event_id, es.external_id, es.missed_runs
       )
       update events e set source_missing_at = now()
       from missed m
       where e.id = m.event_id and e.primary_source_id = $1 and e.primary_external_id = m.external_id
         and m.missed_runs >= $6 and e.source_missing_at is null
       returning e.id`,
      [sourceId, regionId, seen, from, to, afterRuns],
    );
    const found = await this.db.query<{ id: string }>(
      `update events set source_missing_at = null
       where primary_source_id = $1 and primary_external_id = any($2::text[])
         and source_missing_at is not null
       returning id`,
      [sourceId, seen],
    );
    const flagged = [...marked.rows, ...found.rows].map((r) => r.id);
    if (flagged.length)
      await this.db.query('select refresh_event_flag(id) from unnest($1::text[]) as t(id)', [
        flagged,
      ]);
    return marked.rows.length;
  }

  /** Pending crawl submission; refreshed while pending, never revived once reviewed. */
  private async queueForReview(item: NormalizedEvent, regionId: string) {
    await this.db.query(
      `insert into submissions (kind, url, extracted_payload, status, submitter_hash, region_id,
         source_id, external_id, confidence)
       values ('crawl', $1, $2, 'pending', $3, $4, $3, $5, $6)
       on conflict (source_id, external_id) where external_id is not null do update
         set extracted_payload = excluded.extracted_payload, confidence = excluded.confidence,
           url = excluded.url
         where submissions.status = 'pending'`,
      [
        item.sourceUrl,
        JSON.stringify(item),
        item.sourceId,
        regionId,
        item.externalId,
        item.event.confidence,
      ],
    );
  }

  /** Upsert regions, categories and sources from config (also used by the seed script). */
  async syncConfig(config: HappowConfig) {
    for (const r of config.regions) {
      const { west: w, south: s, east: e, north: n } = r.bbox;
      await this.db.query(
        `insert into regions (id, name, timezone, center, polygon, enabled_sources, updated_at)
         values ($1, $2, $3, st_point($4, $5)::geography,
                 st_geomfromtext($6, 4326)::geography, $7, now())
         on conflict (id) do update set name = excluded.name, timezone = excluded.timezone,
           center = excluded.center, polygon = excluded.polygon,
           enabled_sources = excluded.enabled_sources, updated_at = now()`,
        [
          r.id,
          r.name,
          r.timezone,
          r.center.lng,
          r.center.lat,
          `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`,
          r.enabledSources,
        ],
      );
    }
    for (const [i, c] of config.categories.entries()) {
      await this.db.query(
        `insert into categories (id, labels, default_duration_min, icon, color, sort_order)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update set labels = excluded.labels,
           default_duration_min = excluded.default_duration_min, icon = excluded.icon,
           color = excluded.color, sort_order = excluded.sort_order`,
        [c.id, c.labels, c.defaultDurationMin, c.icon, c.color, i],
      );
    }
    for (const s of config.sources) {
      await this.db.query(
        `insert into sources (id, adapter, region_ids, schedule, rate_limit, trust_level, enabled, terms_notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set adapter = excluded.adapter, region_ids = excluded.region_ids,
           schedule = excluded.schedule, rate_limit = excluded.rate_limit,
           trust_level = excluded.trust_level, enabled = excluded.enabled, terms_notes = excluded.terms_notes`,
        [
          s.id,
          s.adapter,
          s.regionIds,
          s.schedule,
          s.rateLimit,
          s.trustLevel,
          s.enabled,
          s.termsNotes,
        ],
      );
    }
  }

  /** Crawled pages as last read; pages unread for 30 days are dropped. */
  pageCache(sourceId: string): PageCache {
    let pruned = false;
    return {
      get: async (url) => {
        if (!pruned) {
          pruned = true;
          await this.db.query(
            `delete from page_cache where source_id = $1 and fetched_at < now() - interval '30 days'`,
            [sourceId],
          );
        }
        const { rows } = await this.db.query<{
          etag: string | null;
          last_modified: string | null;
          content_hash: string;
          events: PageEntry['events'];
          links: string[];
          fetched_at: Date;
        }>(
          `select etag, last_modified, content_hash, events, links, fetched_at from page_cache
           where source_id = $1 and url = $2`,
          [sourceId, url],
        );
        const r = rows[0];
        return r
          ? {
              etag: r.etag,
              lastModified: r.last_modified,
              hash: r.content_hash,
              events: r.events,
              links: r.links,
              fetchedAt: r.fetched_at.toISOString(),
            }
          : undefined;
      },
      set: async (url, e) => {
        await this.db.query(
          `insert into page_cache (source_id, url, etag, last_modified, content_hash, events, links, fetched_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (source_id, url) do update set etag = excluded.etag,
             last_modified = excluded.last_modified, content_hash = excluded.content_hash,
             events = excluded.events, links = excluded.links, fetched_at = excluded.fetched_at`,
          [
            sourceId,
            url,
            e.etag,
            e.lastModified,
            e.hash,
            JSON.stringify(e.events),
            JSON.stringify(e.links),
            e.fetchedAt,
          ],
        );
      },
    };
  }

  /** LLM results by content hash (see the crawler); kept until the page text changes. */
  extractionCache(extractorId: string): KeyValueCache<ExtractedEvent[]> {
    return {
      get: async (key) => {
        const { rows } = await this.db.query<{ result: ExtractedEvent[] }>(
          'select result from extraction_cache where content_hash = $1',
          [key],
        );
        return rows[0]?.result;
      },
      set: async (key, value) => {
        await this.db.query(
          `insert into extraction_cache (content_hash, extractor, result) values ($1, $2, $3)
           on conflict (content_hash) do update set result = excluded.result, created_at = now()`,
          [key, extractorId, JSON.stringify(value)],
        );
      },
    };
  }

  /** Geocoder answers (including "not found"), valid for `maxAgeDays`. */
  geocodeCache(provider: string, maxAgeDays: number): KeyValueCache<GeoResult | null> {
    return {
      get: async (key) => {
        const { rows } = await this.db.query<{ result: GeoResult | null }>(
          `select result from geocode_cache
           where query_key = $1 and fetched_at > now() - make_interval(days => $2)`,
          [key, maxAgeDays],
        );
        return rows.length ? rows[0]!.result : undefined;
      },
      set: async (key, value) => {
        await this.db.query(
          `insert into geocode_cache (query_key, provider, result) values ($1, $2, $3)
           on conflict (query_key) do update set result = excluded.result, provider = excluded.provider,
             fetched_at = now()`,
          [key, provider, value === null ? null : JSON.stringify(value)],
        );
      },
    };
  }

  private async saveRaws(raws: RawEvent[]) {
    if (!raws.length) return;
    // The same listing twice in one statement would make the upsert fail; the last one wins.
    const byKey = new Map(raws.map((r) => [`${r.sourceId}\u0000${r.externalId}`, r]));
    const rows = [...byKey.values()];
    await this.db.query(
      `insert into raw_payloads (source_id, external_id, content_hash, payload, fetched_at)
       select source_id, external_id, content_hash, payload::jsonb, fetched_at::timestamptz
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
         as t (source_id, external_id, content_hash, payload, fetched_at)
       on conflict (source_id, external_id) do update set fetched_at = excluded.fetched_at,
         content_hash = excluded.content_hash, payload = excluded.payload`,
      [
        rows.map((r) => r.sourceId),
        rows.map((r) => r.externalId),
        rows.map((r) => payloadHash(r.payload)),
        rows.map((r) => JSON.stringify(r.payload)),
        rows.map((r) => r.fetchedAt),
      ],
    );
  }

  /** The stored event each listing of the chunk is linked to, by "source\0external". */
  private async linkedMany(items: NormalizedEvent[]): Promise<Map<string, StoredEvent>> {
    const { rows } = await this.db.query<EventRow & { l_source: string; l_external: string }>(
      `select ${EVENT_COLUMNS}, es.source_id as l_source, es.external_id as l_external
       from unnest($1::text[], $2::text[]) as l (source_id, external_id)
       join event_sources es on es.source_id = l.source_id and es.external_id = l.external_id
       join events e on e.id = es.event_id left join venues v on v.id = e.venue_id`,
      [items.map((i) => i.sourceId), items.map((i) => i.externalId)],
    );
    return new Map(rows.map((r) => [`${r.l_source}\u0000${r.l_external}`, toStored(r)]));
  }

  /**
   * Merge candidates for the whole chunk: public events in any item's neighbourhood within the
   * chunk's time span. Each item then keeps those near itself. Private events never take part.
   */
  private async nearbyMany(
    items: NormalizedEvent[],
    cfg: ApplyOptions['dedup'],
  ): Promise<StoredEvent[]> {
    if (!items.length) return [];
    const cells = new Set<string>();
    let from = Infinity;
    let to = -Infinity;
    for (const { event } of items) {
      for (const c of h3Neighbourhood(event.h3r9, cfg.h3Ring)) cells.add(c);
      const at = Date.parse(event.startAt);
      from = Math.min(from, at);
      to = Math.max(to, at);
    }
    const tol = cfg.startToleranceMin * 60_000;
    const { rows } = await this.db.query<EventRow>(
      `select ${EVENT_COLUMNS} from events e left join venues v on v.id = e.venue_id
       where e.visibility = 'public' and e.h3_r9 = any($1) and e.start_at between $2 and $3`,
      [[...cells], new Date(from - tol).toISOString(), new Date(to + tol).toISOString()],
    );
    return rows.map(toStored);
  }

  private async saveVenues(venues: NonNullable<NormalizedEvent['venue']>[]) {
    if (!venues.length) return;
    await this.db.query(
      `insert into venues (id, name, address, point, h3_r9, website)
       select id, name, address, st_point(lng, lat)::geography, h3_r9, website
       from unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::text[],
         $7::text[]) as t (id, name, address, lng, lat, h3_r9, website)
       on conflict (id) do update set name = excluded.name, address = excluded.address,
         point = excluded.point, h3_r9 = excluded.h3_r9, website = coalesce(excluded.website, venues.website)`,
      [
        venues.map((v) => v.id),
        venues.map((v) => v.name),
        venues.map((v) => v.address),
        venues.map((v) => v.point.lng),
        venues.map((v) => v.point.lat),
        venues.map((v) => v.h3r9),
        venues.map((v) => v.website),
      ],
    );
  }

  /**
   * Inserts and updates in two statements. `staleAfter` undefined keeps the stored value (only
   * the owning listing may extend it). Performers are replaced by the merged list.
   */
  private async writeEvents(writes: PendingWrite[], regionId: string) {
    if (!writes.length) return;
    const row = ({ event: e, owner, staleAfter }: PendingWrite) => ({
      id: e.id,
      region_id: regionId,
      title: e.title,
      description: e.description,
      category_ids: e.categoryIds,
      start_at: e.startAt,
      end_at: e.endAt,
      end_estimated: e.endEstimated,
      timezone: e.timezone,
      venue_id: e.venue?.id ?? null,
      lng: e.point.lng,
      lat: e.point.lat,
      h3_r9: e.h3r9,
      price_min: e.priceMin,
      price_max: e.priceMax,
      currency: e.currency,
      is_free: e.isFree,
      rules: e.rules,
      official_url: e.officialUrl,
      ticket_url: e.ticketUrl,
      image_url: e.imageUrl,
      status: e.status,
      trust: e.trust,
      confidence: e.confidence,
      last_seen_at: e.lastSeenAt,
      primary_source_id: owner.sourceId,
      primary_external_id: owner.externalId,
      density_cell: e.densityCell ?? null,
      entry: e.entry,
      grace_min: e.graceMin,
      age_min: e.ageMin,
      family: e.family,
      set_stale: staleAfter !== undefined,
      stale_after: staleAfter ?? null,
    });
    const recordset = `jsonb_to_recordset($1::jsonb) as t (id text, region_id text, title text,
      description text, category_ids text[], start_at timestamptz, end_at timestamptz,
      end_estimated boolean, timezone text, venue_id text, lng float8, lat float8, h3_r9 text,
      price_min numeric, price_max numeric, currency text, is_free boolean, rules jsonb,
      official_url text, ticket_url text, image_url text, status event_status, trust trust_level,
      confidence real, last_seen_at timestamptz, primary_source_id text,
      primary_external_id text, density_cell text, entry text, grace_min integer,
      age_min integer, family boolean, set_stale boolean, stale_after timestamptz)`;
    const inserts = writes.filter((w) => w.insert).map(row);
    const updates = writes.filter((w) => !w.insert).map(row);
    if (inserts.length)
      await this.db.query(
        `insert into events (id, region_id, title, description, category_ids, start_at, end_at,
           end_estimated, timezone, venue_id, point, h3_r9, price_min, price_max, currency, is_free,
           rules, official_url, ticket_url, image_url, status, trust, confidence, last_seen_at,
           primary_source_id, primary_external_id, density_cell, entry, grace_min, age_min, family,
           stale_after)
         select id, region_id, title, description, category_ids, start_at, end_at, end_estimated,
           timezone, venue_id, st_point(lng, lat)::geography, h3_r9, price_min, price_max,
           currency, is_free, coalesce(rules, '{}'::jsonb), official_url, ticket_url, image_url,
           status, trust, confidence, last_seen_at, primary_source_id, primary_external_id,
           density_cell, entry, grace_min, age_min, family, stale_after
         from ${recordset}`,
        [JSON.stringify(inserts)],
      );
    if (updates.length)
      await this.db.query(
        `update events e set region_id = t.region_id, title = t.title,
           description = t.description, category_ids = t.category_ids, start_at = t.start_at,
           end_at = t.end_at, end_estimated = t.end_estimated, timezone = t.timezone,
           venue_id = t.venue_id, point = st_point(t.lng, t.lat)::geography, h3_r9 = t.h3_r9,
           price_min = t.price_min, price_max = t.price_max, currency = t.currency,
           is_free = t.is_free, rules = coalesce(t.rules, '{}'::jsonb),
           official_url = t.official_url, ticket_url = t.ticket_url, image_url = t.image_url,
           status = t.status, trust = t.trust, confidence = t.confidence,
           last_seen_at = t.last_seen_at, primary_source_id = t.primary_source_id,
           primary_external_id = t.primary_external_id,
           density_cell = coalesce(t.density_cell, e.density_cell), entry = t.entry,
           grace_min = t.grace_min, age_min = t.age_min, family = t.family,
           stale_after = case when t.set_stale then t.stale_after else e.stale_after end
         from ${recordset}
         where e.id = t.id`,
        [JSON.stringify(updates)],
      );
    await this.writePerformers(writes);
  }

  /** Each event's performers as merged: the stored list is replaced by the union. */
  private async writePerformers(writes: PendingWrite[]) {
    const ids: string[] = [];
    const rows = { id: [] as string[], ord: [] as number[], name: [] as string[] };
    const src = { source: [] as string[], ext: [] as string[] };
    for (const { event, owner } of writes) {
      ids.push(event.id);
      mergePerformers(event.performers).forEach((p, i) => {
        rows.id.push(event.id);
        rows.ord.push(i);
        rows.name.push(p.name);
        src.source.push(owner.sourceId);
        src.ext.push(p.externalId ?? '');
      });
    }
    await this.db.query('delete from event_performers where event_id = any($1::text[])', [ids]);
    if (!rows.id.length) return;
    await this.db.query(
      `insert into event_performers (event_id, ord, name, norm, source_id, external_id)
       select event_id, ord::smallint, name, f_norm(name), source_id, nullif(ext, '')
       from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[])
         as t (event_id, ord, name, source_id, ext)
       on conflict (event_id, norm) do nothing`,
      [rows.id, rows.ord, rows.name, src.source, src.ext],
    );
  }

  private async saveSourceLinks(links: SourceLink[]) {
    if (!links.length) return;
    await this.db.query(
      `insert into event_sources (event_id, source_id, external_id, source_url, raw_payload_ref, fetched_at)
       select event_id, source_id, external_id, source_url, source_id || '/' || external_id, now()
       from unnest($1::text[], $2::text[], $3::text[], $4::text[])
         as t (event_id, source_id, external_id, source_url)
       on conflict (source_id, external_id) do update set event_id = excluded.event_id,
         source_url = excluded.source_url, raw_payload_ref = excluded.raw_payload_ref, fetched_at = now(),
         missed_runs = 0`,
      [
        links.map((l) => l.eventId),
        links.map((l) => l.sourceId),
        links.map((l) => l.externalId),
        links.map((l) => l.sourceUrl),
      ],
    );
  }
}

/** Items per round of reads and writes in `apply`. */
const APPLY_CHUNK = 500;

/** One event's final state in a chunk; `insert` when its first write in this run creates it. */
interface PendingWrite {
  event: HappowEvent;
  owner: Listing;
  staleAfter: string | null | undefined;
  insert: boolean;
}

interface SourceLink {
  eventId: string;
  sourceId: string;
  externalId: string;
  sourceUrl: string | null;
}
