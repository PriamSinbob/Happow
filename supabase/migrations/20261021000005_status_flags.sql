-- Happow: community status flags. Anyone can report that an event is cancelled, its venue is
-- closed, weather stopped it, or it moved; the open reports are summed on the event row so the
-- public map shows a warning within a minute, without exposing the reports table. Moderators
-- confirm (cancel / hide) or dismiss as before, which clears the flag.

alter type report_reason add value if not exists 'venue_closed';
alter type report_reason add value if not exists 'weather';
alter type report_reason add value if not exists 'moved';

-- Open status reports (distinct devices), the most reported status reason, and the latest report.
alter table events
  add column flag_reason text,
  add column flag_count integer not null default 0,
  add column flag_at timestamptz;

-- Reasons that change whether an event is on; the others (wrong_info, inappropriate, other) only
-- go to moderators. Compared as text: new enum values cannot be used in this transaction.
create function refresh_event_flag(p_event text)
returns void
language sql
security definer
set search_path = public
as $$
  with open_status as (
    select reason::text as reason, created_at from reports
    where event_id = p_event and resolved_at is null
      and reason::text in ('cancelled', 'venue_closed', 'weather', 'moved')
  )
  update events set
    flag_count = (select count(*) from open_status),
    flag_at = (select max(created_at) from open_status),
    flag_reason = (select reason from open_status group by reason
                   order by count(*) desc, max(created_at) desc limit 1)
  where id = p_event;
$$;

-- A device can change its report (one open report per device per event); the flag updates at once.
create or replace function report_event(p_event text, p_reason report_reason, p_note text, p_reporter text)
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
  on conflict (event_id, reporter_hash) where resolved_at is null do update
    set reason = excluded.reason, note = coalesce(excluded.note, reports.note), created_at = now();
  perform refresh_event_flag(p_event);
  return true;
end $$;

create or replace function resolve_reports(p_event text, p_action text, p_note text, p_moderator text)
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
  perform refresh_event_flag(p_event);
  return n;
end $$;

revoke all on function refresh_event_flag(text) from public, anon, authenticated;

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
  e.verified, e.flag_reason, e.flag_count, e.flag_at
from events e
left join venues v on v.id = e.venue_id
where (e.stale_after is null or e.stale_after > now()) and not e.hidden;

-- events_near / event_by_id gain the flag columns (return types change, so drop and recreate).
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
  distance_m double precision, verified boolean, flag_reason text, flag_count integer,
  flag_at timestamptz
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
    e.flag_count, e.flag_at
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
  flag_at timestamptz
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
    e.verified, e.flag_reason, e.flag_count, e.flag_at
  from events_public e
  where e.id = event_id;
$$;

grant execute on function events_near(double precision, double precision, double precision, timestamptz, timestamptz, text[], text)
  to anon, authenticated;
grant execute on function event_by_id(text, double precision, double precision) to anon, authenticated;

