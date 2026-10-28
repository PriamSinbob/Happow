-- M12 slice C1: OpenStreetMap venues, links to the venues events use, the website check's
-- candidates and the accepted sites the `venue-sites` source reads
-- (docs/milestones/M12-more-events.md §2.2). Written by the ingest jobs with the service role;
-- the admin tab (slice C2) reads and decides candidates through the API.

-- Venues as OSM lists them, whether or not an event uses them yet.
create table osm_venues (
  -- 'node/123', 'way/45' or 'relation/6'.
  osm_id text primary key,
  region_id text not null references regions (id) on delete cascade,
  name text not null,
  -- The matching tag, e.g. 'amenity=theatre'.
  kind text not null,
  point extensions.geography(point, 4326) not null,
  address text,
  website text,
  opening_hours text,
  wheelchair text,
  -- Regular services (slice J reads it).
  service_times text,
  seen_at timestamptz not null default now(),
  website_checked_at timestamptz,
  -- The last check: { status: 'found' | 'none' | 'blocked' | 'error', error?, candidates }.
  website_check jsonb
);
create index osm_venues_point_idx on osm_venues using gist (point);
create index osm_venues_region_idx on osm_venues (region_id);
alter table osm_venues enable row level security;

-- A venue events use, linked to its OSM venue. With a good name match its pin moves to OSM's
-- point (osm_point): ingest then keeps that point instead of the source's, and events at the
-- venue take it. Clearing osm_point undoes the move.
alter table venues add column osm_id text references osm_venues (osm_id) on delete set null;
alter table venues add column osm_point extensions.geography(point, 4326);
create index venues_osm_idx on venues (osm_id) where osm_id is not null;

-- Every pin move, so a wrong one can be found and undone.
create table venue_moves (
  id bigint generated always as identity primary key,
  venue_id text not null references venues (id) on delete cascade,
  osm_id text not null,
  from_point extensions.geography(point, 4326) not null,
  to_point extensions.geography(point, 4326) not null,
  distance_m real not null,
  moved_at timestamptz not null default now()
);
alter table venue_moves enable row level security;

-- Event pages and feeds the website check found. Nothing is read from one until an admin
-- accepts it; a site that fails three runs in a row is paused.
create table source_candidates (
  id bigint generated always as identity primary key,
  region_id text not null references regions (id) on delete cascade,
  osm_id text references osm_venues (osm_id) on delete set null,
  venue_name text not null,
  point extensions.geography(point, 4326) not null,
  url text not null unique,
  kind text not null check (kind in ('ical', 'tribe', 'jsonld')),
  -- Upcoming events found by the check, and up to three of them: [{ title, start }].
  event_count integer not null default 0,
  sample jsonb not null default '[]',
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected', 'paused')),
  failures integer not null default 0,
  last_error text,
  found_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  last_run_at timestamptz
);
create index source_candidates_status_idx on source_candidates (region_id, status);
alter table source_candidates enable row level security;
