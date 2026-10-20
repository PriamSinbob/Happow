import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { HappowConfig, HappowEvent } from '@happow/core';
import type { ExtractedEvent, GeoResult, KeyValueCache } from '@happow/extract';
import { decide, type DedupConfig, type Listing, type StoredEvent } from './dedup.js';
import { h3Neighbourhood } from './geo.js';
import type { NormalizedEvent, RawEvent } from './types.js';

export interface ApplyStats {
  inserted: number;
  updated: number;
  merged: number;
  /** Low-confidence new events sent to the moderation queue instead of the map. */
  queued: number;
}

export interface ApplyOptions {
  regionId: string;
  rank: (sourceId: string | null) => number;
  dedup: DedupConfig & { h3Ring: number };
  minConfidence: number;
}

const EVENT_COLUMNS = `
  e.id, e.title, e.description, e.category_ids, e.start_at, e.end_at, e.end_estimated, e.timezone,
  e.venue_id, v.name as venue_name, v.address as venue_address,
  st_y(e.point::geometry) as lat, st_x(e.point::geometry) as lng, e.h3_r9, e.price_min,
  e.price_max, e.currency, e.is_free, e.rules, e.official_url, e.ticket_url, e.image_url,
  e.status, e.trust, e.confidence, e.last_seen_at, e.primary_source_id, e.primary_external_id`;

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
      officialUrl: r.official_url,
      ticketUrl: r.ticket_url,
      imageUrl: r.image_url,
      status: r.status,
      trust: r.trust,
      confidence: r.confidence,
      lastSeenAt: r.last_seen_at.toISOString(),
    },
  };
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Postgres side of ingestion. Expects `search_path` to include the PostGIS schema. */
export class EventStore {
  constructor(private readonly db: pg.ClientBase) {}

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

  async finishRun(id: number, status: 'ok' | 'failed', stats: object, error?: string) {
    await this.db.query(
      `update source_runs set finished_at = now(), status = $2, stats = $3, error = $4 where id = $1`,
      [id, status, stats, error ?? null],
    );
  }

  /** Store raw payloads, then insert, update or merge every event, all in one transaction. */
  async apply(items: NormalizedEvent[], raws: RawEvent[], opts: ApplyOptions): Promise<ApplyStats> {
    const stats: ApplyStats = { inserted: 0, updated: 0, merged: 0, queued: 0 };
    await this.db.query('begin');
    try {
      for (const raw of raws) await this.saveRaw(raw);
      for (const item of items) {
        const listing = { sourceId: item.sourceId, externalId: item.externalId };
        const linked = await this.linked(item);
        // Unsure extractions wait for a moderator, unless a moderator already approved the listing.
        if (!linked && item.event.confidence < opts.minConfidence) {
          await this.queueForReview(item, opts.regionId);
          stats.queued++;
          continue;
        }
        const d = decide(
          item.event,
          listing,
          linked,
          await this.nearby(item.event, opts.dedup),
          opts.rank,
          opts.dedup,
        );
        if (item.venue) await this.saveVenue(item);
        if (d.action === 'insert') {
          await this.writeEvent(d.event, opts.regionId, d.owner, item.staleAfter, true);
          stats.inserted++;
        } else {
          const owns =
            d.owner.sourceId === listing.sourceId && d.owner.externalId === listing.externalId;
          await this.writeEvent(
            d.event,
            opts.regionId,
            d.owner,
            owns ? item.staleAfter : undefined,
            false,
          );
          if (d.merged) stats.merged++;
          else stats.updated++;
        }
        await this.db.query(
          `insert into event_sources (event_id, source_id, external_id, source_url, raw_payload_ref, fetched_at)
           values ($1, $2, $3, $4, $5, now())
           on conflict (source_id, external_id) do update set event_id = excluded.event_id,
             source_url = excluded.source_url, raw_payload_ref = excluded.raw_payload_ref, fetched_at = now()`,
          [
            d.event.id,
            item.sourceId,
            item.externalId,
            item.sourceUrl,
            `${item.sourceId}/${item.externalId}`,
          ],
        );
      }
      await this.db.query('commit');
    } catch (err) {
      await this.db.query('rollback');
      throw err;
    }
    return stats;
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

  private async saveRaw(raw: RawEvent) {
    await this.db.query(
      `insert into raw_payloads (source_id, external_id, content_hash, payload, fetched_at)
       values ($1, $2, $3, $4, $5)
       on conflict (source_id, external_id) do update set fetched_at = excluded.fetched_at,
         content_hash = excluded.content_hash, payload = excluded.payload`,
      [
        raw.sourceId,
        raw.externalId,
        payloadHash(raw.payload),
        JSON.stringify(raw.payload),
        raw.fetchedAt,
      ],
    );
  }

  private async linked(item: NormalizedEvent): Promise<StoredEvent | null> {
    const { rows } = await this.db.query<EventRow>(
      `select ${EVENT_COLUMNS} from event_sources es
       join events e on e.id = es.event_id left join venues v on v.id = e.venue_id
       where es.source_id = $1 and es.external_id = $2`,
      [item.sourceId, item.externalId],
    );
    return rows[0] ? toStored(rows[0]) : null;
  }

  private async nearby(ev: HappowEvent, cfg: ApplyOptions['dedup']): Promise<StoredEvent[]> {
    const { rows } = await this.db.query<EventRow>(
      `select ${EVENT_COLUMNS} from events e left join venues v on v.id = e.venue_id
       where e.h3_r9 = any($1) and e.start_at between $2::timestamptz - make_interval(mins => $3)
         and $2::timestamptz + make_interval(mins => $3)`,
      [h3Neighbourhood(ev.h3r9, cfg.h3Ring), ev.startAt, cfg.startToleranceMin],
    );
    return rows.map(toStored);
  }

  private async saveVenue(item: NormalizedEvent) {
    const v = item.venue!;
    await this.db.query(
      `insert into venues (id, name, address, point, h3_r9, website)
       values ($1, $2, $3, st_point($4, $5)::geography, $6, $7)
       on conflict (id) do update set name = excluded.name, address = excluded.address,
         point = excluded.point, h3_r9 = excluded.h3_r9, website = coalesce(excluded.website, venues.website)`,
      [v.id, v.name, v.address, v.point.lng, v.point.lat, v.h3r9, v.website],
    );
  }

  /** `staleAfter` undefined keeps the stored value (only the owning listing may extend it). */
  private async writeEvent(
    e: HappowEvent,
    regionId: string,
    owner: Listing,
    staleAfter: string | null | undefined,
    insert: boolean,
  ) {
    const values = [
      e.id,
      regionId,
      e.title,
      e.description,
      e.categoryIds,
      e.startAt,
      e.endAt,
      e.endEstimated,
      e.timezone,
      e.venue?.id ?? null,
      e.point.lng,
      e.point.lat,
      e.h3r9,
      e.priceMin,
      e.priceMax,
      e.currency,
      e.isFree,
      e.rules,
      e.officialUrl,
      e.ticketUrl,
      e.imageUrl,
      e.status,
      e.trust,
      e.confidence,
      e.lastSeenAt,
      owner.sourceId,
      owner.externalId,
      e.densityCell ?? null,
    ];
    if (insert) {
      await this.db.query(
        `insert into events (id, region_id, title, description, category_ids, start_at, end_at,
           end_estimated, timezone, venue_id, point, h3_r9, price_min, price_max, currency, is_free,
           rules, official_url, ticket_url, image_url, status, trust, confidence, last_seen_at,
           primary_source_id, primary_external_id, density_cell, stale_after)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, st_point($11, $12)::geography, $13, $14,
           $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)`,
        [...values, staleAfter ?? null],
      );
      return;
    }
    await this.db.query(
      `update events set region_id = $2, title = $3, description = $4, category_ids = $5,
         start_at = $6, end_at = $7, end_estimated = $8, timezone = $9, venue_id = $10,
         point = st_point($11, $12)::geography, h3_r9 = $13, price_min = $14, price_max = $15,
         currency = $16, is_free = $17, rules = $18, official_url = $19, ticket_url = $20,
         image_url = $21, status = $22, trust = $23, confidence = $24, last_seen_at = $25,
         primary_source_id = $26, primary_external_id = $27,
         density_cell = coalesce($28, density_cell),
         stale_after = case when $29::boolean then $30::timestamptz else stale_after end
       where id = $1`,
      [...values, staleAfter !== undefined, staleAfter ?? null],
    );
  }
}
