-- Happow milestone 3: density (H3 hotspots, off-screen hints, empty-radius guidance).
-- Weather is out of the PoC (brief, 2026-10-20), so its cache table goes.
drop table if exists weather_cache;

-- H3 cell at config h3.densityResolution (coarser than h3_r9), computed in code like h3_r9.
-- Rows written before this migration get it on their next ingest or seed run; until then the
-- density query falls back to h3_r9.
alter table events add column density_cell text;
create index events_density_idx on events (density_cell, start_at);

-- Append the column to the public view (create or replace may only add columns at the end), and
-- make source_url deterministic when one source has several merged listings of an event.
create or replace view events_public with (security_invoker = true) as
select
  e.id, e.title, e.description, e.category_ids, e.start_at, e.end_at, e.end_estimated, e.timezone,
  e.venue_id, v.name as venue_name, v.address as venue_address, v.website as venue_website,
  extensions.st_y(e.point::extensions.geometry) as lat,
  extensions.st_x(e.point::extensions.geometry) as lng,
  e.point, e.h3_r9, e.price_min, e.price_max, e.currency::text as currency, e.is_free, e.rules,
  e.official_url, e.ticket_url, e.image_url, e.status, e.trust, e.confidence, e.last_seen_at,
  e.primary_source_id,
  (select es.source_url from event_sources es
     where es.event_id = e.id
     -- The owning listing first (exact source + external id), so merged listings of one source
     -- always resolve to the same link.
     order by (es.source_id = e.primary_source_id and es.external_id = e.primary_external_id)
       desc nulls last,
       (es.source_id = e.primary_source_id) desc nulls last, es.fetched_at desc, es.external_id
     limit 1) as source_url,
  coalesce(e.density_cell, e.h3_r9) as density_cell
from events e
left join venues v on v.id = e.venue_id
where e.stale_after is null or e.stale_after > now();

-- Matching events (same window, category and price rules as events_near) within search_m of
-- (lat, lng), counted per density cell. radius_m is the user's own circle: outside_count and the
-- nearest_* columns describe only events beyond it, for chevrons and empty-radius guidance.
create function density_near(
  lat double precision,
  lng double precision,
  radius_m double precision,
  search_m double precision,
  from_ts timestamptz,
  to_ts timestamptz,
  categories text[] default null,
  price text default 'any'
)
returns table (
  cell text,
  center_lat double precision,
  center_lng double precision,
  event_count integer,
  outside_count integer,
  nearest_lat double precision,
  nearest_lng double precision,
  nearest_m double precision,
  top_venue text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with here as (
    select extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography as g
  ),
  ev as (
    select e.density_cell, e.lat, e.lng, e.venue_name,
      extensions.st_distance(e.point, here.g) as d
    from events_public e
    cross join here
    where extensions.st_dwithin(e.point, here.g, least(search_m, 50000))
      and e.start_at <= to_ts
      and e.end_at >= from_ts
      and e.status <> 'cancelled'
      and (categories is null or cardinality(categories) = 0 or e.category_ids && categories)
      and (price = 'any' or (price = 'free' and e.is_free) or (price = 'paid' and not e.is_free))
  )
  select
    ev.density_cell,
    avg(ev.lat),
    avg(ev.lng),
    count(*)::integer,
    (count(*) filter (where ev.d > radius_m))::integer,
    (array_agg(ev.lat order by ev.d) filter (where ev.d > radius_m))[1],
    (array_agg(ev.lng order by ev.d) filter (where ev.d > radius_m))[1],
    min(ev.d) filter (where ev.d > radius_m),
    mode() within group (order by ev.venue_name)
  from ev
  group by ev.density_cell
  order by count(*) desc, ev.density_cell
  limit 300;
$$;

grant execute on function density_near(double precision, double precision, double precision, double precision, timestamptz, timestamptz, text[], text)
  to anon, authenticated;
