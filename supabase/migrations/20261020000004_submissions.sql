-- Happow milestone 4: crawler caches, user submissions, reports and moderation.
-- Business rules live in the functions below; the API server calls them with the service role.
-- None of them is executable by anon or authenticated clients.

-- ---------- Events: moderation state ----------
-- verified = false: community submission not yet approved (shown with an "unverified" badge).
alter table events add column verified boolean not null default true;
-- hidden = true: removed by a moderator; kept for audit, never shown. Ingest updates leave it alone.
alter table events add column hidden boolean not null default false;

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
  e.verified
from events e
left join venues v on v.id = e.venue_id
where (e.stale_after is null or e.stale_after > now()) and not e.hidden;

-- events_near / event_by_id gain the verified flag (return types change, so drop and recreate).
drop function events_near(double precision, double precision, double precision, timestamptz, timestamptz, text[], text);
drop function event_by_id(text, double precision, double precision);

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
  distance_m double precision, verified boolean
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
    extensions.st_distance(e.point, here.g) as distance_m, e.verified
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
  distance_m double precision, verified boolean
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
    e.verified
  from events_public e
  where e.id = event_id;
$$;

grant execute on function events_near(double precision, double precision, double precision, timestamptz, timestamptz, text[], text)
  to anon, authenticated;
grant execute on function event_by_id(text, double precision, double precision) to anon, authenticated;

-- ---------- Caches (crawler and API) ----------
create table geocode_cache (
  query_key text primary key,
  provider text not null,
  result jsonb,                       -- null = looked up, not found
  fetched_at timestamptz not null default now()
);

-- LLM extraction results keyed by a hash of extractor + page text: unchanged pages cost nothing.
create table extraction_cache (
  content_hash text primary key,
  extractor text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- Submissions (users and low-confidence crawls) ----------
alter table submissions add column kind text not null default 'user' check (kind in ('user', 'crawl'));
alter table submissions add column region_id text references regions (id);
alter table submissions add column source_id text references sources (id);
alter table submissions add column external_id text;
alter table submissions add column confidence real;
alter table submissions add column event_id text references events (id) on delete set null;
alter table submissions add column reviewed_at timestamptz;
alter table submissions add column reviewed_by text;
create unique index submissions_listing_idx on submissions (source_id, external_id)
  where external_id is not null;
create index submissions_status_idx on submissions (status, created_at desc);

-- ---------- Reports ----------
create type report_reason as enum ('wrong_info', 'cancelled', 'inappropriate', 'other');
create table reports (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references events (id) on delete cascade,
  reason report_reason not null,
  note text check (char_length(note) <= 500),
  reporter_hash text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('dismissed', 'cancelled', 'hidden')),
  resolved_by text
);
-- One open report per device per event.
create unique index reports_open_once_idx on reports (event_id, reporter_hash) where resolved_at is null;

-- People allowed to moderate (Supabase Auth emails). Managed by hand: see README.
create table moderators (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create table rate_limits (
  bucket text not null,
  actor text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, actor, window_start)
);

alter table geocode_cache enable row level security;
alter table extraction_cache enable row level security;
alter table reports enable row level security;
alter table moderators enable row level security;
alter table rate_limits enable row level security;

-- ---------- Functions for the API server ----------

-- Counts one hit for actor in a fixed window; false once the limit is passed.
create function rate_limit_hit(p_bucket text, p_actor text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into rate_limits (bucket, actor, window_start, hits) values (p_bucket, p_actor, w, 1)
  on conflict (bucket, actor, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  delete from rate_limits where window_start < now() - interval '2 days';
  return n <= p_max;
end $$;

-- Inserts (or refreshes) a normalized event: the JSON shape the ingest pipeline produces
-- ({event, venue, sourceId, externalId, sourceUrl, staleAfter}) plus regionId and verified.
create function publish_event(p jsonb)
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
    primary_source_id, primary_external_id, stale_after, verified)
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
    coalesce((p ->> 'verified')::boolean, true))
  on conflict (id) do update set verified = excluded.verified, hidden = false;
  insert into event_sources (event_id, source_id, external_id, source_url, fetched_at)
  values (eid, p ->> 'sourceId', p ->> 'externalId', p ->> 'sourceUrl', now())
  on conflict (source_id, external_id) do update set event_id = excluded.event_id, fetched_at = now();
  return eid;
end $$;

-- A user submission. p: {id, form, normalized} (normalized as for publish_event, built by the
-- server, which computes H3 cells). Published at once as unverified when p_publish is true.
create function submit_event(p jsonb, p_submitter text, p_region text, p_publish boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid := (p ->> 'id')::uuid;
  eid text;
begin
  insert into submissions (id, kind, url, form_payload, extracted_payload, status, submitter_hash,
    region_id, source_id, external_id, confidence)
  values (sid, 'user', p -> 'form' ->> 'url', p -> 'form', p -> 'normalized', 'pending', p_submitter,
    p_region, p -> 'normalized' ->> 'sourceId', sid::text, 1);
  if p_publish then
    eid := publish_event((p -> 'normalized') || jsonb_build_object('regionId', p_region, 'verified', false));
    update submissions set event_id = eid where id = sid;
  end if;
  return sid;
end $$;

create function report_event(p_event text, p_reason report_reason, p_note text, p_reporter text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from events where id = p_event) then
    raise exception 'unknown event' using errcode = 'P0002';
  end if;
  insert into reports (event_id, reason, note, reporter_hash)
  values (p_event, p_reason, nullif(btrim(left(p_note, 500)), ''), p_reporter)
  on conflict (event_id, reporter_hash) where resolved_at is null do nothing;
  return true;
end $$;

create function is_moderator(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from moderators where email = lower(p_email)) $$;

-- Pending submissions and open reports (grouped per event), newest first.
create function moderation_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with open_reports as (
    select * from reports where resolved_at is null
  ),
  per_reason as (
    select event_id, jsonb_object_agg(reason, n) as reasons
    from (select event_id, reason, count(*)::int as n from open_reports group by 1, 2) x
    group by event_id
  ),
  per_event as (
    select event_id, count(*)::int as count, max(created_at) as last_at,
      (array_agg(note order by created_at desc) filter (where note is not null))[1:5] as notes
    from open_reports group by event_id
  )
  select jsonb_build_object(
    'submissions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc) from (
        select id, kind, source_id, url, confidence, event_id, created_at,
          left(submitter_hash, 8) as submitter, extracted_payload -> 'event' as event,
          extracted_payload -> 'venue' as venue, form_payload as form
        from submissions where status = 'pending' order by created_at desc limit 100) s), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.last_at desc) from (
        select p.event_id, e.title, e.start_at, e.status, e.hidden, e.trust, e.verified,
          v.name as venue_name, p.count, p.last_at, pr.reasons, p.notes
        from per_event p
        join per_reason pr using (event_id)
        join events e on e.id = p.event_id
        left join venues v on v.id = e.venue_id
        order by p.last_at desc limit 100) r), '[]'::jsonb));
$$;

create function moderate_submission(p_id uuid, p_action text, p_note text, p_moderator text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s submissions;
  eid text;
begin
  select * into s from submissions where id = p_id for update;
  if not found then raise exception 'unknown submission' using errcode = 'P0002'; end if;
  if s.status <> 'pending' then raise exception 'already reviewed' using errcode = 'P0001'; end if;
  if p_action = 'approve' then
    eid := s.event_id;
    if eid is null then
      eid := publish_event(s.extracted_payload || jsonb_build_object('regionId', s.region_id, 'verified', true));
    else
      update events set verified = true, hidden = false where id = eid;
    end if;
    update submissions set status = 'approved', event_id = eid, moderator_note = p_note,
      reviewed_at = now(), reviewed_by = p_moderator where id = p_id;
  elsif p_action = 'reject' then
    update events set hidden = true where id = s.event_id;
    update submissions set status = 'rejected', moderator_note = p_note, reviewed_at = now(),
      reviewed_by = p_moderator where id = p_id;
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  return jsonb_build_object('id', p_id, 'eventId', eid, 'action', p_action);
end $$;

create function resolve_reports(p_event text, p_action text, p_note text, p_moderator text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  res text := case p_action when 'dismiss' then 'dismissed' when 'cancel' then 'cancelled'
    when 'hide' then 'hidden' end;
begin
  if res is null then raise exception 'unknown action %', p_action using errcode = '22023'; end if;
  if p_action = 'cancel' then update events set status = 'cancelled' where id = p_event; end if;
  if p_action = 'hide' then update events set hidden = true where id = p_event; end if;
  update reports set resolved_at = now(), resolution = res, resolved_by = p_moderator
  where event_id = p_event and resolved_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Supabase grants this already; plain Postgres (local, CI) needs it for the role to see the functions.
grant usage on schema public, extensions to service_role;

revoke all on function rate_limit_hit(text, text, integer, integer), publish_event(jsonb),
  submit_event(jsonb, text, text, boolean), report_event(text, report_reason, text, text),
  is_moderator(text), moderation_queue(), moderate_submission(uuid, text, text, text),
  resolve_reports(text, text, text, text) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, text, integer, integer),
  submit_event(jsonb, text, text, boolean), report_event(text, report_reason, text, text),
  is_moderator(text), moderation_queue(), moderate_submission(uuid, text, text, text),
  resolve_reports(text, text, text, text) to service_role;
