-- Places to go to while they are open (restaurants, pubs, galleries: `places.kinds` in
-- config/app.json), as OpenStreetMap lists them. Written weekly by the `osm-places` ingest job
-- with the service role; phones read an area's places through /api/places and work out "open
-- now" themselves from the opening hours, so nothing here changes between imports.
-- Kept apart from osm_venues, whose websites the venue check walks through.

create table places (
  -- 'node/123', 'way/45' or 'relation/6'.
  osm_id text primary key,
  region_id text not null references regions (id) on delete cascade,
  name text not null,
  -- The matching tag, e.g. 'amenity=pub'.
  kind text not null,
  point extensions.geography(point, 4326) not null,
  address text,
  website text,
  -- OSM's opening_hours, as written there.
  opening_hours text,
  seen_at timestamptz not null default now()
);
create index places_point_idx on places using gist (point);
create index places_region_idx on places (region_id);
alter table places enable row level security;

-- Places with opening hours within radius_m of a point, nearest first. Without hours a place can
-- never show as open, so it is left out.
create function places_area(
  lat double precision,
  lng double precision,
  radius_m double precision,
  max_places integer default 3000
)
returns table (
  id text, name text, kind text, lat double precision, lng double precision, address text,
  website text, opening_hours text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with here as (
    select extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography as g
  )
  select
    p.osm_id, p.name, p.kind,
    extensions.st_y(p.point::extensions.geometry), extensions.st_x(p.point::extensions.geometry),
    p.address, p.website, p.opening_hours
  from places p
  cross join here
  where extensions.st_dwithin(p.point, here.g, least(radius_m, 60000))
    and p.opening_hours is not null
  order by extensions.st_distance(p.point, here.g)
  limit least(greatest(max_places, 1), 10000);
$$;
revoke all on function places_area(double precision, double precision, double precision, integer)
  from public;
grant execute on function places_area(double precision, double precision, double precision, integer)
  to service_role;
