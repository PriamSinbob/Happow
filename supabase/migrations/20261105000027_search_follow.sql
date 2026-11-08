-- M7 search and followed artists (docs/milestones/M7-search-follow.md).
-- Slice A: performers per event, written by ingestion and by publish_event (submissions).
-- Slice B: typo-tolerant search over titles, venues and performers (pg_trgm, unaccent).
-- Slice D: matching a device's follows (nothing is stored).
-- Slice E: a cache of nationwide Ticketmaster lookups per attraction, with no link to anyone.
-- Slice G: follows synced per account, and alerts when a followed artist gets a new date.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- `unaccent` is only stable (its dictionary could change), so indexes need an immutable wrapper.
create or replace function f_unaccent(t text)
returns text
language sql
immutable
parallel safe
strict
set search_path = public, extensions
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, t)
$$;

-- The same form as normName in packages/core/src/performers.ts: lowercase, no diacritics,
-- whitespace collapsed. ("ł" is in unaccent's rules; translate keeps it explicit.)
create or replace function f_norm(t text)
returns text
language sql
immutable
parallel safe
strict
set search_path = public, extensions
as $$
  select btrim(regexp_replace(lower(f_unaccent(translate(t, 'łŁ', 'lL'))), '\s+', ' ', 'g'))
$$;

-- ---------- Slice A: performers ----------

create table event_performers (
  event_id text not null references events (id) on delete cascade,
  ord smallint not null default 0,
  name text not null check (length(name) between 1 and 120),
  norm text not null check (length(norm) between 1 and 120),
  source_id text,
  external_id text,
  primary key (event_id, norm)
);
create index event_performers_norm_trgm on event_performers using gin (norm extensions.gin_trgm_ops);
create index event_performers_norm_idx on event_performers (norm);
create index event_performers_ext_idx on event_performers (external_id) where external_id is not null;
alter table event_performers enable row level security;
-- Readable with the event: public events only (M11 §1).
create policy "public read" on event_performers for select to anon, authenticated
  using (exists (select 1 from events e where e.id = event_id and e.visibility = 'public'));
grant select on event_performers to anon, authenticated;

-- Up to `n` performer names of an event, in the source's order (the snapshot carries 5).
create or replace function event_performer_names(p_event text, n integer)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(name order by ord), '{}')
  from (select name, ord from event_performers where event_id = p_event order by ord limit n) p
$$;

-- Names and Ticketmaster ids of an event, for the card's chips and following.
create or replace function event_performer_list(p_event text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'externalId', external_id)
    order by ord), '[]'::jsonb)
  from event_performers where event_id = p_event
$$;

-- publish_event (submissions, moderation) also writes the performers it is given.
create or replace function publish_event(p jsonb)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e jsonb := p -> 'event';
  v jsonb := p -> 'venue';
  eid text := e ->> 'id';
begin
  if v is not null and v <> 'null'::jsonb then
    insert into venues (id, name, address, point, h3_r9, website)
    values (v ->> 'id', v ->> 'name', v ->> 'address',
      st_point((v -> 'point' ->> 'lng')::float8, (v -> 'point' ->> 'lat')::float8)::geography,
      v ->> 'h3r9', v ->> 'website')
    on conflict (id) do update set name = excluded.name, address = excluded.address,
      point = excluded.point, h3_r9 = excluded.h3_r9;
  end if;
  insert into events (id, region_id, title, description, category_ids, start_at, end_at,
    end_estimated, timezone, venue_id, point, h3_r9, density_cell, price_min, price_max, currency,
    is_free, rules, official_url, ticket_url, image_url, status, trust, confidence, last_seen_at,
    primary_source_id, primary_external_id, stale_after, verified, entry, grace_min, age_min,
    family)
  values (eid, p ->> 'regionId', e ->> 'title', e ->> 'description',
    array(select jsonb_array_elements_text(e -> 'categoryIds')),
    (e ->> 'startAt')::timestamptz, (e ->> 'endAt')::timestamptz, (e ->> 'endEstimated')::boolean,
    e ->> 'timezone', case when v is null or v = 'null'::jsonb then null else v ->> 'id' end,
    st_point((e -> 'point' ->> 'lng')::float8, (e -> 'point' ->> 'lat')::float8)::geography,
    e ->> 'h3r9', e ->> 'densityCell', (e ->> 'priceMin')::numeric, (e ->> 'priceMax')::numeric,
    e ->> 'currency', (e ->> 'isFree')::boolean, coalesce(e -> 'rules', '{}'::jsonb),
    e ->> 'officialUrl', e ->> 'ticketUrl', e ->> 'imageUrl', (e ->> 'status')::event_status,
    (e ->> 'trust')::trust_level, coalesce((e ->> 'confidence')::real, 1), now(),
    p ->> 'sourceId', p ->> 'externalId', (p ->> 'staleAfter')::timestamptz,
    coalesce((p ->> 'verified')::boolean, true), e ->> 'entry', (e ->> 'graceMin')::smallint,
    (e ->> 'ageMin')::smallint, (e ->> 'family')::boolean)
  on conflict (id) do update set verified = excluded.verified, hidden = false;
  insert into event_sources (event_id, source_id, external_id, source_url, fetched_at)
  values (eid, p ->> 'sourceId', p ->> 'externalId', p ->> 'sourceUrl', now())
  on conflict (source_id, external_id) do update set event_id = excluded.event_id, fetched_at = now();
  if jsonb_typeof(e -> 'performers') = 'array' then
    insert into event_performers (event_id, ord, name, norm, source_id, external_id)
    select eid, (x.ord - 1)::smallint, left(btrim(x.v ->> 'name'), 120),
      left(f_norm(x.v ->> 'name'), 120), p ->> 'sourceId', nullif(x.v ->> 'externalId', '')
    from jsonb_array_elements(e -> 'performers') with ordinality as x(v, ord)
    where length(f_norm(coalesce(x.v ->> 'name', ''))) >= 2 and x.ord <= 30
    on conflict (event_id, norm) do nothing;
  end if;
  return eid;
end $$;

-- ---------- Slice B: search text and indexes ----------

-- Title and venue name, normalised. Kept by a trigger (the venue name lives in another table).
alter table events add column search_text text not null default '';

create or replace function events_search_text()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.search_text := f_norm(new.title || ' ' || coalesce(
    (select name from venues where id = new.venue_id), ''));
  return new;
end $$;

create trigger events_search_text before insert or update of title, venue_id on events
  for each row execute function events_search_text();

create or replace function venues_search_text()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  update events set search_text = f_norm(title || ' ' || new.name) where venue_id = new.id;
  return null;
end $$;

create trigger venues_search_text after update of name on venues
  for each row when (old.name is distinct from new.name) execute function venues_search_text();

update events e set search_text = f_norm(e.title || ' ' || coalesce(
  (select name from venues v where v.id = e.venue_id), ''));

create index events_search_trgm on events using gin (search_text extensions.gin_trgm_ops);

-- ---------- Readers gain the performers ----------

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
     order by (es.source_id = e.primary_source_id and es.external_id = e.primary_external_id)
       desc nulls last,
       (es.source_id = e.primary_source_id) desc nulls last, es.fetched_at desc, es.external_id
     limit 1) as source_url,
  coalesce(e.density_cell, e.h3_r9) as density_cell,
  e.verified, e.flag_reason, e.flag_count, e.flag_at,
  e.entry, e.grace_min, e.age_min, e.family,
  event_performer_list(e.id) as performers
from events e
left join venues v on v.id = e.venue_id
where (e.stale_after is null or e.stale_after > now()) and not e.hidden
  and e.visibility = 'public';

drop function event_by_id(text, double precision, double precision);
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
  distance_m double precision, verified boolean, flag_reason text, flag_count integer,
  flag_at timestamptz, entry text, grace_min smallint, age_min smallint, family boolean,
  performers jsonb
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
    end,
    e.verified, e.flag_reason, e.flag_count, e.flag_at, e.entry, e.grace_min, e.age_min, e.family,
    e.performers
  from events_public e
  where e.id = event_id;
$$;
grant execute on function event_by_id(text, double precision, double precision) to anon, authenticated;

drop function events_by_ids(text[], double precision, double precision);
create function events_by_ids(
  ids text[],
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
  distance_m double precision, verified boolean, flag_reason text, flag_count integer,
  flag_at timestamptz, entry text, grace_min smallint, age_min smallint, family boolean,
  performers jsonb
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
    case when events_by_ids.lat is null or events_by_ids.lng is null then null
      else extensions.st_distance(
        e.point,
        extensions.st_setsrid(extensions.st_makepoint(events_by_ids.lng, events_by_ids.lat), 4326)::extensions.geography)
    end,
    e.verified, e.flag_reason, e.flag_count, e.flag_at, e.entry, e.grace_min, e.age_min, e.family,
    e.performers
  from events_public e
  where e.id = any (ids[1:500])
  order by e.start_at;
$$;
grant execute on function events_by_ids(text[], double precision, double precision)
  to anon, authenticated;

-- The area snapshot carries up to 5 names per event (no ids), for the card's chips.
drop function events_area(double precision, double precision, double precision, timestamptz, timestamptz, integer);
create function events_area(
  lat double precision,
  lng double precision,
  radius_m double precision,
  from_ts timestamptz,
  to_ts timestamptz,
  max_events integer default 1000
)
returns table (
  id text, title text, category_ids text[], start_at timestamptz, end_at timestamptz,
  end_estimated boolean, timezone text, venue_id text, venue_name text, venue_address text,
  lat double precision, lng double precision, h3_r9 text, density_cell text,
  price_min numeric, price_max numeric, currency text, is_free boolean, rules jsonb,
  official_url text, ticket_url text, status event_status, trust trust_level, confidence real,
  last_seen_at timestamptz, primary_source_id text, verified boolean, flag_reason text,
  flag_count integer, flag_at timestamptz, entry text, grace_min smallint, age_min smallint,
  family boolean, performers text[]
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
    e.id, e.title, e.category_ids, e.start_at, e.end_at, e.end_estimated, e.timezone,
    e.venue_id, v.name, v.address,
    extensions.st_y(e.point::extensions.geometry), extensions.st_x(e.point::extensions.geometry),
    e.h3_r9, coalesce(e.density_cell, e.h3_r9), e.price_min, e.price_max, e.currency::text,
    e.is_free, e.rules, e.official_url, e.ticket_url, e.status, e.trust, e.confidence,
    e.last_seen_at, e.primary_source_id, e.verified, e.flag_reason, e.flag_count, e.flag_at,
    e.entry, e.grace_min, e.age_min, e.family, event_performer_names(e.id, 5)
  from events e
  left join venues v on v.id = e.venue_id
  cross join here
  where extensions.st_dwithin(e.point, here.g, least(radius_m, 60000))
    and e.start_at <= to_ts
    and e.end_at >= from_ts
    and e.status <> 'cancelled'
    and not e.hidden and e.visibility = 'public'
    and (e.stale_after is null or e.stale_after > now())
  order by extensions.st_distance(e.point, here.g), e.start_at
  limit least(greatest(max_events, 1), 5000);
$$;
grant execute on function events_area(double precision, double precision, double precision, timestamptz, timestamptz, integer)
  to anon, authenticated;

-- ---------- Slice B: search ----------

-- Upcoming public events in a region matching `q` (§2): an exact performer first, then similar
-- performers, then title or venue; ties by start. No radius and no time window beyond [from, to].
-- Nothing about the query is stored.
create or replace function search_events(
  q text,
  p_region text,
  p_lat double precision,
  p_lng double precision,
  from_ts timestamptz,
  to_ts timestamptz,
  max_results integer default 40,
  min_similarity real default 0.3,
  min_word_similarity real default 0.6
)
returns table (
  id text, title text, category_ids text[], start_at timestamptz, end_at timestamptz,
  timezone text, venue_name text, lat double precision, lng double precision,
  distance_m double precision, is_free boolean, status event_status, performers text[],
  matched_performer text, matched_external_id text, match text, score real
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  n text := left(f_norm(q), 80);
begin
  if n is null or length(n) < 2 then
    return;
  end if;
  perform set_config('pg_trgm.similarity_threshold', min_similarity::text, true);
  perform set_config('pg_trgm.word_similarity_threshold', min_word_similarity::text, true);
  return query
  with perf as (
    select distinct on (p.event_id) p.event_id, p.name, p.external_id, (p.norm = n) as exact,
      greatest(extensions.similarity(p.norm, n), extensions.word_similarity(n, p.norm)) as s
    from event_performers p
    where p.norm = n or p.norm operator(extensions.%) n or n operator(extensions.<%) p.norm
    order by p.event_id, (p.norm = n) desc,
      greatest(extensions.similarity(p.norm, n), extensions.word_similarity(n, p.norm)) desc
  ),
  txt as (
    select e.id as event_id,
      greatest(extensions.similarity(e.search_text, n), extensions.word_similarity(n, e.search_text)) as s
    from events e
    where e.search_text operator(extensions.%) n or n operator(extensions.<%) e.search_text
  ),
  hits as (
    select coalesce(perf.event_id, txt.event_id) as event_id, perf.name, perf.external_id,
      coalesce(perf.exact, false) as exact, perf.event_id is not null as by_performer,
      greatest(coalesce(perf.s, 0), coalesce(txt.s, 0))::real as s
    from perf full join txt on txt.event_id = perf.event_id
  )
  select e.id, e.title, e.category_ids, e.start_at, e.end_at, e.timezone, v.name,
    extensions.st_y(e.point::extensions.geometry), extensions.st_x(e.point::extensions.geometry),
    case when p_lat is null or p_lng is null then null
      else extensions.st_distance(e.point, extensions.st_setsrid(
        extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
    end,
    e.is_free, e.status, event_performer_names(e.id, 5), h.name, h.external_id,
    case when h.exact then 'performer' when h.by_performer then 'performer_similar' else 'title' end,
    h.s
  from hits h
  join events e on e.id = h.event_id
  left join venues v on v.id = e.venue_id
  where e.region_id = p_region and e.visibility = 'public' and not e.hidden
    and e.status <> 'cancelled'
    and (e.stale_after is null or e.stale_after > now())
    and e.end_at >= from_ts and e.start_at <= to_ts
  order by case when h.exact then 0 when h.by_performer then 1 else 2 end, h.s desc, e.start_at
  limit least(greatest(max_results, 1), 100);
end $$;

-- ---------- Slice D: matching follows (nothing stored) ----------

-- Upcoming public events in the region with a followed performer, by name or Ticketmaster id.
create or replace function follows_match(
  p_norms text[],
  p_tm_ids text[],
  p_region text,
  p_lat double precision,
  p_lng double precision,
  from_ts timestamptz,
  to_ts timestamptz,
  max_results integer default 100
)
returns table (
  id text, title text, category_ids text[], start_at timestamptz, end_at timestamptz,
  timezone text, venue_name text, lat double precision, lng double precision,
  distance_m double precision, is_free boolean, status event_status, performers text[],
  matched_performer text, matched_norm text, matched_external_id text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select distinct on (e.start_at, e.id) e.id, e.title, e.category_ids, e.start_at, e.end_at,
    e.timezone, v.name,
    extensions.st_y(e.point::extensions.geometry), extensions.st_x(e.point::extensions.geometry),
    case when p_lat is null or p_lng is null then null
      else extensions.st_distance(e.point, extensions.st_setsrid(
        extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
    end,
    e.is_free, e.status, event_performer_names(e.id, 5), p.name, p.norm, p.external_id
  from event_performers p
  join events e on e.id = p.event_id
  left join venues v on v.id = e.venue_id
  where (p.norm = any (p_norms[1:200]) or p.external_id = any (p_tm_ids[1:200]))
    and e.region_id = p_region and e.visibility = 'public' and not e.hidden
    and e.status <> 'cancelled'
    and (e.stale_after is null or e.stale_after > now())
    and e.end_at >= from_ts and e.start_at <= to_ts
  order by e.start_at, e.id, p.ord
  limit least(greatest(max_results, 1), 300);
$$;

-- ---------- Slice E: nationwide Ticketmaster lookups ----------

-- One row per attraction: its upcoming events in the country, as the API answered. No user link.
create table follow_lookups (
  attraction_id text primary key check (length(attraction_id) between 1 and 100),
  fetched_at timestamptz not null default now(),
  events jsonb not null default '[]'::jsonb
);
alter table follow_lookups enable row level security;

create or replace function follow_lookups_get(p_ids text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(attraction_id, jsonb_build_object(
    'fetchedAt', fetched_at, 'events', events)), '{}'::jsonb)
  from follow_lookups where attraction_id = any (p_ids[1:200])
$$;

create or replace function follow_lookups_put(p_id text, p_events jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into follow_lookups (attraction_id, fetched_at, events) values (p_id, now(), p_events)
  on conflict (attraction_id) do update set fetched_at = now(), events = excluded.events;
  delete from follow_lookups where fetched_at < now() - interval '7 days';
$$;

-- ---------- Slice G: follows on the account, and new-date alerts ----------

-- One row per account and name; a removal stays as a tombstone so other devices learn of it.
create table account_follows (
  user_id uuid not null references auth.users (id) on delete cascade,
  norm text not null check (length(norm) between 2 and 120),
  name text not null check (length(name) between 2 and 120),
  tm_attraction_id text check (length(tm_attraction_id) <= 100),
  changed_at timestamptz not null,
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, norm)
);
create index account_follows_norm_idx on account_follows (norm) where not removed;
alter table account_follows enable row level security;

create table follow_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  alerts boolean not null default false,
  -- When alerts were last switched on: only dates announced after it are sent.
  alerts_since timestamptz,
  updated_at timestamptz not null default now()
);
alter table follow_settings enable row level security;

-- An alert per account and event, made when a followed performer's new date appears.
create table follow_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null references events (id) on delete cascade,
  performer text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, event_id)
);
create index follow_alerts_pending_idx on follow_alerts (created_at) where sent_at is null;
alter table follow_alerts enable row level security;

-- Last writer wins per name, by the device's change time. Returns the account's list
-- (tombstones of the last 60 days too, so devices drop removed names).
create or replace function follows_sync(p_user uuid, p_items jsonb, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into account_follows (user_id, norm, name, tm_attraction_id, changed_at, removed)
  select p_user, left(f_norm(x ->> 'norm'), 120), left(btrim(x ->> 'name'), 120),
    nullif(x ->> 'tmAttractionId', ''), least((x ->> 'changedAt')::timestamptz, now()),
    coalesce((x ->> 'removed')::boolean, false)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x
  where length(f_norm(coalesce(x ->> 'norm', ''))) >= 2
    and length(btrim(coalesce(x ->> 'name', ''))) >= 2
  on conflict (user_id, norm) do update set name = excluded.name,
    tm_attraction_id = coalesce(excluded.tm_attraction_id, account_follows.tm_attraction_id),
    changed_at = excluded.changed_at, removed = excluded.removed
  where excluded.changed_at > account_follows.changed_at;
  -- Over the cap: the oldest additions go.
  update account_follows f set removed = true, changed_at = now()
  where f.user_id = p_user and not f.removed and f.norm in (
    select norm from account_follows where user_id = p_user and not removed
    order by changed_at desc offset greatest(p_max, 0));
  delete from account_follows
  where user_id = p_user and removed and changed_at < now() - interval '60 days';
  return (
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'norm', norm,
      'tmAttractionId', tm_attraction_id, 'changedAt', changed_at, 'removed', removed)
      order by changed_at), '[]'::jsonb)
    from account_follows where user_id = p_user);
end $$;

create or replace function follow_settings_get(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('alerts', coalesce((select alerts from follow_settings
    where user_id = p_user), false))
$$;

create or replace function follow_alerts_set(p_user uuid, p_on boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into follow_settings (user_id, alerts, alerts_since, updated_at)
  values (p_user, p_on, case when p_on then now() end, now())
  on conflict (user_id) do update set alerts = excluded.alerts, updated_at = now(),
    alerts_since = case when excluded.alerts and not follow_settings.alerts then now()
      else follow_settings.alerts_since end;
  delete from follow_alerts where user_id = p_user and sent_at is null and not p_on;
$$;

-- New dates for followed performers (§5): public, upcoming events first stored after both the
-- follow and the switch-on. Run by the Cron Trigger; returns how many alerts it made.
create or replace function follow_alerts_queue(p_lookback_hours integer default 48)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with made as (
    insert into follow_alerts (user_id, event_id, performer)
    select distinct on (f.user_id, e.id) f.user_id, e.id, p.name
    from account_follows f
    join follow_settings s on s.user_id = f.user_id and s.alerts
    join event_performers p
      on p.norm = f.norm or (f.tm_attraction_id is not null and p.external_id = f.tm_attraction_id)
    join events e on e.id = p.event_id
    where not f.removed and e.visibility = 'public' and not e.hidden
      and e.status = 'scheduled' and e.start_at > now()
      and e.created_at > greatest(f.created_at, s.alerts_since)
      and e.created_at > now() - make_interval(hours => p_lookback_hours)
    order by f.user_id, e.id
    on conflict (user_id, event_id) do nothing
    returning 1)
  select count(*) into n from made;
  delete from follow_alerts where sent_at < now() - interval '30 days';
  return n;
end $$;

-- Alerts to send now, oldest first, with the account's push subscriptions.
create or replace function follow_alerts_due(p_limit integer)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with due as (
    select a.id, a.user_id, a.performer, e.id as event_id, e.title, v.name as venue_name,
      e.start_at, e.timezone, e.hidden, e.status::text as status
    from follow_alerts a
    join events e on e.id = a.event_id
    left join venues v on v.id = e.venue_id
    where a.sent_at is null
    order by a.created_at
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'eventId', d.event_id, 'title', d.title, 'venue', d.venue_name,
    'performer', d.performer, 'startAt', d.start_at, 'timezone', d.timezone,
    'hidden', d.hidden, 'status', d.status,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang
      )), '[]'::jsonb)
      from push_subscriptions s where s.user_id = d.user_id)
  )), '[]'::jsonb)
  from due d
$$;

create or replace function follow_alerts_done(p_ids bigint[], p_sent_endpoints text[], p_gone_endpoints text[])
returns void
language sql
security definer
set search_path = public
as $$
  update follow_alerts set sent_at = now() where id = any (p_ids);
  update push_subscriptions set last_used_at = now() where endpoint = any (p_sent_endpoints);
  delete from push_subscriptions where endpoint = any (p_gone_endpoints);
$$;

-- Export (GDPR): the follows and the alert setting join the account's export.
alter function account_export(uuid) rename to account_export_m11;
create function account_export(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select account_export_m11(p_user) || jsonb_build_object(
    'follows', (
      select coalesce(jsonb_agg(jsonb_build_object('name', f.name,
        'tmAttractionId', f.tm_attraction_id, 'since', f.created_at) order by f.created_at),
        '[]'::jsonb)
      from account_follows f where f.user_id = p_user and not f.removed),
    'followAlerts', follow_settings_get(p_user),
    'followAlertsSent', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', a.event_id,
        'performer', a.performer, 'sentAt', a.sent_at) order by a.created_at), '[]'::jsonb)
      from follow_alerts a where a.user_id = p_user)
  )
$$;

revoke all on table follow_lookups, account_follows, follow_settings, follow_alerts
  from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'search_events(text, text, double precision, double precision, timestamptz, timestamptz, integer, real, real)',
    'follows_match(text[], text[], text, double precision, double precision, timestamptz, timestamptz, integer)',
    'follow_lookups_get(text[])', 'follow_lookups_put(text, jsonb)',
    'follows_sync(uuid, jsonb, integer)', 'follow_settings_get(uuid)',
    'follow_alerts_set(uuid, boolean)', 'follow_alerts_queue(integer)',
    'follow_alerts_due(integer)', 'follow_alerts_done(bigint[], text[], text[])',
    'account_export(uuid)', 'account_export_m11(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
