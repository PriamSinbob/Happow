-- Happow milestone 2: source ingestion (raw payloads, runs, dedup ownership) and filtered geo queries.

-- The listing (source + external id) whose data fills the event's primary fields. On a merge the
-- highest-trust source wins; among equals the first listing keeps it, so re-runs never flip-flop.
alter table events add column primary_source_id text references sources (id);
alter table events add column primary_external_id text;
-- API terms cap how long data may be shown without re-confirmation; null = no limit.
alter table events add column stale_after timestamptz;
create index events_h3_start_idx on events (h3_r9, start_at);
update events e set primary_source_id = es.source_id, primary_external_id = es.external_id
  from event_sources es where es.event_id = e.id and e.primary_source_id is null;

-- Latest payload per source item, unchanged, so events can be re-parsed without refetching.
create table raw_payloads (
  source_id text not null references sources (id),
  external_id text not null,
  content_hash text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (source_id, external_id)
);

-- One row per scheduler run of a source in a region; the scheduler reads it to decide what is due.
create table source_runs (
  id bigint generated always as identity primary key,
  source_id text not null references sources (id),
  region_id text not null references regions (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'ok', 'failed', 'skipped')),
  stats jsonb not null default '{}',
  error text
);
create index source_runs_latest_idx on source_runs (source_id, region_id, started_at desc);

alter table raw_payloads enable row level security;
alter table source_runs enable row level security;

-- Source links are public facts (which source listed the event, and where).
create policy "public read" on event_sources for select to anon, authenticated using (true);
grant select on event_sources to anon, authenticated;

-- Everything a client shows about an event, in one place for events_near and event_by_id.
create view events_public with (security_invoker = true) as
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
     order by (es.source_id = e.primary_source_id) desc nulls last, es.fetched_at desc
     limit 1) as source_url
from events e
left join venues v on v.id = e.venue_id
where e.stale_after is null or e.stale_after > now();

grant select on events_public to anon, authenticated;

drop function events_near(double precision, double precision, double precision, timestamptz, timestamptz);

-- Events overlapping [from_ts, to_ts] within radius_m of (lat, lng), nearest first.
-- categories: any overlap with the event's categories (null or empty = all). price: any | free | paid.
create function events_near(
  lat double precision,
  lng double precision,
  radius_m double precision,
  from_ts timestamptz,
  to_ts timestamptz,
  categories text[] default null,
  price text default 'any'
)
returns table (
  id text, title text, description text, category_ids text[], start_at timestamptz,
  end_at timestamptz, end_estimated boolean, timezone text, venue_id text, venue_name text,
  venue_address text, venue_website text, lat double precision, lng double precision, h3_r9 text,
  price_min numeric, price_max numeric, currency text, is_free boolean, rules jsonb,
  official_url text, ticket_url text, image_url text, status event_status, trust trust_level,
  confidence real, last_seen_at timestamptz, primary_source_id text, source_url text,
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
    e.venue_id, e.venue_name, e.venue_address, e.venue_website, e.lat, e.lng, e.h3_r9,
    e.price_min, e.price_max, e.currency, e.is_free, e.rules, e.official_url, e.ticket_url,
    e.image_url, e.status, e.trust, e.confidence, e.last_seen_at, e.primary_source_id, e.source_url,
    extensions.st_distance(e.point, here.g) as distance_m
  from events_public e
  cross join here
  where extensions.st_dwithin(e.point, here.g, least(radius_m, 50000))
    and e.start_at <= to_ts
    and e.end_at >= from_ts
    and e.status <> 'cancelled'
    and (categories is null or cardinality(categories) = 0 or e.category_ids && categories)
    and (price = 'any' or (price = 'free' and e.is_free) or (price = 'paid' and not e.is_free))
  order by round((extensions.st_distance(e.point, here.g) / 10)::numeric), e.start_at
  limit 500;
$$;

-- One event by id, for the detail screen and shared links. Distance from (lat, lng) when given.
create function event_by_id(
  event_id text,
  lat double precision default null,
  lng double precision default null
)
returns table (
  id text, title text, description text, category_ids text[], start_at timestamptz,
  end_at timestamptz, end_estimated boolean, timezone text, venue_id text, venue_name text,
  venue_address text, venue_website text, lat double precision, lng double precision, h3_r9 text,
  price_min numeric, price_max numeric, currency text, is_free boolean, rules jsonb,
  official_url text, ticket_url text, image_url text, status event_status, trust trust_level,
  confidence real, last_seen_at timestamptz, primary_source_id text, source_url text,
  distance_m double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    e.id, e.title, e.description, e.category_ids, e.start_at, e.end_at, e.end_estimated, e.timezone,
    e.venue_id, e.venue_name, e.venue_address, e.venue_website, e.lat, e.lng, e.h3_r9,
    e.price_min, e.price_max, e.currency, e.is_free, e.rules, e.official_url, e.ticket_url,
    e.image_url, e.status, e.trust, e.confidence, e.last_seen_at, e.primary_source_id, e.source_url,
    case when event_by_id.lat is null or event_by_id.lng is null then null
      else extensions.st_distance(
        e.point,
        extensions.st_setsrid(extensions.st_makepoint(event_by_id.lng, event_by_id.lat), 4326)::extensions.geography)
    end
  from events_public e
  where e.id = event_id;
$$;

grant execute on function events_near(double precision, double precision, double precision, timestamptz, timestamptz, text[], text)
  to anon, authenticated;
grant execute on function event_by_id(text, double precision, double precision) to anon, authenticated;
