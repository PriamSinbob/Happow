/**
 * Syncs config (regions, categories, sources) into the database and loads each region's seed events.
 * Seed times are offsets from now, so re-running refreshes the demo. Idempotent.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@happow/core';
import { h3Cell, materializeSeed, seedVenues } from '@happow/core/seed';
import { withClient } from './db.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = loadConfig();
const now = new Date();

await withClient(async (db) => {
  await db.query('begin');
  try {
    for (const r of config.regions) {
      const { west: w, south: s, east: e, north: n } = r.bbox;
      await db.query(
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
      await db.query(
        `insert into categories (id, labels, default_duration_min, icon, color, sort_order)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update set labels = excluded.labels,
           default_duration_min = excluded.default_duration_min, icon = excluded.icon,
           color = excluded.color, sort_order = excluded.sort_order`,
        [c.id, c.labels, c.defaultDurationMin, c.icon, c.color, i],
      );
    }
    for (const s of config.sources) {
      await db.query(
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

    // Replace previous seed events so offsets re-anchor to now.
    await db.query(
      `delete from events where id in (select event_id from event_sources where source_id = 'seed')`,
    );
    for (const region of config.regions) {
      if (!region.seedFile || !region.enabledSources.includes('seed')) continue;
      const raw = JSON.parse(await readFile(root + region.seedFile, 'utf8'));
      const res = config.app.h3.eventResolution;
      for (const v of seedVenues(raw)) {
        await db.query(
          `insert into venues (id, name, address, point, h3_r9, website)
           values ($1, $2, $3, st_point($4, $5)::geography, $6, $7)
           on conflict (id) do update set name = excluded.name, address = excluded.address,
             point = excluded.point, h3_r9 = excluded.h3_r9, website = excluded.website`,
          [v.id, v.name, v.address, v.lng, v.lat, h3Cell(v, res), v.website],
        );
      }
      const events = materializeSeed(
        raw,
        region,
        config.categories,
        now,
        res,
        config.app.h3.densityResolution,
      );
      for (const e of events) {
        await db.query(
          `insert into events (id, region_id, title, description, category_ids, start_at, end_at,
             end_estimated, timezone, venue_id, point, h3_r9, price_min, price_max, currency, is_free,
             rules, official_url, ticket_url, image_url, status, trust, confidence, last_seen_at,
             primary_source_id, primary_external_id, density_cell)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, st_point($11, $12)::geography, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, 'seed', $1, $26)`,
          [
            e.id,
            region.id,
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
            e.densityCell ?? null,
          ],
        );
        await db.query(
          `insert into event_sources (event_id, source_id, external_id, fetched_at)
           values ($1, 'seed', $2, now())
           on conflict (source_id, external_id) do update set event_id = excluded.event_id, fetched_at = now()`,
          [e.id, e.id],
        );
      }
      console.log(`seeded ${events.length} events for ${region.id}`);
    }
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
});
