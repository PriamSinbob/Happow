import type pg from 'pg';
import type { LatLng } from '@happow/core';
import type { SiteTarget } from '../types.js';
import type { EventVenue, OsmVenue, VenueLink } from './osm.js';
import type { ProbeResult } from './probe.js';

/** A venue website due for the check; venues sharing a site are checked once. */
export interface SiteToCheck {
  osmId: string;
  name: string;
  website: string;
  point: LatLng;
}

const point = (lat: number, lng: number): LatLng => ({ lat, lng });

/** Postgres for OSM venues, links, the website check and accepted sites (M12 §2.2). */
export class VenueStore {
  constructor(private readonly db: pg.ClientBase) {}

  async upsertOsmVenues(regionId: string, venues: OsmVenue[]): Promise<void> {
    await this.db.query('begin');
    try {
      for (const v of venues)
        await this.db.query(
          `insert into osm_venues (osm_id, region_id, name, kind, point, address, website,
             opening_hours, wheelchair, service_times, seen_at)
           values ($1, $2, $3, $4, st_point($5, $6)::geography, $7, $8, $9, $10, $11, now())
           on conflict (osm_id) do update set region_id = excluded.region_id, name = excluded.name,
             kind = excluded.kind, point = excluded.point, address = excluded.address,
             website = excluded.website, opening_hours = excluded.opening_hours,
             wheelchair = excluded.wheelchair, service_times = excluded.service_times,
             seen_at = now(),
             -- A new website is checked again on the next run.
             website_checked_at = case when osm_venues.website is distinct from excluded.website
               then null else osm_venues.website_checked_at end`,
          [
            v.osmId,
            regionId,
            v.name,
            v.kind,
            v.point.lng,
            v.point.lat,
            v.address,
            v.website,
            v.openingHours,
            v.wheelchair,
            v.serviceTimes,
          ],
        );
      await this.db.query('commit');
    } catch (err) {
      await this.db.query('rollback');
      throw err;
    }
  }

  async osmVenues(regionId: string): Promise<OsmVenue[]> {
    const { rows } = await this.db.query(
      `select osm_id, name, kind, st_y(point::geometry) lat, st_x(point::geometry) lng, address,
         website, opening_hours, wheelchair, service_times
       from osm_venues where region_id = $1`,
      [regionId],
    );
    return rows.map((r) => ({
      osmId: r.osm_id,
      name: r.name,
      kind: r.kind,
      point: point(r.lat, r.lng),
      address: r.address,
      website: r.website,
      openingHours: r.opening_hours,
      wheelchair: r.wheelchair,
      serviceTimes: r.service_times,
    }));
  }

  /** Venues events use, inside the region. */
  async eventVenues(regionId: string): Promise<EventVenue[]> {
    const { rows } = await this.db.query(
      `select v.id, v.name, st_y(v.point::geometry) lat, st_x(v.point::geometry) lng, v.osm_id,
         st_y(v.osm_point::geometry) olat, st_x(v.osm_point::geometry) olng
       from venues v join regions r on r.id = $1 and st_covers(r.polygon, v.point)`,
      [regionId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      point: point(r.lat, r.lng),
      osmId: r.osm_id,
      osmPoint: r.olat === null ? null : point(r.olat, r.olng),
    }));
  }

  /** Writes links; a pin move is logged once per new OSM point. Returns how many pins moved. */
  async applyLinks(links: VenueLink[]): Promise<number> {
    let moved = 0;
    await this.db.query('begin');
    try {
      for (const l of links) {
        await this.db.query('update venues set osm_id = $2 where id = $1', [l.venueId, l.osmId]);
        if (!l.moveTo) continue;
        const { rowCount } = await this.db.query(
          `with moved as (
             update venues set osm_point = st_point($3, $4)::geography
             where id = $1 and (osm_point is null
               or not st_dwithin(osm_point, st_point($3, $4)::geography, 1))
             returning id, point)
           insert into venue_moves (venue_id, osm_id, from_point, to_point, distance_m)
           select id, $2, point, st_point($3, $4)::geography, $5 from moved`,
          [l.venueId, l.osmId, l.moveTo.lng, l.moveTo.lat, l.distanceM],
        );
        moved += rowCount ?? 0;
      }
      await this.db.query('commit');
    } catch (err) {
      await this.db.query('rollback');
      throw err;
    }
    return moved;
  }

  /** OSM points that venues' pins moved to, by venue id; ingest puts events there. */
  async osmPins(regionId: string): Promise<Map<string, LatLng>> {
    const { rows } = await this.db.query(
      `select v.id, st_y(v.osm_point::geometry) lat, st_x(v.osm_point::geometry) lng
       from venues v join osm_venues o on o.osm_id = v.osm_id
       where o.region_id = $1 and v.osm_point is not null`,
      [regionId],
    );
    return new Map(rows.map((r) => [r.id as string, point(r.lat, r.lng)]));
  }

  async sitesToCheck(regionId: string, limit: number, recheckDays: number): Promise<SiteToCheck[]> {
    const { rows } = await this.db.query(
      `select * from (
         select distinct on (website) osm_id, name, website, website_checked_at,
           st_y(point::geometry) lat, st_x(point::geometry) lng
         from osm_venues
         where region_id = $1 and website is not null
           and (website_checked_at is null or website_checked_at < now() - make_interval(days => $3))
         order by website, website_checked_at nulls first) s
       order by website_checked_at nulls first, osm_id
       limit $2`,
      [regionId, limit, recheckDays],
    );
    return rows.map((r) => ({
      osmId: r.osm_id,
      name: r.name,
      website: r.website,
      point: point(r.lat, r.lng),
    }));
  }

  /** Records a check for every venue on that website, and its finds as candidates. */
  async saveProbe(regionId: string, site: SiteToCheck, result: ProbeResult): Promise<number> {
    const summary = {
      status: result.status,
      ...(result.error && { error: result.error }),
      candidates: result.candidates.map((c) => ({ url: c.url, kind: c.kind, count: c.count })),
    };
    await this.db.query(
      `update osm_venues set website_checked_at = now(), website_check = $3
       where region_id = $1 and website = $2`,
      [regionId, site.website, summary],
    );
    for (const c of result.candidates)
      await this.db.query(
        `insert into source_candidates (region_id, osm_id, venue_name, point, url, kind,
           event_count, sample)
         values ($1, $2, $3, st_point($4, $5)::geography, $6, $7, $8, $9)
         on conflict (url) do update set event_count = excluded.event_count,
           sample = excluded.sample`,
        [
          regionId,
          site.osmId,
          site.name,
          site.point.lng,
          site.point.lat,
          c.url,
          c.kind,
          c.count,
          JSON.stringify(c.sample),
        ],
      );
    return result.candidates.length;
  }

  async siteTargets(regionId: string): Promise<SiteTarget[]> {
    const { rows } = await this.db.query(
      `select id, url, kind, venue_name, st_y(point::geometry) lat, st_x(point::geometry) lng
       from source_candidates where region_id = $1 and status = 'accepted' order by id`,
      [regionId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      url: r.url,
      kind: r.kind,
      venueName: r.venue_name,
      point: point(r.lat, r.lng),
    }));
  }

  /** After a run: a failure counts towards pausing the site, a success resets the count. */
  async recordSiteResults(
    results: { id: number; error: string | null }[],
    pauseAfter: number,
  ): Promise<number> {
    let paused = 0;
    for (const r of results) {
      const { rows } = await this.db.query<{ status: string }>(
        `update source_candidates set last_run_at = now(),
           failures = case when $2::text is null then 0 else failures + 1 end,
           last_error = $2,
           status = case when $2::text is not null and failures + 1 >= $3 then 'paused' else status end
         where id = $1 returning status`,
        [r.id, r.error, pauseAfter],
      );
      if (rows[0]?.status === 'paused') paused++;
    }
    return paused;
  }
}
