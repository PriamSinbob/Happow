-- Places people add and correct.
-- An account adds a place OSM does not list (or lists without hours) and it shows at once; anyone
-- with an account can correct a place's hours, mark it closed for good, or mark a private party
-- on. Corrections live beside the weekly OSM import, which never overwrites them: a corrected
-- value holds until OSM changes the value it replaced. Every change is logged with who made it.

-- 'osm': the weekly import's row (id 'node/1'); 'user': added here (id 'user/<uuid>'), which the
-- import neither updates nor removes.
alter table places add column source text not null default 'osm' check (source in ('osm', 'user'));
alter table places add column added_by uuid references auth.users (id) on delete set null;

create table place_changes (
  place_id text primary key references places (osm_id) on delete cascade,
  -- Corrected opening hours, and the OSM value they replaced: once OSM says something else,
  -- OSM is newer and the correction stops applying.
  hours text,
  hours_base text,
  -- Closed for good: the place is not served.
  closed boolean not null default false,
  -- A private party is on until then: the place shows as closed to the public.
  private_until timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table place_changes enable row level security;

create table place_log (
  id bigint generated always as identity primary key,
  place_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  -- 'add', 'hours', 'closed', 'open', 'private', 'public'.
  action text not null,
  value text,
  at timestamptz not null default now()
);
create index place_log_place_idx on place_log (place_id, at desc);
alter table place_log enable row level security;

-- Adds a place and returns its id. A stored place of the same name within p_same_m (often one
-- OSM lists without hours) gets the hours as a correction instead, and is open again.
create function place_add(
  p_user uuid,
  p_region text,
  p_name text,
  p_kind text,
  p_lat double precision,
  p_lng double precision,
  p_address text,
  p_website text,
  p_hours text,
  p_same_m double precision
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g extensions.geography :=
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  v_id text;
  v_base text;
begin
  select p.osm_id, p.opening_hours into v_id, v_base
  from places p
  where extensions.st_dwithin(p.point, g, p_same_m) and lower(p.name) = lower(p_name)
  order by extensions.st_distance(p.point, g)
  limit 1;
  if v_id is not null then
    insert into place_changes (place_id, hours, hours_base, closed, updated_by)
    values (v_id, p_hours, v_base, false, p_user)
    on conflict (place_id) do update set hours = excluded.hours,
      hours_base = excluded.hours_base, closed = false, updated_by = excluded.updated_by,
      updated_at = now();
    insert into place_log (place_id, user_id, action, value) values (v_id, p_user, 'hours', p_hours);
    return v_id;
  end if;
  v_id := 'user/' || gen_random_uuid();
  insert into places (osm_id, region_id, name, kind, point, address, website, opening_hours,
    source, added_by)
  values (v_id, p_region, p_name, p_kind, g, p_address, p_website, p_hours, 'user', p_user);
  insert into place_log (place_id, user_id, action, value) values (v_id, p_user, 'add', p_name);
  return v_id;
end;
$$;
revoke all on function place_add(uuid, text, text, text, double precision, double precision, text,
  text, text, double precision) from public;
grant execute on function place_add(uuid, text, text, text, double precision, double precision,
  text, text, text, double precision) to service_role;

-- One correction to a place: new hours, closed for good (or open after all), or a private party
-- until a time (null p_private_until with p_private set: the party is over). P0002: no such place.
create function place_change(
  p_user uuid,
  p_place text,
  p_hours text default null,
  p_closed boolean default null,
  p_private boolean default null,
  p_private_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
begin
  select opening_hours into v_base from places where osm_id = p_place;
  if not found then
    raise exception 'no such place' using errcode = 'P0002';
  end if;
  insert into place_changes (place_id, updated_by) values (p_place, p_user)
  on conflict (place_id) do update set updated_by = excluded.updated_by, updated_at = now();
  if p_hours is not null then
    update place_changes set hours = p_hours, hours_base = v_base where place_id = p_place;
    insert into place_log (place_id, user_id, action, value)
    values (p_place, p_user, 'hours', p_hours);
  end if;
  if p_closed is not null then
    update place_changes set closed = p_closed where place_id = p_place;
    insert into place_log (place_id, user_id, action)
    values (p_place, p_user, case when p_closed then 'closed' else 'open' end);
  end if;
  if p_private is not null then
    update place_changes
    set private_until = case when p_private then p_private_until end
    where place_id = p_place;
    insert into place_log (place_id, user_id, action, value)
    values (p_place, p_user, case when p_private then 'private' else 'public' end,
      p_private_until::text);
  end if;
end;
$$;
revoke all on function place_change(uuid, text, text, boolean, boolean, timestamptz) from public;
grant execute on function place_change(uuid, text, text, boolean, boolean, timestamptz)
  to service_role;

-- The area read, with corrections applied: corrected hours while OSM still says what they
-- replaced, no places closed for good, and a private party that is still on.
drop function places_area(double precision, double precision, double precision, integer);
create function places_area(
  lat double precision,
  lng double precision,
  radius_m double precision,
  max_places integer default 3000
)
returns table (
  id text, name text, kind text, lat double precision, lng double precision, address text,
  website text, opening_hours text, private_until timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with here as (
    select extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography as g
  ), shown as (
    select p.*,
      coalesce(
        case when c.hours_base is not distinct from p.opening_hours then c.hours end,
        p.opening_hours
      ) as hours,
      case when c.private_until > now() then c.private_until end as party
    from places p
    left join place_changes c on c.place_id = p.osm_id
    where not coalesce(c.closed, false)
  )
  select
    s.osm_id, s.name, s.kind,
    extensions.st_y(s.point::extensions.geometry), extensions.st_x(s.point::extensions.geometry),
    s.address, s.website, s.hours, s.party
  from shown s
  cross join here
  where extensions.st_dwithin(s.point, here.g, least(radius_m, 60000))
    and s.hours is not null
  order by extensions.st_distance(s.point, here.g)
  limit least(greatest(max_places, 1), 10000);
$$;
revoke all on function places_area(double precision, double precision, double precision, integer)
  from public;
grant execute on function places_area(double precision, double precision, double precision, integer)
  to service_role;

-- The export covers the places an account added and every change it made to places.
alter function account_export(uuid) rename to account_export_m28;
create function account_export(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select account_export_m28(p_user) || jsonb_build_object(
    'places', jsonb_build_object(
      'added', (
        select coalesce(jsonb_agg(jsonb_build_object('id', p.osm_id, 'name', p.name,
          'kind', p.kind, 'address', p.address, 'website', p.website,
          'openingHours', p.opening_hours) order by p.osm_id), '[]'::jsonb)
        from places p where p.added_by = p_user),
      'changes', (
        select coalesce(jsonb_agg(jsonb_build_object('placeId', l.place_id, 'action', l.action,
          'value', l.value, 'at', l.at) order by l.at), '[]'::jsonb)
        from place_log l where l.user_id = p_user)))
$$;
revoke all on function account_export(uuid), account_export_m28(uuid)
  from public, anon, authenticated;
grant execute on function account_export(uuid), account_export_m28(uuid) to service_role;
