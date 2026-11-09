-- Organisers and private events: private events, kept out of every public read; contacts, groups
-- and contact links; invitations by contact, group or single-use link; the friends' view of who's
-- going; organiser claims, organiser posts, edits by owners and organisers; export, deletion and
-- retention for all of it.
-- Everything new is read and written by the API with the service role; row-level security is the
-- backstop for direct PostgREST access.

-- ---------- Private events ----------

alter table events add column visibility text not null default 'public'
  check (visibility in ('public', 'private'));
-- The account that created a private event, or the organiser of a claimed one.
alter table events add column owner_id uuid references auth.users (id) on delete set null;
create index events_owner_idx on events (owner_id) where owner_id is not null;
create index events_private_idx on events (id) where visibility = 'private';
-- Fields an organiser set: they win over the sources while the claim stands.
alter table events add column owner_fields jsonb not null default '{}'::jsonb;
-- What a source said that differs from the organiser's fields, for moderators.
alter table events add column source_disagrees jsonb;
alter table events add column source_disagrees_at timestamptz;
-- When the start, end or status last changed by hand (owner or organiser), and the newest post.
alter table events add column changed_at timestamptz;
alter table events add column last_post_at timestamptz;

-- A private event's place is private too: its venue row is not public.
alter table venues add column private boolean not null default false;

-- Reasons: "unlawful" is new; with "inappropriate" (abuse), the two that reach moderators for a
-- private event.
alter type report_reason add value if not exists 'unlawful';
-- Who a report is for: moderators (every public report, abuse on a private one) or only the
-- event's organiser. The organiser can answer either; that never blocks their edits.
alter table reports add column audience text not null default 'moderators'
  check (audience in ('moderators', 'organiser'));
alter table reports add column organiser_note text check (char_length(organiser_note) <= 500);
alter table reports add column organiser_at timestamptz;
alter table reports add column reporter_user uuid references auth.users (id) on delete set null;

-- The public view gains "public only": every public reader (map snapshot, events_near,
-- event_by_id, events_by_ids, density_near, hotspots, share previews) reads it.
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
where (e.stale_after is null or e.stale_after > now()) and not e.hidden
  and e.visibility = 'public';

-- ---------- Contacts and groups ----------

alter table profiles add column friends_visible boolean not null default false;

-- One row per direction: a contact is mutual when both rows exist and neither is blocked.
create table contacts (
  owner uuid not null references auth.users (id) on delete cascade,
  contact uuid not null references auth.users (id) on delete cascade,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner, contact),
  check (owner <> contact)
);
create index contacts_contact_idx on contacts (contact);
alter table contacts enable row level security;
create policy "own rows" on contacts for select to authenticated using (owner = auth.uid());

create table contact_groups (
  id bigint generated always as identity primary key,
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (owner, name)
);
alter table contact_groups enable row level security;
create policy "own rows" on contact_groups for select to authenticated using (owner = auth.uid());

create table contact_group_members (
  group_id bigint not null references contact_groups (id) on delete cascade,
  contact uuid not null references auth.users (id) on delete cascade,
  primary key (group_id, contact)
);
alter table contact_group_members enable row level security;
create policy "own rows" on contact_group_members for select to authenticated
  using (exists (select 1 from contact_groups g where g.id = group_id and g.owner = auth.uid()));

-- "Add me as a contact" (/c/<token>); a new link retires the old one.
create table contact_links (
  token text primary key check (char_length(token) between 16 and 64),
  owner uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index contact_links_live_idx on contact_links (owner) where retired_at is null;
alter table contact_links enable row level security;
create policy "own rows" on contact_links for select to authenticated using (owner = auth.uid());

-- ---------- Invitations ----------

create table invitations (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references events (id) on delete cascade,
  inviter uuid not null references auth.users (id) on delete cascade,
  -- Set for a contact or group invitation, and once a link invitation is accepted.
  invitee uuid references auth.users (id) on delete cascade,
  -- A single-use link (/e/<id>?i=<token>); the organiser's label says who it was for.
  token text unique check (token is null or char_length(token) between 16 and 64),
  label text check (char_length(label) <= 40),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  -- When the invitee last opened the event, for the "changed" dot.
  seen_at timestamptz,
  check (invitee is not null or token is not null)
);
create unique index invitations_person_idx on invitations (event_id, invitee) where invitee is not null;
create index invitations_invitee_idx on invitations (invitee) where invitee is not null;
alter table invitations enable row level security;
create policy "own rows" on invitations for select to authenticated
  using (invitee = auth.uid() or inviter = auth.uid());

-- Visible to: everyone if public; the owner and invitees (pending or accepted) if private.
create function event_visible_to(p_event text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from events e
    where e.id = p_event and (
      e.visibility = 'public'
      or (p_user is not null and (
        e.owner_id = p_user
        or exists (select 1 from invitations i where i.event_id = e.id and i.invitee = p_user
          and i.status in ('pending', 'accepted'))))))
$$;

-- Row-level security on events and their listings: public rows for everyone, private ones for
-- their owner and invitees. The views use security_invoker, so they inherit this.
drop policy "public read" on events;
create policy "public or invited" on events for select to anon, authenticated
  using (visibility = 'public' or event_visible_to(id, auth.uid()));
drop policy "public read" on event_sources;
create policy "public or invited" on event_sources for select to anon, authenticated
  using (event_visible_to(event_id, auth.uid()));
drop policy "public read" on venues;
create policy "public read" on venues for select to anon, authenticated using (not private);

-- Dedup and rewards never pair a private event with a public one.
create or replace function duplicate_candidates(p_event text, p_radius_m double precision, p_minutes integer)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('title', e.title, 'others',
    coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title)) filter (where o.id is not null), '[]'::jsonb))
  from events e
  left join events o on o.id <> e.id and not o.hidden and o.status <> 'cancelled'
    and o.visibility = 'public' and e.visibility = 'public'
    and abs(extract(epoch from o.start_at - e.start_at)) <= p_minutes * 60
    and st_dwithin(o.point, e.point, p_radius_m)
    -- Older listings only: a later copy can't make the first one a duplicate.
    and o.created_at <= e.created_at
  where e.id = p_event
  group by e.id, e.title
$$;

create or replace function counts_add(p_items jsonb, p_day date)
returns integer
language sql
security definer
set search_path = public
as $$
  with items as (
    select i ->> 'eventId' as event_id,
      sum(greatest(coalesce((i ->> 'opens')::int, 0), 0)) as opens,
      sum(greatest(coalesce((i ->> 'routes')::int, 0), 0)) as routes,
      sum(greatest(coalesce((i ->> 'arrivals')::int, 0), 0)) as arrivals
    from jsonb_array_elements(p_items) i group by 1
  ), added as (
    insert into event_counts as c (event_id, day, opens, routes, arrivals)
    select i.event_id, p_day, i.opens, i.routes, i.arrivals
    from items i join events e on e.id = i.event_id and e.visibility = 'public'
    on conflict (event_id, day) do update set opens = c.opens + excluded.opens,
      routes = c.routes + excluded.routes, arrivals = c.arrivals + excluded.arrivals
    returning 1
  )
  select count(*)::int from added
$$;

create or replace function thanks_add(p_event text, p_device text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from events where id = p_event and trust = 'community'
    and visibility = 'public') then
    raise exception 'unknown event' using errcode = 'P0002';
  end if;
  insert into event_thanks (event_id, device) values (p_event, p_device) on conflict do nothing;
  return found;
end $$;

-- Counts and analytics: public events only.
create or replace function events_area(
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
    and not e.hidden and e.visibility = 'public'
    and (e.stale_after is null or e.stale_after > now())
  order by extensions.st_distance(e.point, here.g), e.start_at
  limit least(greatest(max_events, 1), 5000);
$$;

create or replace function m12_metrics(p_region text, p_at timestamptz, p_evening_hour integer default 18)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  tz text := (select timezone from regions where id = p_region);
  d date;
  t0 timestamptz;
  t1 timestamptz;
  t8 timestamptz;
  eve timestamptz;
begin
  if tz is null then
    raise exception 'unknown region %', p_region;
  end if;
  d := (p_at at time zone tz)::date;
  t0 := d::timestamp at time zone tz;
  t1 := (d + 1)::timestamp at time zone tz;
  t8 := (d + 8)::timestamp at time zone tz;
  eve := (d::timestamp + make_interval(hours => p_evening_hour)) at time zone tz;

  return (
  with w as (
    select e.id, e.trust, e.category_ids from events e
    where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.visibility = 'public' and e.created_at <= p_at and e.start_at < t8 and e.end_at > p_at
  ), k as (select count(*) n, count(*) filter (where trust = 'community') c from w)
  select jsonb_build_object(
    'region', p_region,
    'at', p_at,
    'eventsToday', (
      select count(*) from events e
      where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.visibility = 'public' and e.created_at <= p_at and e.start_at < t1 and e.end_at > t0),
    'events7d', k.n,
    'districts', (select count(*) from districts where region_id = p_region),
    'districtsTonight', (
      select count(distinct ds.id) from districts ds
      join events e on e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.visibility = 'public' and e.created_at <= p_at
        and e.start_at < t1 and e.end_at > eve and st_covers(ds.polygon, e.point::geometry)
      where ds.region_id = p_region),
    'eventsTonight', (
      select count(*) from events e
      where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.visibility = 'public' and e.created_at <= p_at and e.start_at < t1 and e.end_at > eve),
    'community7d', k.c,
    'communityShare', case when k.n = 0 then 0 else round(k.c::numeric / k.n, 4) end,
    'accountsAdded7d', (
      select count(distinct s.user_id) from submissions s
      where s.kind = 'user' and s.user_id is not null
        and s.created_at > p_at - interval '7 days' and s.created_at <= p_at
        and coalesce(s.region_id, p_region) = p_region),
    'accountsAddedTotal', (
      select count(distinct s.user_id) from submissions s
      where s.kind = 'user' and s.user_id is not null and s.created_at <= p_at
        and coalesce(s.region_id, p_region) = p_region),
    'bySource7d', coalesce((
      select jsonb_object_agg(source_id, n) from (
        select es.source_id, count(distinct w.id) n
        from w join event_sources es on es.event_id = w.id
        group by es.source_id) x), '{}'::jsonb),
    'byCategory7d', coalesce((
      select jsonb_object_agg(c, n) from (
        select c, count(*) n from w, unnest(category_ids) c group by c) x), '{}'::jsonb)
  ) from k);
end $$;

create or replace function coverage(p_region text, p_at timestamptz, p_evening_hour integer default 18,
  p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  tz text := (select timezone from regions where id = p_region);
  d date;
  t0 timestamptz;
  t1 timestamptz;
  t8 timestamptz;
begin
  if tz is null then
    raise exception 'unknown region %', p_region using errcode = 'P0002';
  end if;
  d := (p_at at time zone tz)::date;
  t0 := d::timestamp at time zone tz;
  t1 := (d + 1)::timestamp at time zone tz;
  t8 := (d + 8)::timestamp at time zone tz;

  return (
  with live as (
    select e.id, e.point, e.category_ids, e.start_at < t1 and e.end_at > t0 as today
    from events e
    where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.visibility = 'public'
      and e.start_at < t8 and e.end_at > p_at
  ), per as (
    select ds.id, ds.name, c.cat, count(*) filter (where l.today) as today, count(*) as week
    from districts ds
    join live l on st_covers(ds.polygon, l.point::geometry)
    cross join lateral unnest(l.category_ids) as c(cat)
    where ds.region_id = p_region
    group by ds.id, ds.name, c.cat
  ), totals as (
    select ds.id, ds.name,
      (select count(*) from live l where l.today and st_covers(ds.polygon, l.point::geometry)) as today,
      (select count(*) from live l where st_covers(ds.polygon, l.point::geometry)) as week
    from districts ds where ds.region_id = p_region
  )
  select jsonb_build_object(
    'region', p_region,
    'at', p_at,
    'now', m12_metrics(p_region, p_at, p_evening_hour),
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'today', t.today, 'week', t.week,
          'byCategory', coalesce((
            select jsonb_object_agg(p.cat, jsonb_build_object('today', p.today, 'week', p.week))
            from per p where p.id = t.id), '{}'::jsonb))
        order by t.week, t.today, t.name)
      from totals t), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', w.week, 'metrics', w.metrics) order by w.week)
      from (select * from metrics_weekly where region_id = p_region
        order by week desc limit p_weeks) w), '[]'::jsonb)
  ));
end $$;

create or replace function district_goal(p_region text, p_lat double precision, p_lng double precision,
  p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('id', d.id, 'name', d.name, 'count', (
      select count(*) from events e
      where e.region_id = p_region and not e.hidden and e.visibility = 'public' and e.status <> 'cancelled'
        and e.start_at < p_to and e.end_at > p_from
        and st_covers(d.polygon, e.point::geometry)))
  from districts d
  where d.region_id = p_region and st_covers(d.polygon, st_setsrid(st_point(p_lng, p_lat), 4326))
  limit 1
$$;

create or replace function first_place_mark(p_submission uuid, p_radius_m double precision, p_quiet_days integer)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s submissions;
  v_point geography;
  v_first boolean;
begin
  select * into s from submissions where id = p_submission;
  if not found or s.extracted_payload -> 'event' -> 'point' is null then return false; end if;
  v_point := st_point((s.extracted_payload -> 'event' -> 'point' ->> 'lng')::float8,
    (s.extracted_payload -> 'event' -> 'point' ->> 'lat')::float8)::geography;
  v_first := not exists (
    select 1 from events e
    where st_dwithin(e.point, v_point, p_radius_m)
      and not e.hidden and e.visibility = 'public' and e.status <> 'cancelled'
      and e.end_at > now() - make_interval(days => p_quiet_days)
      and e.id is distinct from s.event_id
      and not exists (select 1 from submissions x
        where s.series_id is not null and x.series_id = s.series_id and x.event_id = e.id));
  update submissions set first_place = v_first where id = p_submission;
  return v_first;
end $$;

-- One event as the app's row (the columns of event_by_id), for the private readers.
create function event_row_json(p_event text, p_lat double precision, p_lng double precision)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description, 'category_ids', e.category_ids,
    'start_at', e.start_at, 'end_at', e.end_at, 'end_estimated', e.end_estimated,
    'timezone', e.timezone, 'venue_id', e.venue_id, 'venue_name', v.name,
    'venue_address', v.address, 'venue_website', v.website,
    'lat', st_y(e.point::geometry), 'lng', st_x(e.point::geometry), 'h3_r9', e.h3_r9,
    'price_min', e.price_min, 'price_max', e.price_max, 'currency', e.currency::text,
    'is_free', e.is_free, 'rules', e.rules, 'official_url', e.official_url,
    'ticket_url', e.ticket_url, 'image_url', e.image_url, 'status', e.status, 'trust', e.trust,
    'confidence', e.confidence, 'last_seen_at', e.last_seen_at,
    'primary_source_id', e.primary_source_id, 'source_url', null,
    'distance_m', case when p_lat is null or p_lng is null then null
      else st_distance(e.point, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) end,
    'verified', e.verified, 'flag_reason', e.flag_reason, 'flag_count', e.flag_count,
    'flag_at', e.flag_at, 'entry', e.entry, 'grace_min', e.grace_min, 'age_min', e.age_min,
    'family', e.family, 'visibility', e.visibility, 'changed_at', e.changed_at,
    'last_post_at', e.last_post_at)
  from events e left join venues v on v.id = e.venue_id
  where e.id = p_event
$$;

-- The private events an account owns or is invited to (pending or accepted), with its side:
-- `mine` for the owner, or the invitation; and who invited them.
create function private_events_for(p_user uuid, p_lat double precision default null,
  p_lng double precision default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(event_row_json(e.id, p_lat, p_lng) || jsonb_build_object(
      'mine', e.owner_id = p_user,
      'owner_name', (select p.display_name from profiles p where p.user_id = e.owner_id),
      'invitation', (
        select jsonb_build_object('id', i.id, 'status', i.status, 'seenAt', i.seen_at)
        from invitations i where i.event_id = e.id and i.invitee = p_user
          and i.status in ('pending', 'accepted'))
    ) order by e.start_at), '[]'::jsonb)
  from events e
  where e.visibility = 'private' and not e.hidden
    and (e.owner_id = p_user or exists (
      select 1 from invitations i where i.event_id = e.id and i.invitee = p_user
        and i.status in ('pending', 'accepted')))
$$;

-- One private event for someone who may see it, or holds a live link invitation to it; null
-- otherwise (the app then says "Private event").
create function private_event_get(p_user uuid, p_event text, p_token text,
  p_lat double precision default null, p_lng double precision default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select event_row_json(e.id, p_lat, p_lng) || jsonb_build_object(
      'mine', e.owner_id is not distinct from p_user and p_user is not null,
      'owner_name', (select p.display_name from profiles p where p.user_id = e.owner_id),
      'invitation', (
        select jsonb_build_object('id', i.id, 'status', i.status, 'seenAt', i.seen_at)
        from invitations i where i.event_id = e.id and i.invitee = p_user
          and i.status in ('pending', 'accepted', 'declined')),
      'link', p_token is not null and exists (
        select 1 from invitations i where i.event_id = e.id and i.token = p_token
          and i.invitee is null and i.status = 'pending'))
  from events e
  where e.id = p_event and e.visibility = 'private' and not e.hidden
    and (
      (p_user is not null and (e.owner_id = p_user or exists (
        select 1 from invitations i where i.event_id = e.id and i.invitee = p_user
          and i.status in ('pending', 'accepted', 'declined'))))
      or (p_token is not null and exists (
        select 1 from invitations i where i.event_id = e.id and i.token = p_token
          and i.status = 'pending' and i.invitee is null)))
$$;

-- What a link may say about an id: public, private, or unknown (null). For the Worker's tags.
create function event_visibility(p_event text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select visibility from events where id = p_event
$$;

-- Usage gains private events (free accounts: private.perMonth).
alter table account_usage add column private_events integer not null default 0;

create or replace function usage_take(p_user uuid, p_month date, p_kind text, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  e integer := (p_kind = 'events')::integer;
  a integer := (p_kind = 'autofills')::integer;
  pr integer := (p_kind = 'private')::integer;
  ok boolean;
begin
  if p_kind not in ('events', 'autofills', 'private') then
    raise exception 'unknown usage kind %', p_kind;
  end if;
  if p_max <= 0 then
    return false;
  end if;
  insert into account_usage as u (user_id, month, events, autofills, private_events)
  values (p_user, p_month, e, a, pr)
  on conflict (user_id, month) do update
    set events = u.events + e, autofills = u.autofills + a, private_events = u.private_events + pr
    where (case when e = 1 then u.events when a = 1 then u.autofills else u.private_events end)
      < p_max
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function usage_get(p_user uuid, p_month date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'events', coalesce((select events from account_usage where user_id = p_user and month = p_month), 0),
    'autofills', coalesce((select autofills from account_usage where user_id = p_user and month = p_month), 0),
    'private', coalesce((select private_events from account_usage where user_id = p_user and month = p_month), 0))
$$;

-- A private event: counted against both quotas in one statement, stored approved by 'private'
-- (no moderation), published verified, private, owned. No rewards follow.
create function submit_private(
  p jsonb, p_submitter text, p_region text, p_user uuid, p_month date, p_max integer,
  p_private_max integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid := (p ->> 'id')::uuid;
  eid text;
begin
  if not usage_take(p_user, p_month, 'private', p_private_max) then
    raise exception 'private quota used up' using errcode = 'HQ002';
  end if;
  if not usage_take(p_user, p_month, 'events', p_max) then
    raise exception 'events quota used up' using errcode = 'HQ001';
  end if;
  insert into submissions (id, kind, url, form_payload, extracted_payload, status, submitter_hash,
    region_id, source_id, external_id, confidence, user_id, reviewed_at, reviewed_by)
  values (sid, 'user', p -> 'form' ->> 'url', p -> 'form', p -> 'normalized', 'approved',
    p_submitter, p_region, p -> 'normalized' ->> 'sourceId', sid::text, 1, p_user, now(), 'private');
  eid := publish_event((p -> 'normalized') || jsonb_build_object('regionId', p_region, 'verified', true));
  update events set visibility = 'private', owner_id = p_user, density_cell = null where id = eid;
  update venues set private = true where id = (select venue_id from events where id = eid);
  update submissions set event_id = eid where id = sid;
  return eid;
end $$;

-- ---------- Contacts ----------

create function contact_mutual(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from contacts where owner = p_a and contact = p_b and not blocked)
    and exists (select 1 from contacts where owner = p_b and contact = p_a and not blocked)
$$;

-- Connects two accounts both ways, unless either blocked the other. True if connected.
create function contact_connect(p_a uuid, p_b uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_a = p_b then return false; end if;
  if exists (select 1 from contacts where ((owner = p_a and contact = p_b)
      or (owner = p_b and contact = p_a)) and blocked) then
    return false;
  end if;
  insert into contacts (owner, contact) values (p_a, p_b), (p_b, p_a) on conflict do nothing;
  return true;
end $$;

create function contacts_list(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.contact, 'name', p.display_name,
          'blocked', c.blocked, 'mutual', contact_mutual(p_user, c.contact),
          'since', c.created_at,
          'groups', coalesce((select jsonb_agg(m.group_id order by m.group_id)
            from contact_group_members m join contact_groups g on g.id = m.group_id
            where g.owner = p_user and m.contact = c.contact), '[]'::jsonb))
        order by c.blocked, lower(coalesce(p.display_name, '')))
      from contacts c left join profiles p on p.user_id = c.contact
      where c.owner = p_user), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
          'members', (select count(*) from contact_group_members m where m.group_id = g.id))
        order by lower(g.name))
      from contact_groups g where g.owner = p_user), '[]'::jsonb),
    'link', (select token from contact_links where owner = p_user and retired_at is null))
$$;

-- A new contact link; the old one stops working.
create function contact_link_new(p_user uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update contact_links set retired_at = now() where owner = p_user and retired_at is null;
  insert into contact_links (token, owner) values (p_token, p_user);
  return p_token;
end $$;

-- Opening someone's contact link: their name, or null for a retired or unknown link.
create function contact_link_owner(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', l.owner, 'name', p.display_name)
  from contact_links l left join profiles p on p.user_id = l.owner
  where l.token = p_token and l.retired_at is null
$$;

create function contact_link_accept(p_user uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner into v_owner from contact_links where token = p_token and retired_at is null;
  if v_owner is null then raise exception 'unknown link' using errcode = 'P0002'; end if;
  if v_owner = p_user then raise exception 'own link' using errcode = 'HQ010'; end if;
  if not contact_connect(v_owner, p_user) then
    raise exception 'blocked' using errcode = 'HQ011';
  end if;
  return jsonb_build_object('id', v_owner,
    'name', (select display_name from profiles where user_id = v_owner));
end $$;

-- Remove: your side only (and from your groups). Block: kept as blocked, so they can't add you
-- again or invite you. Unblock: back to a one-sided contact.
create function contact_change(p_user uuid, p_contact uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_action not in ('remove', 'block', 'unblock') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  delete from contact_group_members m using contact_groups g
  where g.id = m.group_id and g.owner = p_user and m.contact = p_contact
    and p_action <> 'unblock';
  if p_action = 'remove' then
    delete from contacts where owner = p_user and contact = p_contact;
  elsif p_action = 'block' then
    insert into contacts (owner, contact, blocked) values (p_user, p_contact, true)
    on conflict (owner, contact) do update set blocked = true;
  else
    update contacts set blocked = false where owner = p_user and contact = p_contact;
  end if;
  return found;
end $$;

-- Groups: create, rename, delete, and set the members (your unblocked contacts only).
create function group_save(p_user uuid, p_id bigint, p_name text, p_members uuid[], p_max integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  gid bigint := p_id;
begin
  if gid is null then
    if (select count(*) from contact_groups where owner = p_user) >= p_max then
      raise exception 'too many groups' using errcode = 'HQ012';
    end if;
    insert into contact_groups (owner, name) values (p_user, btrim(p_name)) returning id into gid;
  else
    update contact_groups set name = coalesce(btrim(p_name), name)
    where id = gid and owner = p_user;
    if not found then raise exception 'unknown group' using errcode = 'P0002'; end if;
  end if;
  if p_members is not null then
    delete from contact_group_members where group_id = gid;
    insert into contact_group_members (group_id, contact)
    select gid, c.contact from contacts c
    where c.owner = p_user and not c.blocked and c.contact = any (p_members);
  end if;
  return gid;
end $$;

create function group_delete(p_user uuid, p_id bigint)
returns boolean
language sql
security definer
set search_path = public
as $$
  with d as (delete from contact_groups where id = p_id and owner = p_user returning 1)
  select exists (select 1 from d)
$$;

-- ---------- Invitations ----------

-- Invites people (contacts, or the members of groups) to a private event you own. People who
-- aren't your contacts, or who blocked you, are skipped. Returns how many were invited now.
create function invite_people(p_user uuid, p_event text, p_people uuid[], p_groups bigint[],
  p_max integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not exists (select 1 from events where id = p_event and owner_id = p_user
    and visibility = 'private') then
    raise exception 'not your event' using errcode = 'P0002';
  end if;
  with wanted as (
    select unnest(coalesce(p_people, '{}')) as person
    union
    select m.contact from contact_group_members m join contact_groups g on g.id = m.group_id
    where g.owner = p_user and g.id = any (coalesce(p_groups, '{}'))
  ), ok as (
    select w.person from wanted w
    join contacts c on c.owner = p_user and c.contact = w.person and not c.blocked
    where not exists (select 1 from contacts b where b.owner = w.person and b.contact = p_user
      and b.blocked)
  ), added as (
    insert into invitations as i (event_id, inviter, invitee)
    select p_event, p_user, person from ok
    on conflict (event_id, invitee) where invitee is not null do update
      set status = 'pending', answered_at = null
      where i.status = 'revoked'
    returning 1
  )
  select count(*) into n from added;
  if (select count(*) from invitations where event_id = p_event and status <> 'revoked') > p_max then
    raise exception 'too many invitations' using errcode = 'HQ013';
  end if;
  return n;
end $$;

-- A single-use invite link for an event you own.
create function invite_link(p_user uuid, p_event text, p_token text, p_label text, p_max integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  iid uuid;
begin
  if not exists (select 1 from events where id = p_event and owner_id = p_user
    and visibility = 'private') then
    raise exception 'not your event' using errcode = 'P0002';
  end if;
  if (select count(*) from invitations where event_id = p_event and status <> 'revoked') >= p_max then
    raise exception 'too many invitations' using errcode = 'HQ013';
  end if;
  insert into invitations (event_id, inviter, token, label)
  values (p_event, p_user, p_token, nullif(btrim(p_label), '')) returning id into iid;
  return iid;
end $$;

-- Accept or decline your invitation; accepting connects you with the organiser.
create function invitation_answer(p_user uuid, p_event text, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  i invitations;
begin
  select * into i from invitations where event_id = p_event and invitee = p_user
    and status in ('pending', 'accepted', 'declined') for update;
  if not found then raise exception 'no invitation' using errcode = 'P0002'; end if;
  update invitations set status = case when p_accept then 'accepted' else 'declined' end,
    answered_at = now(), seen_at = now() where id = i.id;
  if p_accept then perform contact_connect(i.inviter, p_user); end if;
  return case when p_accept then 'accepted' else 'declined' end;
end $$;

-- Accepting through a link: the first account takes it. Someone already invited keeps their own
-- invitation (and the link stays unused); the owner can't take their own link.
create function invitation_accept_link(p_user uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  i invitations;
begin
  select * into i from invitations where token = p_token for update;
  if not found or i.status <> 'pending' or i.invitee is not null
    or exists (select 1 from events e where e.id = i.event_id and e.end_at < now()) then
    raise exception 'link used or gone' using errcode = 'P0002';
  end if;
  if exists (select 1 from events where id = i.event_id and owner_id = p_user) then
    raise exception 'own event' using errcode = 'HQ010';
  end if;
  if exists (select 1 from contacts b where b.owner = p_user and b.contact = i.inviter and b.blocked)
    or exists (select 1 from contacts b where b.owner = i.inviter and b.contact = p_user and b.blocked) then
    raise exception 'blocked' using errcode = 'HQ011';
  end if;
  if exists (select 1 from invitations x where x.event_id = i.event_id and x.invitee = p_user) then
    update invitations set status = 'accepted', answered_at = now(), seen_at = now()
    where event_id = i.event_id and invitee = p_user and status <> 'revoked';
    if not found then raise exception 'revoked' using errcode = 'P0002'; end if;
  else
    update invitations set invitee = p_user, status = 'accepted', answered_at = now(),
      seen_at = now() where id = i.id;
  end if;
  perform contact_connect(i.inviter, p_user);
  return i.event_id;
end $$;

-- Revoke one invitation (the organiser), pending or accepted: the event leaves that person's app.
create function invitation_revoke(p_user uuid, p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with r as (
    update invitations i set status = 'revoked', answered_at = now()
    from events e
    where i.id = p_id and e.id = i.event_id and e.owner_id = p_user and i.status <> 'revoked'
    returning 1)
  select exists (select 1 from r)
$$;

-- The organiser's view: every invitation by person or link. For accepted guests, the list of
-- who else accepted (an invitation implies it).
create function event_guests(p_user uuid, p_event text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select owner_id from events where id = p_event and visibility = 'private');
begin
  if v_owner is null then raise exception 'unknown event' using errcode = 'P0002'; end if;
  if v_owner = p_user then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'label', i.label,
          'person', i.invitee, 'name', p.display_name, 'link', i.token is not null,
          'token', case when i.invitee is null and i.status = 'pending' then i.token end,
          'createdAt', i.created_at, 'answeredAt', i.answered_at)
        order by i.status, lower(coalesce(p.display_name, i.label, '')), i.created_at)
      from invitations i left join profiles p on p.user_id = i.invitee
      where i.event_id = p_event), '[]'::jsonb);
  end if;
  if not exists (select 1 from invitations where event_id = p_event and invitee = p_user
    and status = 'accepted') then
    raise exception 'not a guest' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('status', 'accepted', 'person', i.invitee,
        'name', p.display_name) order by lower(coalesce(p.display_name, '')))
    from invitations i left join profiles p on p.user_id = i.invitee
    where i.event_id = p_event and i.status = 'accepted'), '[]'::jsonb);
end $$;

create function invitation_seen(p_user uuid, p_event text)
returns void
language sql
security definer
set search_path = public
as $$
  update invitations set seen_at = now() where event_id = p_event and invitee = p_user
$$;

-- ---------- The friends' view ----------

-- Per event, "show my friends I'm going to this" overrides the account switch either way.
create table friend_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null references events (id) on delete cascade,
  show boolean not null,
  primary key (user_id, event_id)
);
alter table friend_overrides enable row level security;
create policy "own rows" on friend_overrides for select to authenticated using (user_id = auth.uid());

create function friends_shown(p_user uuid, p_event text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select show from friend_overrides where user_id = p_user and event_id = p_event),
    (select friends_visible from profiles where user_id = p_user),
    false)
$$;

-- Friends who are going, on the way or here, by name: mutual contacts who show themselves on
-- this event, to someone who shows themselves too. No threshold. Plus the names behind
-- this device's share links, under the same rules.
create function friends_on_event(p_user uuid, p_event text, p_device text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select friends_shown(p_user, p_event) as shown),
  friends as (
    select a.user_id, array_agg(distinct a.kind order by a.kind) as kinds
    from attendance a, me
    where me.shown and a.event_id = p_event and a.expires_at > now() and a.user_id is not null
      and a.user_id <> p_user and a.kind in ('going', 'onway', 'here')
      and contact_mutual(p_user, a.user_id) and friends_shown(a.user_id, p_event)
    group by a.user_id
  ), links as (
    select distinct a.user_id from attendance a
    join share_links s on s.token = a.share_token and s.event_id = a.event_id
    , me
    where me.shown and a.event_id = p_event and a.kind = 'going' and a.expires_at > now()
      and s.device = p_device and a.user_id is not null and a.user_id <> p_user
      and contact_mutual(p_user, a.user_id) and friends_shown(a.user_id, p_event)
  )
  select jsonb_build_object(
    'shown', (select shown from me),
    'override', (select show from friend_overrides where user_id = p_user and event_id = p_event),
    'friends', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name,
        'kinds', to_jsonb(f.kinds)) order by lower(coalesce(p.display_name, '')))
      from friends f join profiles p on p.user_id = f.user_id
      where p.display_name is not null), '[]'::jsonb),
    'fromMyLinks', coalesce((select jsonb_agg(p.display_name order by lower(p.display_name))
      from links l join profiles p on p.user_id = l.user_id
      where p.display_name is not null), '[]'::jsonb))
$$;

create function friend_override_set(p_user uuid, p_event text, p_show boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_show is null then
    delete from friend_overrides where user_id = p_user and event_id = p_event;
  else
    insert into friend_overrides (user_id, event_id, show) values (p_user, p_event, p_show)
    on conflict (user_id, event_id) do update set show = excluded.show;
  end if;
end $$;

-- Attendance on a private event: only its owner and invitees mark themselves (and only with an
-- account); the API never shows public counts for it. Public events as before.
create or replace function attendance_set(
  p_event text,
  p_device text,
  p_user uuid,
  p_kind text,
  p_on boolean,
  p_token text,
  p_keep_hours integer,
  p_until timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_end timestamptz;
begin
  delete from attendance where expires_at < now();
  select e.end_at into v_end from events e
  where e.id = p_event and not e.hidden and (e.stale_after is null or e.stale_after > now())
    and (e.visibility = 'public' or (p_user is not null and event_visible_to(e.id, p_user)));
  if v_end is null or v_end < now() then return null; end if;
  if p_on then
    insert into attendance as a (event_id, device, user_id, kind, share_token, expires_at)
    values (
      p_event, p_device, p_user, p_kind,
      (select s.token from share_links s
        where s.token = p_token and s.event_id = p_event and s.device <> p_device),
      least(v_end + make_interval(hours => p_keep_hours), coalesce(p_until, 'infinity'))
    )
    on conflict (event_id, device, kind) do update set
      at = now(),
      expires_at = excluded.expires_at,
      user_id = coalesce(excluded.user_id, a.user_id),
      share_token = coalesce(a.share_token, excluded.share_token);
  else
    delete from attendance where event_id = p_event and device = p_device and kind = p_kind;
  end if;
  return attendance_get(p_event, p_device);
end;
$$;

create or replace function attendance_get(p_event text, p_device text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'categories', (select to_jsonb(e.category_ids) from events e where e.id = p_event),
    'private', (select e.visibility = 'private' from events e where e.id = p_event),
    'counts', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from attendance
            where event_id = p_event and expires_at > now() group by kind) c),
    'mine', (
      select coalesce(jsonb_agg(kind order by kind), '[]'::jsonb) from attendance
      where event_id = p_event and device = p_device and expires_at > now()),
    'fromMyLinks', (
      select count(*) from attendance a
      join share_links s on s.token = a.share_token and s.event_id = a.event_id
      where a.event_id = p_event and a.kind = 'going' and a.expires_at > now()
        and s.device = p_device)
  )
$$;

-- Reminders on a private event: for someone who may see it. The notification carries the title,
-- so a reminder set on a guessed id must never send it.
create or replace function reminder_set(
  p_device text, p_user uuid, p_event text, p_lead text, p_max integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
begin
  -- With an account, one reminder per event across its devices: it reaches all of them.
  if p_lead is null then
    delete from reminders
    where event_id = p_event
      and (device_hash = p_device or (p_user is not null and user_id = p_user));
    return true;
  end if;
  select e.start_at into v_start from events e
  where e.id = p_event and not e.hidden and (e.stale_after is null or e.stale_after > now())
    and (e.visibility = 'public' or (p_user is not null and event_visible_to(e.id, p_user)));
  if v_start is null or v_start <= now() then return false; end if;
  if not exists (
    select 1 from reminders where device_hash = p_device and event_id = p_event
  ) and (
    select count(*) from reminders where device_hash = p_device and sent_at is null
  ) >= p_max then
    return false;
  end if;
  if p_user is not null then
    delete from reminders
    where user_id = p_user and event_id = p_event and device_hash <> p_device;
  end if;
  insert into reminders (device_hash, user_id, event_id, lead, start_at)
  values (p_device, p_user, p_event, p_lead, v_start)
  on conflict (device_hash, event_id) do update
    set lead = excluded.lead, start_at = excluded.start_at, user_id = excluded.user_id,
      sent_at = null;
  return true;
end $$;

create or replace function reminders_due(p_until timestamptz, p_day_before time, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  delete from reminders r
  where r.sent_at is not null and r.sent_at < now() - interval '2 days'
     or not exists (select 1 from events e where e.id = r.event_id and e.end_at > now());

  with due as (
    select r.id, r.device_hash, r.user_id, r.lead, r.start_at as set_start, e.id as event_id,
      e.title, v.name as venue_name, e.start_at, e.timezone, e.status::text as status,
      -- A private event no longer visible to the reminder's account (revoked) is sent as hidden:
      -- nothing goes, and the reminder is done.
      e.hidden or (e.visibility = 'private' and not event_visible_to(e.id, r.user_id)) as hidden
    from reminders r
    join events e on e.id = r.event_id
    left join venues v on v.id = e.venue_id
    where r.sent_at is null
      and reminder_fire_at(e.start_at, e.timezone, r.lead, p_day_before) <= p_until
    order by e.start_at
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'eventId', d.event_id, 'title', d.title, 'venue', d.venue_name,
    'startAt', d.start_at, 'setStartAt', d.set_start, 'timezone', d.timezone,
    'status', d.status, 'hidden', d.hidden,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang
      )), '[]'::jsonb)
      from push_subscriptions s
      where s.device_hash = d.device_hash or (d.user_id is not null and s.user_id = d.user_id)
    )
  )), '[]'::jsonb) into v
  from due d;
  return v;
end $$;

-- ---------- Organiser claims ----------

create table claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('event', 'venue')),
  event_id text references events (id) on delete cascade,
  venue_id text references venues (id) on delete cascade,
  organiser_name text not null check (char_length(btrim(organiser_name)) between 2 and 80),
  method text not null check (method in ('site', 'moderator')),
  -- The code to put on the site (method site), and the page checked.
  code text not null,
  page_url text,
  evidence text check (char_length(evidence) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revoked')),
  note text check (char_length(note) <= 500),
  reviewed_by text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  checked_at timestamptz,
  check ((kind = 'event') = (event_id is not null) and (kind = 'venue') = (venue_id is not null))
);
create unique index claims_event_once_idx on claims (event_id) where status = 'approved' and kind = 'event';
create unique index claims_venue_once_idx on claims (venue_id) where status = 'approved' and kind = 'venue';
create unique index claims_open_idx on claims (user_id, coalesce(event_id, venue_id))
  where status = 'pending';
alter table claims enable row level security;
create policy "own rows" on claims for select to authenticated using (user_id = auth.uid());

-- Venues are per source; an OSM-linked venue matches every venue row with the same OSM id.
create function venue_matches(p_claimed text, p_venue text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_claimed = p_venue or exists (
    select 1 from venues a join venues b on a.osm_id = b.osm_id
    where a.id = p_claimed and b.id = p_venue and a.osm_id is not null)
$$;

-- The verified organiser of an event: an approved event claim, else an approved claim on its
-- venue. Private events: their owner.
create function event_organiser(p_event text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('user', c.user_id, 'name', c.organiser_name, 'kind', 'event')
     from claims c where c.event_id = p_event and c.kind = 'event' and c.status = 'approved'),
    (select jsonb_build_object('user', c.user_id, 'name', c.organiser_name, 'kind', 'venue')
     from events e join claims c on c.kind = 'venue' and c.status = 'approved'
       and venue_matches(c.venue_id, e.venue_id)
     where e.id = p_event and e.venue_id is not null
     order by c.decided_at limit 1),
    (select jsonb_build_object('user', e.owner_id, 'name', p.display_name, 'kind', 'private')
     from events e left join profiles p on p.user_id = e.owner_id
     where e.id = p_event and e.visibility = 'private' and e.owner_id is not null))
$$;

-- A new claim, or the user's open one for the same target (its code is kept).
create function claim_open(p_user uuid, p_kind text, p_target text, p_name text, p_method text,
  p_code text, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c claims;
  v_page text;
begin
  if p_kind = 'event' then
    select coalesce(e.official_url, v.website) into v_page
    from events e left join venues v on v.id = e.venue_id
    where e.id = p_target and e.visibility = 'public' and not e.hidden;
    if not found then raise exception 'unknown event' using errcode = 'P0002'; end if;
  else
    select website into v_page from venues where id = p_target and not private;
    if not found then raise exception 'unknown venue' using errcode = 'P0002'; end if;
  end if;
  select * into c from claims where user_id = p_user and status = 'pending'
    and coalesce(event_id, venue_id) = p_target;
  if found then
    update claims set organiser_name = btrim(p_name), method = p_method,
      evidence = nullif(btrim(p_evidence), ''), page_url = v_page
    where id = c.id returning * into c;
  else
    insert into claims (user_id, kind, event_id, venue_id, organiser_name, method, code,
      page_url, evidence)
    values (p_user, p_kind, case when p_kind = 'event' then p_target end,
      case when p_kind = 'venue' then p_target end, btrim(p_name), p_method, p_code, v_page,
      nullif(btrim(p_evidence), ''))
    returning * into c;
  end if;
  return to_jsonb(c) - 'reviewed_by';
end $$;

create function claim_get(p_user uuid, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(c) - 'reviewed_by' from claims c where c.id = p_id and c.user_id = p_user
$$;

-- Approve (site check or moderator), reject or revoke. A second organiser for the same event or
-- venue can't be approved while the first stands: a moderator decides (revoke first).
create function claim_decide(p_id uuid, p_action text, p_by text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c claims;
begin
  select * into c from claims where id = p_id for update;
  if not found then raise exception 'unknown claim' using errcode = 'P0002'; end if;
  if p_action = 'approve' then
    if c.status <> 'pending' then raise exception 'already decided' using errcode = 'P0001'; end if;
    if exists (select 1 from claims x where x.status = 'approved' and x.id <> c.id
      and x.kind = c.kind and coalesce(x.event_id, x.venue_id) = coalesce(c.event_id, c.venue_id)) then
      raise exception 'already claimed' using errcode = 'HQ020';
    end if;
    update claims set status = 'approved', reviewed_by = p_by, decided_at = now(), note = p_note
    where id = c.id;
    if c.kind = 'event' then
      update events set owner_id = c.user_id where id = c.event_id;
    end if;
  elsif p_action = 'reject' then
    if c.status <> 'pending' then raise exception 'already decided' using errcode = 'P0001'; end if;
    update claims set status = 'rejected', reviewed_by = p_by, decided_at = now(), note = p_note
    where id = c.id;
  elsif p_action = 'revoke' then
    if c.status <> 'approved' then raise exception 'not approved' using errcode = 'P0001'; end if;
    update claims set status = 'revoked', reviewed_by = p_by, decided_at = now(), note = p_note
    where id = c.id;
    -- The organiser's fields stop winning; the sources take over at their next run.
    if c.kind = 'event' then
      update events set owner_id = null, owner_fields = '{}'::jsonb, source_disagrees = null,
        source_disagrees_at = null
      where id = c.event_id and owner_id = c.user_id;
    end if;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  return (select to_jsonb(x) from claims x where x.id = c.id);
end $$;

create function claim_checked(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update claims set checked_at = now() where id = p_id
$$;

-- An account's claims (any status), with what they're for.
create function claims_mine(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg((to_jsonb(c) - 'reviewed_by') || jsonb_build_object(
      'title', coalesce(e.title, v.name)) order by c.created_at desc), '[]'::jsonb)
  from claims c left join events e on e.id = c.event_id left join venues v on v.id = c.venue_id
  where c.user_id = p_user
$$;

-- Moderators: open claims (oldest first), and the approved ones, to revoke.
create function claims_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'eventId', c.event_id, 'venueId', c.venue_id,
      'title', coalesce(e.title, v.name), 'organiserName', c.organiser_name,
      'method', c.method, 'pageUrl', c.page_url, 'evidence', c.evidence, 'status', c.status,
      'createdAt', c.created_at, 'decidedAt', c.decided_at, 'checkedAt', c.checked_at,
      'email', u.email,
      'competing', (select count(*) from claims x where x.id <> c.id
        and x.status in ('pending', 'approved')
        and coalesce(x.event_id, x.venue_id) = coalesce(c.event_id, c.venue_id)))
    order by c.status <> 'pending', c.created_at), '[]'::jsonb)
  from claims c
  left join events e on e.id = c.event_id
  left join venues v on v.id = c.venue_id
  left join auth.users u on u.id = c.user_id
  where c.status = 'pending' or (c.status = 'approved' and c.decided_at > now() - interval '60 days')
$$;

-- ---------- Edits by owners and organisers ----------

-- The fields an owner or organiser can change, with their types.
create function owner_field_names()
returns text[]
language sql
immutable
as $$
  select array['title', 'description', 'start_at', 'end_at', 'status', 'is_free', 'price_min',
    'price_max', 'official_url', 'ticket_url']
$$;

-- Keeps the organiser's fields over what a source writes. A source value that differs is kept in
-- source_disagrees for moderators; users see the organiser's.
create function events_keep_owner_fields()
returns trigger
language plpgsql
as $$
declare
  o jsonb := new.owner_fields;
  theirs jsonb := '{}'::jsonb;
begin
  if o = '{}'::jsonb or current_setting('happow.owner_edit', true) = 'on' then
    return new;
  end if;
  if o ? 'title' and new.title is distinct from o ->> 'title' then
    theirs := theirs || jsonb_build_object('title', new.title); new.title := o ->> 'title';
  end if;
  if o ? 'description' and new.description is distinct from o ->> 'description' then
    theirs := theirs || jsonb_build_object('description', new.description);
    new.description := o ->> 'description';
  end if;
  if o ? 'start_at' and new.start_at is distinct from (o ->> 'start_at')::timestamptz then
    theirs := theirs || jsonb_build_object('start_at', new.start_at);
    new.start_at := (o ->> 'start_at')::timestamptz;
  end if;
  if o ? 'end_at' and new.end_at is distinct from (o ->> 'end_at')::timestamptz then
    theirs := theirs || jsonb_build_object('end_at', new.end_at);
    new.end_at := (o ->> 'end_at')::timestamptz;
  end if;
  if o ? 'status' and new.status is distinct from (o ->> 'status')::event_status then
    theirs := theirs || jsonb_build_object('status', new.status);
    new.status := (o ->> 'status')::event_status;
  end if;
  if o ? 'is_free' and new.is_free is distinct from (o ->> 'is_free')::boolean then
    theirs := theirs || jsonb_build_object('is_free', new.is_free);
    new.is_free := (o ->> 'is_free')::boolean;
  end if;
  if o ? 'price_min' and new.price_min is distinct from (o ->> 'price_min')::numeric then
    theirs := theirs || jsonb_build_object('price_min', new.price_min);
    new.price_min := (o ->> 'price_min')::numeric;
  end if;
  if o ? 'price_max' and new.price_max is distinct from (o ->> 'price_max')::numeric then
    theirs := theirs || jsonb_build_object('price_max', new.price_max);
    new.price_max := (o ->> 'price_max')::numeric;
  end if;
  if o ? 'official_url' and new.official_url is distinct from o ->> 'official_url' then
    theirs := theirs || jsonb_build_object('official_url', new.official_url);
    new.official_url := o ->> 'official_url';
  end if;
  if o ? 'ticket_url' and new.ticket_url is distinct from o ->> 'ticket_url' then
    theirs := theirs || jsonb_build_object('ticket_url', new.ticket_url);
    new.ticket_url := o ->> 'ticket_url';
  end if;
  if new.end_at < new.start_at then new.end_at := new.start_at; end if;
  if theirs <> '{}'::jsonb then
    new.source_disagrees := coalesce(old.source_disagrees, '{}'::jsonb) || theirs;
    new.source_disagrees_at := now();
  end if;
  return new;
end $$;

create trigger events_keep_owner_fields before update on events
  for each row execute function events_keep_owner_fields();

-- Every change by hand, and pending edits by contributors who aren't trusted (moderation).
create table event_edits (
  id bigint generated always as identity primary key,
  event_id text not null references events (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  -- owner (private), organiser (claim), contributor (their own added event), moderator.
  via text not null check (via in ('owner', 'organiser', 'contributor', 'moderator')),
  status text not null default 'applied' check (status in ('applied', 'pending', 'rejected')),
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz
);
create index event_edits_event_idx on event_edits (event_id, created_at desc);
create index event_edits_pending_idx on event_edits (created_at) where status = 'pending';
alter table event_edits enable row level security;

-- How an account may change an event: 'owner' (its private event), 'organiser' (verified),
-- 'contributor' (an event it added that was published), or null.
create function event_role(p_user uuid, p_event text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is null then null
    when exists (select 1 from events where id = p_event and visibility = 'private'
      and owner_id = p_user) then 'owner'
    when (event_organiser(p_event) ->> 'user')::uuid = p_user then 'organiser'
    when exists (select 1 from submissions s join events e on e.id = s.event_id
      where s.event_id = p_event and s.user_id = p_user and s.status = 'approved'
        and e.visibility = 'public') then 'contributor'
  end
$$;

-- The current values of the editable fields.
create function event_fields(p_event text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('title', title, 'description', description, 'start_at', start_at,
    'end_at', end_at, 'status', status, 'is_free', is_free, 'price_min', price_min,
    'price_max', price_max, 'official_url', official_url, 'ticket_url', ticket_url)
  from events where id = p_event
$$;

-- Applies fields by hand, past the organiser-fields trigger. An organiser's fields are kept as
-- owner_fields (they win over sources); a moderator's or contributor's are not.
create function event_apply_fields(p_event text, p_fields jsonb, p_keep boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := p_fields;
  moved boolean;
begin
  perform set_config('happow.owner_edit', 'on', true);
  select (f ? 'start_at' and (f ->> 'start_at')::timestamptz is distinct from e.start_at)
    or (f ? 'end_at' and (f ->> 'end_at')::timestamptz is distinct from e.end_at)
    or (f ? 'status' and (f ->> 'status')::event_status is distinct from e.status)
  into moved from events e where e.id = p_event;
  update events e set
    title = case when f ? 'title' then f ->> 'title' else e.title end,
    description = case when f ? 'description' then f ->> 'description' else e.description end,
    start_at = case when f ? 'start_at' then (f ->> 'start_at')::timestamptz else e.start_at end,
    end_at = case when f ? 'end_at' then (f ->> 'end_at')::timestamptz else e.end_at end,
    end_estimated = case when f ? 'end_at' then false else e.end_estimated end,
    status = case when f ? 'status' then (f ->> 'status')::event_status else e.status end,
    is_free = case when f ? 'is_free' then (f ->> 'is_free')::boolean else e.is_free end,
    price_min = case when f ? 'price_min' then (f ->> 'price_min')::numeric else e.price_min end,
    price_max = case when f ? 'price_max' then (f ->> 'price_max')::numeric else e.price_max end,
    official_url = case when f ? 'official_url' then f ->> 'official_url' else e.official_url end,
    ticket_url = case when f ? 'ticket_url' then f ->> 'ticket_url' else e.ticket_url end,
    owner_fields = case when p_keep and e.visibility = 'public'
      then e.owner_fields || f else e.owner_fields end,
    changed_at = case when moved then now() else e.changed_at end
  where e.id = p_event;
  perform set_config('happow.owner_edit', 'off', true);
end $$;

-- An edit: applied at once for the owner, a verified organiser or a trusted contributor;
-- pending for moderation otherwise. Returns the edit's status.
create function event_edit(p_user uuid, p_event text, p_fields jsonb, p_trusted boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := event_role(p_user, p_event);
  allowed text[] := owner_field_names();
  f jsonb;
  v_before jsonb;
  st text;
begin
  if v_role is null then raise exception 'not yours' using errcode = 'P0002'; end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into f
  from jsonb_each(p_fields) x(k, v) where k = any (allowed);
  if f = '{}'::jsonb then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_before := (select jsonb_object_agg(k, v) from jsonb_each(event_fields(p_event)) x(k, v)
    where f ? k);
  if v_role = 'contributor' and not p_trusted then
    st := 'pending';
  else
    st := 'applied';
    perform event_apply_fields(p_event, f, v_role = 'organiser');
  end if;
  insert into event_edits (event_id, user_id, via, status, before, after)
  values (p_event, p_user, v_role, st, v_before, f);
  return jsonb_build_object('status', st, 'role', v_role);
end $$;

-- Moderators: pending contributor edits.
create function edits_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'eventId', x.event_id,
      'title', e.title, 'before', x.before, 'after', x.after, 'createdAt', x.created_at)
    order by x.created_at), '[]'::jsonb)
  from event_edits x join events e on e.id = x.event_id
  where x.status = 'pending'
$$;

create function edit_decide(p_id bigint, p_approve boolean, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x event_edits;
begin
  select * into x from event_edits where id = p_id for update;
  if not found then raise exception 'unknown edit' using errcode = 'P0002'; end if;
  if x.status <> 'pending' then raise exception 'already reviewed' using errcode = 'P0001'; end if;
  if p_approve then perform event_apply_fields(x.event_id, x.after, false); end if;
  update event_edits set status = case when p_approve then 'applied' else 'rejected' end,
    reviewed_by = p_by, reviewed_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'eventId', x.event_id,
    'action', case when p_approve then 'approve' else 'reject' end);
end $$;

-- ---------- Organiser posts ----------

create table event_posts (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references events (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('schedule', 'important', 'info')),
  body text not null check (char_length(btrim(body)) between 1 and 280),
  -- A schedule change: the fields it set, and what they were before (restored if hidden).
  change jsonb,
  previous jsonb,
  created_at timestamptz not null default now(),
  hidden boolean not null default false,
  hidden_by text,
  report_count integer not null default 0
);
create index event_posts_event_idx on event_posts (event_id, created_at desc);
alter table event_posts enable row level security;
-- Posts on public events are public; on private ones, for whoever may see the event.
create policy "visible with the event" on event_posts for select to anon, authenticated
  using (not hidden and event_visible_to(event_id, auth.uid()));

create table post_reports (
  post_id uuid not null references event_posts (id) on delete cascade,
  reporter_hash text not null,
  reason text not null check (reason in ('inappropriate', 'unlawful', 'wrong_info', 'other')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (post_id, reporter_hash)
);
alter table post_reports enable row level security;

-- A post by the event's organiser (or a private event's owner). A schedule change applies its
-- fields as an edit. Refused past the daily limit.
create function post_add(p_user uuid, p_event text, p_kind text, p_body text, p_change jsonb,
  p_per_day integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := event_role(p_user, p_event);
  prev jsonb;
  ch jsonb;
  pid uuid;
begin
  if v_role is null or v_role = 'contributor' then
    raise exception 'not the organiser' using errcode = 'P0002';
  end if;
  if (select count(*) from event_posts where event_id = p_event and user_id = p_user
      and created_at > now() - interval '1 day') >= p_per_day then
    raise exception 'too many posts' using errcode = 'HQ030';
  end if;
  if p_kind = 'schedule' then
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into ch from jsonb_each(coalesce(p_change, '{}'))
      x(k, v) where k in ('start_at', 'end_at', 'status');
    if ch = '{}'::jsonb then raise exception 'no change' using errcode = '22023'; end if;
    prev := (select jsonb_object_agg(k, v) from jsonb_each(event_fields(p_event)) x(k, v)
      where ch ? k);
    perform event_apply_fields(p_event, ch, v_role = 'organiser');
    insert into event_edits (event_id, user_id, via, status, before, after)
    values (p_event, p_user, v_role, 'applied', prev, ch);
  end if;
  insert into event_posts (event_id, user_id, kind, body, change, previous)
  values (p_event, p_user, p_kind, btrim(p_body), ch, prev) returning id into pid;
  update events set last_post_at = now() where id = p_event;
  return jsonb_build_object('id', pid, 'kind', p_kind, 'change', ch);
end $$;

-- An event's posts, important first (pinned), then newest; with its organiser.
create function event_posts_get(p_event text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'organiser', (select jsonb_build_object('name', o ->> 'name', 'kind', o ->> 'kind')
      from (select event_organiser(p_event) as o) x where o is not null),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'body', p.body,
          'change', p.change, 'createdAt', p.created_at)
        order by p.kind = 'important' desc, p.created_at desc)
      from (select * from event_posts where event_id = p_event and not hidden
        order by created_at desc limit 50) p), '[]'::jsonb))
$$;

create function post_delete(p_user uuid, p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with d as (delete from event_posts where id = p_id and user_id = p_user and kind <> 'schedule'
    returning 1)
  select exists (select 1 from d)
$$;

create function post_report(p_post uuid, p_reporter text, p_reason text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from event_posts where id = p_post and not hidden) then
    raise exception 'unknown post' using errcode = 'P0002';
  end if;
  insert into post_reports (post_id, reporter_hash, reason, note)
  values (p_post, p_reporter, p_reason, nullif(btrim(left(p_note, 500)), ''))
  on conflict (post_id, reporter_hash) do update set reason = excluded.reason,
    note = coalesce(excluded.note, post_reports.note), created_at = now(), resolved_at = null;
  update event_posts set report_count = (select count(*) from post_reports
    where post_id = p_post and resolved_at is null) where id = p_post;
  return true;
end $$;

-- Moderators: reported posts.
create function post_reports_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'eventId', p.event_id,
      'title', e.title, 'kind', p.kind, 'body', p.body, 'count', p.report_count,
      'reasons', (select jsonb_object_agg(reason, n) from (select reason, count(*) n
        from post_reports r where r.post_id = p.id and r.resolved_at is null group by reason) x),
      'createdAt', p.created_at) order by p.report_count desc, p.created_at desc), '[]'::jsonb)
  from event_posts p join events e on e.id = p.event_id
  where not p.hidden and exists (select 1 from post_reports r where r.post_id = p.id
    and r.resolved_at is null)
$$;

-- Hide (a hidden schedule change restores the event's previous times) or dismiss the reports.
create function post_moderate(p_id uuid, p_action text, p_by text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  p event_posts;
begin
  select * into p from event_posts where id = p_id for update;
  if not found then raise exception 'unknown post' using errcode = 'P0002'; end if;
  if p_action = 'hide' then
    update event_posts set hidden = true, hidden_by = p_by where id = p_id;
    if p.kind = 'schedule' and p.previous is not null then
      perform event_apply_fields(p.event_id, p.previous, false);
      update events e set owner_fields = e.owner_fields - array(select jsonb_object_keys(p.previous))
      where e.id = p.event_id;
      insert into event_edits (event_id, via, status, before, after, reviewed_by, reviewed_at)
      values (p.event_id, 'moderator', 'applied', p.change, p.previous, p_by, now());
    end if;
  elsif p_action <> 'dismiss' then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  update post_reports set resolved_at = now() where post_id = p_id and resolved_at is null;
  update event_posts set report_count = 0 where id = p_id;
  return true;
end $$;

-- ---------- Push to everyone interested ----------

-- A schedule change or an important post (or a private event's change) goes to every device that
-- allowed notifications and showed interest: set a reminder, marked going / on the way / here,
-- saved it on a synced account, or accepted an invitation. Filled when the notice is made; the
-- cron sends what the request didn't.
create table notice_queue (
  id bigint generated always as identity primary key,
  event_id text not null references events (id) on delete cascade,
  kind text not null check (kind in ('schedule', 'important', 'cancelled')),
  body text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  lang text not null,
  created_at timestamptz not null default now(),
  unique (event_id, kind, body, endpoint)
);
alter table notice_queue enable row level security;

create function notice_enqueue(p_event text, p_kind text, p_body text, p_except uuid,
  p_max integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  v_private boolean := (select visibility = 'private' from events where id = p_event);
begin
  with users as (
    select user_id from attendance where event_id = p_event and expires_at > now()
      and user_id is not null and kind in ('going', 'onway', 'here')
    union select user_id from reminders where event_id = p_event and user_id is not null
    union select user_id from saved_events where event_id = p_event and saved
    union select invitee from invitations where event_id = p_event and status = 'accepted'
  ), devices as (
    select device from attendance where event_id = p_event and expires_at > now()
      and kind in ('going', 'onway', 'here')
    union select device_hash from reminders where event_id = p_event
  ), subs as (
    select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, s.lang, s.user_id
    from push_subscriptions s
    where (s.user_id in (select user_id from users) or s.device_hash in (select device from devices))
      and s.user_id is distinct from p_except
  ), added as (
    insert into notice_queue (event_id, kind, body, endpoint, p256dh, auth, lang)
    select p_event, p_kind, p_body, s.endpoint, s.p256dh, s.auth, s.lang from subs s
    -- A private event's notice only reaches accounts that may still see it.
    where not v_private or (s.user_id is not null and event_visible_to(p_event, s.user_id))
    limit p_max
    on conflict do nothing
    returning 1
  )
  select count(*) into n from added;
  return n;
end $$;

create function notices_due(p_limit integer, p_event text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'eventId', q.event_id,
      'kind', q.kind, 'body', q.body, 'title', e.title, 'status', e.status::text,
      'endpoint', q.endpoint, 'p256dh', q.p256dh, 'auth', q.auth, 'lang', q.lang)), '[]'::jsonb)
  from (select * from notice_queue where p_event is null or event_id = p_event
    order by created_at, id limit p_limit) q
  join events e on e.id = q.event_id
$$;

create function notices_done(p_ids bigint[], p_gone_endpoints text[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from notice_queue where id = any (p_ids) or created_at < now() - interval '1 day';
  delete from push_subscriptions where endpoint = any (p_gone_endpoints);
$$;

-- ---------- Reports: organiser and moderators ----------

-- Public events: every report reaches moderators, and the organiser sees it too. Private events:
-- only abuse and unlawful content goes to moderators; the rest only to the organiser.
create or replace function report_event(p_event text, p_reason report_reason, p_note text, p_reporter text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_private boolean;
begin
  select visibility = 'private' into v_private from events where id = p_event;
  if v_private is null then
    raise exception 'unknown event' using errcode = 'P0002';
  end if;
  insert into reports (event_id, reason, note, reporter_hash, audience)
  values (p_event, p_reason, nullif(btrim(left(p_note, 500)), ''), p_reporter,
    case when v_private and p_reason::text not in ('inappropriate', 'unlawful') then 'organiser'
      else 'moderators' end)
  on conflict (event_id, reporter_hash) where resolved_at is null do update
    set reason = excluded.reason, note = coalesce(excluded.note, reports.note), created_at = now(),
      audience = excluded.audience;
  perform refresh_event_flag(p_event);
  return true;
end $$;

-- The organiser's reports: open ones on an event they run, both audiences.
create function organiser_reports(p_user uuid, p_event text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(event_role(p_user, p_event), '') not in ('owner', 'organiser') then
    raise exception 'not the organiser' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note,
        'audience', r.audience, 'createdAt', r.created_at, 'answer', r.organiser_note,
        'answeredAt', r.organiser_at) order by r.created_at desc)
    from reports r where r.event_id = p_event and r.resolved_at is null), '[]'::jsonb);
end $$;

-- The organiser answers a report. One meant only for them is resolved by it; one moderators see
-- stays open for them, with the answer beside it. Either way it never blocks an edit or a post.
create function organiser_report_answer(p_user uuid, p_id uuid, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r reports;
begin
  select * into r from reports where id = p_id and resolved_at is null for update;
  if not found or coalesce(event_role(p_user, r.event_id), '') not in ('owner', 'organiser') then
    raise exception 'unknown report' using errcode = 'P0002';
  end if;
  update reports set organiser_note = nullif(btrim(left(p_note, 500)), ''), organiser_at = now(),
    resolved_at = case when audience = 'organiser' then now() end,
    resolution = case when audience = 'organiser' then 'dismissed' end,
    resolved_by = case when audience = 'organiser' then 'organiser' end
  where id = p_id;
  perform refresh_event_flag(r.event_id);
  return true;
end $$;

-- The moderators' queue: reports meant for them only, with the organiser's answer if any.
create or replace function moderation_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with open_reports as (
    select * from reports where resolved_at is null and audience = 'moderators'
  ),
  per_reason as (
    select event_id, jsonb_object_agg(reason, n) as reasons
    from (select event_id, reason, count(*)::int as n from open_reports group by 1, 2) x
    group by event_id
  ),
  per_event as (
    select event_id, count(*)::int as count, max(created_at) as last_at,
      (array_agg(note order by created_at desc) filter (where note is not null))[1:5] as notes,
      (array_agg(organiser_note order by organiser_at desc)
        filter (where organiser_note is not null))[1] as organiser_note
    from open_reports group by event_id
  ),
  missing as (
    select id as event_id, source_missing_at from events
    where source_missing_at is not null and not hidden and status = 'scheduled' and end_at > now()
  ),
  flagged as (
    select coalesce(p.event_id, m.event_id) as event_id, coalesce(p.count, 0) as count,
      greatest(p.last_at, m.source_missing_at) as last_at,
      coalesce(pr.reasons, '{}'::jsonb)
        || case when m.event_id is null then '{}'::jsonb else '{"source_missing": 1}'::jsonb end
        as reasons,
      p.notes, p.organiser_note
    from per_event p
    join per_reason pr using (event_id)
    full join missing m on m.event_id = p.event_id
  )
  select jsonb_build_object(
    'submissions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc) from (
        select s.id, s.kind, s.source_id, s.url, s.confidence, s.event_id, s.created_at,
          s.series_id, s.feed_id, f.url as feed_url, f.status as feed_status,
          left(s.submitter_hash, 8) as submitter, s.extracted_payload -> 'event' as event,
          s.extracted_payload -> 'venue' as venue, s.form_payload as form
        from submissions s left join account_feeds f on f.id = s.feed_id
        where s.status = 'pending' order by s.created_at desc limit 200) s), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.last_at desc) from (
        select f.event_id, e.title, e.start_at, e.status, e.hidden, e.trust, e.verified,
          v.name as venue_name, f.count, f.last_at, f.reasons, f.notes, f.organiser_note,
          e.visibility, (event_organiser(e.id) ->> 'name') as organiser,
          e.source_disagrees
        from flagged f
        join events e on e.id = f.event_id
        left join venues v on v.id = e.venue_id
        order by f.last_at desc limit 100) r), '[]'::jsonb),
    'disagreements', coalesce((
      select jsonb_agg(jsonb_build_object('eventId', e.id, 'title', e.title,
          'organiser', event_organiser(e.id) ->> 'name', 'source', e.source_disagrees,
          'organiserFields', e.owner_fields, 'at', e.source_disagrees_at)
        order by e.source_disagrees_at desc)
      from events e where e.source_disagrees is not null and e.end_at > now()), '[]'::jsonb));
$$;

-- A moderator hides a private event (abuse) and can stop its owner creating private events.
alter table profiles add column private_blocked_at timestamptz;

create function private_block(p_event text, p_by text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from events where id = p_event and visibility = 'private';
  if v_owner is null then raise exception 'unknown event' using errcode = 'P0002'; end if;
  update profiles set private_blocked_at = now() where user_id = v_owner;
  update events set hidden = true where owner_id = v_owner and visibility = 'private';
  update reports set resolved_at = now(), resolution = 'hidden', resolved_by = p_by
  where event_id = p_event and resolved_at is null;
  return true;
end $$;

-- ---------- Your events ----------

-- One list: added (submissions), claimed, and private, newest first, with what you can do.
create function my_events(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select s.event_id as id from submissions s where s.user_id = p_user and s.event_id is not null
    union select id from events where owner_id = p_user
    union select e.id from events e join claims c on c.status = 'approved' and c.user_id = p_user
      and c.kind = 'venue' and venue_matches(c.venue_id, e.venue_id)
      where e.end_at > now() - interval '30 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
      'startAt', e.start_at, 'endAt', e.end_at, 'status', e.status, 'visibility', e.visibility,
      'hidden', e.hidden, 'role', event_role(p_user, e.id),
      'submissionId', (select s.id from submissions s where s.event_id = e.id
        and s.user_id = p_user order by s.created_at limit 1),
      'guests', case when e.visibility = 'private' then (select jsonb_build_object(
          'accepted', count(*) filter (where status = 'accepted'),
          'pending', count(*) filter (where status = 'pending'),
          'declined', count(*) filter (where status = 'declined'))
        from invitations i where i.event_id = e.id) end,
      'posts', (select count(*) from event_posts p where p.event_id = e.id and not p.hidden),
      'reports', (select count(*) from reports r where r.event_id = e.id and r.resolved_at is null),
      'pendingEdits', (select count(*) from event_edits x where x.event_id = e.id
        and x.status = 'pending'))
    order by e.start_at desc), '[]'::jsonb)
  from events e join ids on ids.id = e.id
  where e.end_at > now() - interval '30 days'
$$;

-- An approved organiser of a venue near this point publishes there at once.
create function organiser_at(p_user uuid, p_lat double precision, p_lng double precision,
  p_radius_m double precision)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from claims c join venues v on v.id = c.venue_id
    where c.user_id = p_user and c.kind = 'venue' and c.status = 'approved'
      and st_dwithin(v.point, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m))
$$;

-- ---------- Export, deletion, retention ----------

create or replace function account_export(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile', profile_get(p_user),
    'grants', (
      select coalesce(jsonb_agg(grant_json(g) order by g.created_at), '[]'::jsonb)
      from plan_grants g where g.user_id = p_user
    ),
    'usage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(u.month, 'YYYY-MM'), 'events', u.events, 'autofills', u.autofills,
        'privateEvents', u.private_events
      ) order by u.month), '[]'::jsonb)
      from account_usage u where u.user_id = p_user
    ),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.form_payload ->> 'title', 'status', s.status,
        'eventId', s.event_id, 'createdAt', s.created_at
      ) order by s.created_at), '[]'::jsonb)
      from submissions s where s.user_id = p_user
    ),
    'contributions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'submissionId', c.submission_id, 'kind', c.kind, 'days', c.days,
        'month', to_char(c.month, 'YYYY-MM'), 'createdAt', c.created_at, 'revokedAt', c.revoked_at
      ) order by c.created_at), '[]'::jsonb)
      from contributions c where c.user_id = p_user
    ),
    'saved', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'eventId', v.event_id, 'saved', v.saved, 'going', v.going, 'changedAt', v.changed_at
      ) order by v.changed_at), '[]'::jsonb)
      from saved_events v where v.user_id = p_user
    ),
    'contacts', (
      select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'blocked', c.blocked,
        'since', c.created_at) order by c.created_at), '[]'::jsonb)
      from contacts c left join profiles p on p.user_id = c.contact where c.owner = p_user
    ),
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'members', (
          select coalesce(jsonb_agg(p.display_name), '[]'::jsonb) from contact_group_members m
          left join profiles p on p.user_id = m.contact where m.group_id = g.id))
        order by g.created_at), '[]'::jsonb)
      from contact_groups g where g.owner = p_user
    ),
    'contactLinks', (
      select coalesce(jsonb_agg(jsonb_build_object('createdAt', l.created_at,
        'retiredAt', l.retired_at) order by l.created_at), '[]'::jsonb)
      from contact_links l where l.owner = p_user
    ),
    'privateEvents', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
        'startAt', e.start_at, 'venue', v.name, 'address', v.address) order by e.start_at),
        '[]'::jsonb)
      from events e left join venues v on v.id = e.venue_id
      where e.owner_id = p_user and e.visibility = 'private'
    ),
    'invitationsSent', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', i.event_id, 'to', p.display_name,
        'label', i.label, 'status', i.status, 'createdAt', i.created_at) order by i.created_at),
        '[]'::jsonb)
      from invitations i left join profiles p on p.user_id = i.invitee where i.inviter = p_user
    ),
    'invitationsReceived', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', i.event_id, 'from', p.display_name,
        'status', i.status, 'createdAt', i.created_at, 'answeredAt', i.answered_at)
        order by i.created_at), '[]'::jsonb)
      from invitations i left join profiles p on p.user_id = i.inviter where i.invitee = p_user
    ),
    'friendOverrides', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', f.event_id, 'show', f.show)),
        '[]'::jsonb)
      from friend_overrides f where f.user_id = p_user
    ),
    'claims', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'eventId', c.event_id,
        'venueId', c.venue_id, 'organiserName', c.organiser_name, 'method', c.method,
        'evidence', c.evidence, 'status', c.status, 'createdAt', c.created_at,
        'decidedAt', c.decided_at) order by c.created_at), '[]'::jsonb)
      from claims c where c.user_id = p_user
    ),
    'posts', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', p.event_id, 'kind', p.kind,
        'body', p.body, 'createdAt', p.created_at) order by p.created_at), '[]'::jsonb)
      from event_posts p where p.user_id = p_user
    ),
    'edits', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', x.event_id, 'via', x.via,
        'status', x.status, 'before', x.before, 'after', x.after, 'createdAt', x.created_at)
        order by x.created_at), '[]'::jsonb)
      from event_edits x where x.user_id = p_user
    )
  )
$$;

-- Deleting an account: its private events go (invitees just lose them), its claims and posts go
-- with the user (cascade); public events it claimed stay, unclaimed, keeping the current values.
create or replace function account_forget(p_user uuid, p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from events where owner_id = p_user and visibility = 'private';
  update events set owner_id = null, owner_fields = '{}'::jsonb where owner_id = p_user;
  delete from code_requests where email = lower(p_email);
  delete from profiles where user_id = p_user;
$$;

-- Retention: private events and their invitations a while after they end, unused invite
-- links and old notices at once after the event.
create function private_cleanup(p_keep_days integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from invitations i using events e
  where e.id = i.event_id and i.invitee is null and i.status = 'pending' and e.end_at < now();
  delete from notice_queue where created_at < now() - interval '1 day';
  with d as (
    delete from events where visibility = 'private'
      and end_at < now() - make_interval(days => p_keep_days)
    returning 1)
  select count(*) into n from d;
  return n;
end $$;

-- ---------- Grants ----------

do $$
declare
  f text;
begin
  foreach f in array array[
    'event_visible_to(text, uuid)', 'event_row_json(text, double precision, double precision)',
    'private_events_for(uuid, double precision, double precision)',
    'private_event_get(uuid, text, text, double precision, double precision)',
    'event_visibility(text)',
    'submit_private(jsonb, text, text, uuid, date, integer, integer)',
    'contact_mutual(uuid, uuid)', 'contact_connect(uuid, uuid)', 'contacts_list(uuid)',
    'contact_link_new(uuid, text)', 'contact_link_owner(text)', 'contact_link_accept(uuid, text)',
    'contact_change(uuid, uuid, text)', 'group_save(uuid, bigint, text, uuid[], integer)',
    'group_delete(uuid, bigint)',
    'invite_people(uuid, text, uuid[], bigint[], integer)',
    'invite_link(uuid, text, text, text, integer)', 'invitation_answer(uuid, text, boolean)',
    'invitation_accept_link(uuid, text)', 'invitation_revoke(uuid, uuid)',
    'event_guests(uuid, text)', 'invitation_seen(uuid, text)',
    'friends_shown(uuid, text)', 'friends_on_event(uuid, text, text)',
    'friend_override_set(uuid, text, boolean)',
    'venue_matches(text, text)', 'event_organiser(text)',
    'claim_open(uuid, text, text, text, text, text, text)', 'claim_get(uuid, uuid)',
    'claim_decide(uuid, text, text, text)', 'claim_checked(uuid)', 'claims_mine(uuid)',
    'claims_queue()', 'event_role(uuid, text)', 'event_fields(text)',
    'event_apply_fields(text, jsonb, boolean)', 'event_edit(uuid, text, jsonb, boolean)',
    'edits_queue()', 'edit_decide(bigint, boolean, text)',
    'post_add(uuid, text, text, text, jsonb, integer)', 'event_posts_get(text)',
    'post_delete(uuid, uuid)', 'post_report(uuid, text, text, text)', 'post_reports_queue()',
    'post_moderate(uuid, text, text)',
    'notice_enqueue(text, text, text, uuid, integer)', 'notices_due(integer, text)',
    'notices_done(bigint[], text[])',
    'organiser_reports(uuid, text)', 'organiser_report_answer(uuid, uuid, text)',
    'private_block(text, text)', 'my_events(uuid)',
    'organiser_at(uuid, double precision, double precision, double precision)',
    'private_cleanup(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
-- The row-level security policies call this one as the reader.
grant execute on function event_visible_to(text, uuid) to anon, authenticated;
-- Signed-in readers (Supabase grants these by default; plain Postgres needs them said). The
-- policies above limit every row to its own people.
grant select on contacts, contact_groups, contact_group_members, contact_links, invitations,
  friend_overrides, claims to authenticated;
grant select on event_posts to anon, authenticated;

-- The profile gains the friends' switch and whether private events are blocked (abuse).
create or replace function profile_get(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p profiles;
begin
  insert into profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into p from profiles where user_id = p_user;
  return jsonb_build_object(
    'displayName', p.display_name, 'locale', p.locale, 'termsVersion', p.terms_version,
    'termsAcceptedAt', p.terms_accepted_at, 'createdAt', p.created_at,
    'showName', p.show_name, 'level', p.level, 'friendsVisible', p.friends_visible,
    'privateBlocked', p.private_blocked_at is not null
  );
end $$;

create function profile_friends(p_user uuid, p_on boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  update profiles set friends_visible = p_on where user_id = p_user;
$$;
revoke all on function profile_friends(uuid, boolean) from public, anon, authenticated;
grant execute on function profile_friends(uuid, boolean) to service_role;

-- "Added by" never names anyone on a private event.
create or replace function event_credit(p_event text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', p.display_name, 'level', p.level)
  from submissions s join profiles p on p.user_id = s.user_id
  join events e on e.id = s.event_id and e.visibility = 'public'
  where s.event_id = p_event and s.kind = 'user' and s.status <> 'rejected'
    and p.show_name and p.display_name is not null
  order by s.created_at limit 1
$$;
