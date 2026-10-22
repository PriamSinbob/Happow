-- Happow M6 slice C: entry type and age data (spec §4.2, §4.4).
-- Four typed columns replace the free-text rules.age. All are nullable: null means the source
-- did not say, and the app applies the category defaults from config/categories.json when it
-- reads the event, so a config change reaches every stored event without re-ingesting.
--   entry      'fixed' (set start) or 'open' (come and go)
--   grace_min  fixed entry: minutes after the start that still count as on time
--   age_min    youngest age let in: 0 = explicitly all ages, 18 = 18+
--   family     explicitly meant for children or families

alter table events
  add column entry text check (entry in ('fixed', 'open')),
  add column grace_min smallint check (grace_min between 0 and 120),
  add column age_min smallint check (age_min between 0 and 21),
  add column family boolean;

-- Existing rules.age text moves into age_min: "16+" → 16, "18+" → 18; "0+" and "all …" → 0.
-- Anything else was unstructured free text and is dropped with the key.
update events set
  age_min = case
    when (substring(rules ->> 'age' from '^\s*(\d{1,2})\s*\+'))::int <= 21
      then (substring(rules ->> 'age' from '^\s*(\d{1,2})\s*\+'))::int
    when rules ->> 'age' ~* '^\s*(all|wszyscy|bez ogranicze)' then 0
  end,
  rules = rules - 'age'
where rules ? 'age';

-- The public view gains the columns (appended, so create or replace keeps dependants).
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
  e.entry, e.grace_min, e.age_min, e.family
from events e
left join venues v on v.id = e.venue_id
where (e.stale_after is null or e.stale_after > now()) and not e.hidden;

-- Return types change, so drop and recreate the readers.
drop function events_near(double precision, double precision, double precision, timestamptz, timestamptz, text[], text);
drop function event_by_id(text, double precision, double precision);
drop function events_area(double precision, double precision, double precision, timestamptz, timestamptz, integer);

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
  distance_m double precision, verified boolean, flag_reason text, flag_count integer,
  flag_at timestamptz, entry text, grace_min smallint, age_min smallint, family boolean
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
    extensions.st_distance(e.point, here.g) as distance_m, e.verified, e.flag_reason,
    e.flag_count, e.flag_at, e.entry, e.grace_min, e.age_min, e.family
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
  flag_at timestamptz, entry text, grace_min smallint, age_min smallint, family boolean
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
    e.verified, e.flag_reason, e.flag_count, e.flag_at, e.entry, e.grace_min, e.age_min, e.family
  from events_public e
  where e.id = event_id;
$$;

-- The area snapshot carries the fields so family mode can filter on the phone (§4.4).
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
  family boolean
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
    e.entry, e.grace_min, e.age_min, e.family
  from events e
  left join venues v on v.id = e.venue_id
  cross join here
  where extensions.st_dwithin(e.point, here.g, least(radius_m, 60000))
    and e.start_at <= to_ts
    and e.end_at >= from_ts
    and e.status <> 'cancelled'
    and not e.hidden
    and (e.stale_after is null or e.stale_after > now())
  order by extensions.st_distance(e.point, here.g), e.start_at
  limit least(greatest(max_events, 1), 5000);
$$;

grant execute on function events_near(double precision, double precision, double precision, timestamptz, timestamptz, text[], text)
  to anon, authenticated;
grant execute on function event_by_id(text, double precision, double precision) to anon, authenticated;
grant execute on function events_area(double precision, double precision, double precision, timestamptz, timestamptz, integer)
  to anon, authenticated, service_role;

-- Submissions (submit_event → publish_event) store the new fields too.
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
  return eid;
end $$;
