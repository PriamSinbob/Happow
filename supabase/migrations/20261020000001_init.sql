-- Happow milestone 1: core schema (schema.org/Event-shaped), PostGIS geography, H3 cells as text.
-- H3 indexes are computed in application code (h3-js); no h3 extension needed.

create extension if not exists postgis with schema extensions;

-- Supabase provides these roles; create them on plain Postgres so the same file runs locally and in CI.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create type event_status as enum ('scheduled', 'cancelled', 'postponed');
create type trust_level as enum ('api', 'crawled', 'community');
create type submission_status as enum ('pending', 'approved', 'rejected');

create table regions (
  id text primary key,
  name jsonb not null,               -- {pl, en}
  timezone text not null,
  center extensions.geography(point, 4326) not null,
  polygon extensions.geography(polygon, 4326) not null,
  enabled_sources text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table categories (
  id text primary key,
  labels jsonb not null,             -- {pl, en}
  default_duration_min integer not null check (default_duration_min > 0),
  icon text not null,
  color text not null,
  sort_order integer not null default 0
);

create table sources (
  id text primary key,
  adapter text not null,
  region_ids text[] not null default '{}',
  schedule text,
  rate_limit text,
  trust_level trust_level not null,
  enabled boolean not null default true,
  terms_notes text not null default ''
);

create table venues (
  id text primary key,
  name text not null,
  address text,
  point extensions.geography(point, 4326) not null,
  h3_r9 text not null,
  website text,
  accessibility text
);
create index venues_point_idx on venues using gist (point);

create table events (
  id text primary key,
  region_id text not null references regions (id),
  title text not null,
  description text,
  category_ids text[] not null check (cardinality(category_ids) > 0),
  start_at timestamptz not null,
  end_at timestamptz not null,
  end_estimated boolean not null default false,
  timezone text not null,
  venue_id text references venues (id),
  point extensions.geography(point, 4326) not null,
  h3_r9 text not null,
  price_min numeric(10, 2),
  price_max numeric(10, 2),
  currency char(3),
  is_free boolean not null default false,
  rules jsonb not null default '{}',
  official_url text,
  ticket_url text,
  image_url text,
  status event_status not null default 'scheduled',
  trust trust_level not null,
  confidence real not null default 1 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (end_at >= start_at)
);
create index events_point_idx on events using gist (point);
create index events_time_idx on events (start_at, end_at);
create index events_h3_idx on events (h3_r9);

create table event_sources (
  event_id text not null references events (id) on delete cascade,
  source_id text not null references sources (id),
  external_id text not null,
  source_url text,
  raw_payload_ref text,
  fetched_at timestamptz not null default now(),
  primary key (source_id, external_id)
);
create index event_sources_event_idx on event_sources (event_id);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  url text,
  form_payload jsonb,
  extracted_payload jsonb,
  status submission_status not null default 'pending',
  moderator_note text,
  submitter_hash text not null,
  created_at timestamptz not null default now()
);

create table weather_cache (
  h3_r7 text not null,
  provider text not null,
  fetched_at timestamptz not null default now(),
  hourly jsonb not null,
  primary key (h3_r7, provider)
);

-- Events overlapping [from_ts, to_ts] within radius_m of (lat, lng), nearest first.
create or replace function events_near(
  lat double precision,
  lng double precision,
  radius_m double precision,
  from_ts timestamptz,
  to_ts timestamptz
)
returns table (
  id text,
  title text,
  description text,
  category_ids text[],
  start_at timestamptz,
  end_at timestamptz,
  end_estimated boolean,
  timezone text,
  venue_id text,
  venue_name text,
  venue_address text,
  lat double precision,
  lng double precision,
  h3_r9 text,
  price_min numeric,
  price_max numeric,
  currency text,
  is_free boolean,
  rules jsonb,
  official_url text,
  ticket_url text,
  image_url text,
  status event_status,
  trust trust_level,
  confidence real,
  last_seen_at timestamptz,
  distance_m double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with here as (
    select extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography as g
  )
  select
    e.id, e.title, e.description, e.category_ids, e.start_at, e.end_at, e.end_estimated, e.timezone,
    e.venue_id, v.name, v.address,
    extensions.st_y(e.point::extensions.geometry), extensions.st_x(e.point::extensions.geometry),
    e.h3_r9, e.price_min, e.price_max, e.currency::text, e.is_free, e.rules,
    e.official_url, e.ticket_url, e.image_url, e.status, e.trust, e.confidence, e.last_seen_at,
    extensions.st_distance(e.point, here.g) as distance_m
  from events e
  cross join here
  left join venues v on v.id = e.venue_id
  where extensions.st_dwithin(e.point, here.g, least(radius_m, 50000))
    and e.start_at <= to_ts
    and e.end_at >= from_ts
    and e.status <> 'cancelled'
  order by round((extensions.st_distance(e.point, here.g) / 10)::numeric), e.start_at
  limit 500;
$$;

-- Row level security: public read of published data; writes only via service role (workers, seed).
alter table regions enable row level security;
alter table categories enable row level security;
alter table sources enable row level security;
alter table venues enable row level security;
alter table events enable row level security;
alter table event_sources enable row level security;
alter table submissions enable row level security;
alter table weather_cache enable row level security;

create policy "public read" on regions for select to anon, authenticated using (true);
create policy "public read" on categories for select to anon, authenticated using (true);
create policy "public read" on venues for select to anon, authenticated using (true);
create policy "public read" on events for select to anon, authenticated using (true);

grant usage on schema public, extensions to anon, authenticated;
grant select on regions, categories, venues, events to anon, authenticated;
grant execute on function events_near(double precision, double precision, double precision, timestamptz, timestamptz)
  to anon, authenticated;
