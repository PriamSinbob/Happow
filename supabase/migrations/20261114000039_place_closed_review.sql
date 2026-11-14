-- Closed for good is a report, not a removal: one angry account must not take a place off the map.
-- An account reports it from within `places.closed.withinM` of the spot (its phone's position);
-- the place stays on the map with "Reported closed" on its card and goes to the moderators. It
-- leaves the map once `places.closed.reports` different accounts reported it within
-- `places.closed.days`, or at once when a moderator does. "It's still open" or new hours clear the
-- reports. A moderator keeps a closed place closed or opens it again from the queue.
-- place_log actions now also include 'report' (value: metres from the spot) and 'checked'.

create table place_closed_reports (
  place_id text not null references places (osm_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  -- Metres from the place when reported; null for a closure made before reports existed.
  distance_m real,
  primary key (place_id, user_id)
);
alter table place_closed_reports enable row level security;

-- One account's report, from (p_lat, p_lng). → {closed, reports, distanceM, tooFar}: tooFar when
-- the position is more than p_within_m from the place (nothing is stored then). p_now (a
-- moderator) closes it at once. P0002: no such place.
create function place_report_closed(
  p_user uuid,
  p_place text,
  p_lat double precision,
  p_lng double precision,
  p_within_m double precision,
  p_needed integer,
  p_days integer,
  p_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_dist double precision;
  v_count integer;
  v_closed boolean;
begin
  select extensions.st_distance(p.point,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
    into v_dist
  from places p where p.osm_id = p_place;
  if not found then
    raise exception 'no such place' using errcode = 'P0002';
  end if;
  if v_dist > p_within_m then
    return jsonb_build_object('closed', false, 'reports', 0, 'distanceM', round(v_dist),
      'tooFar', true);
  end if;
  delete from place_closed_reports
  where place_id = p_place and at < now() - make_interval(days => p_days);
  insert into place_closed_reports (place_id, user_id, distance_m)
  values (p_place, p_user, v_dist)
  on conflict (place_id, user_id) do update set at = now(), distance_m = excluded.distance_m;
  insert into place_log (place_id, user_id, action, value)
  values (p_place, p_user, 'report', round(v_dist)::text);
  select count(*) into v_count from place_closed_reports where place_id = p_place;
  v_closed := p_now or v_count >= p_needed;
  if v_closed then
    insert into place_changes (place_id, closed, updated_by) values (p_place, true, p_user)
    on conflict (place_id) do update set closed = true, updated_by = excluded.updated_by,
      updated_at = now();
    insert into place_log (place_id, user_id, action) values (p_place, p_user, 'closed');
  end if;
  return jsonb_build_object('closed', v_closed, 'reports', v_count, 'distanceM', round(v_dist),
    'tooFar', false);
end;
$$;

-- "It's still open" (or new hours): the reports are cleared. A place that is closed already is
-- left as it is unless p_reopen (a moderator). Logged as 'open' when anything changed.
create function place_reports_clear(p_user uuid, p_place text, p_reopen boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_open integer := 0;
begin
  -- A closed place keeps its reports for the moderators unless one opens it.
  if not p_reopen and exists (select 1 from place_changes where place_id = p_place and closed) then
    return;
  end if;
  delete from place_closed_reports where place_id = p_place;
  get diagnostics v_n = row_count;
  if p_reopen then
    update place_changes set closed = false, updated_by = p_user, updated_at = now()
    where place_id = p_place and closed;
    get diagnostics v_open = row_count;
  end if;
  if v_n + v_open > 0 then
    insert into place_log (place_id, user_id, action) values (p_place, p_user, 'open');
  end if;
end;
$$;

-- The moderators' list: places reported closed and still on the map, and places closed (by
-- reports or a moderator) that no moderator has looked at since, newest first, with who reported
-- them (emails).
create function place_closed_queue(p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.reported_at desc), '[]'::jsonb) from (
    select p.osm_id as id, p.name, p.kind, p.address,
      coalesce(c.closed, false) as closed,
      max(r.at) as reported_at,
      count(r.user_id)::int as reports,
      coalesce(jsonb_agg(u.email order by r.at) filter (where u.email is not null), '[]'::jsonb)
        as reported_by
    from places p
    join place_closed_reports r on r.place_id = p.osm_id
    left join place_changes c on c.place_id = p.osm_id
    left join auth.users u on u.id = r.user_id
    where (coalesce(c.closed, false) or r.at > now() - make_interval(days => p_days))
      and not exists (
        select 1 from place_log k
        where k.place_id = p.osm_id and k.action = 'checked'
          and k.at > (select max(r2.at) from place_closed_reports r2 where r2.place_id = p.osm_id)
      )
    group by p.osm_id, p.name, p.kind, p.address, c.closed
    order by max(r.at) desc
    limit 200
  ) q
$$;

-- A moderator's decision on a reported or closed place: 'approve' closes it (or keeps it closed),
-- 'reject' clears the reports and opens it again.
create function moderate_place(p_place text, p_action text, p_moderator text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if not exists (select 1 from places where osm_id = p_place) then
    raise exception 'no such place' using errcode = 'P0002';
  end if;
  if p_action = 'reject' then
    delete from place_closed_reports where place_id = p_place;
    update place_changes set closed = false, updated_by = null, updated_at = now()
    where place_id = p_place;
    insert into place_log (place_id, action, value)
    values (p_place, 'open', 'moderator:' || p_moderator);
  else
    insert into place_changes (place_id, closed) values (p_place, true)
    on conflict (place_id) do update set closed = true, updated_at = now();
    insert into place_log (place_id, action, value) values (p_place, 'checked', p_moderator);
  end if;
end;
$$;

revoke all on function place_report_closed(uuid, text, double precision, double precision,
  double precision, integer, integer, boolean), place_reports_clear(uuid, text, boolean),
  place_closed_queue(integer), moderate_place(text, text, text)
  from public, anon, authenticated;
grant execute on function place_report_closed(uuid, text, double precision, double precision,
  double precision, integer, integer, boolean), place_reports_clear(uuid, text, boolean),
  place_closed_queue(integer), moderate_place(text, text, text) to service_role;

-- The map read, as before, plus closed_reports: fresh reports (within report_days) on a place
-- still shown, for "Reported closed" on its card.
drop function places_area(double precision, double precision, double precision, integer);
create function places_area(
  lat double precision,
  lng double precision,
  radius_m double precision,
  max_places integer default 3000,
  report_days integer default 30
)
returns table (
  id text, name text, kind text, lat double precision, lng double precision, address text,
  website text, opening_hours text, private_until timestamptz, closed_reports integer
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
    s.address, s.website, s.hours, s.party,
    (select count(*)::int from place_closed_reports r
      where r.place_id = s.osm_id and r.at > now() - make_interval(days => report_days))
  from shown s
  cross join here
  where extensions.st_dwithin(s.point, here.g, least(radius_m, 60000))
    and s.hours is not null
  order by extensions.st_distance(s.point, here.g)
  limit least(greatest(max_places, 1), 10000);
$$;
revoke all on function places_area(double precision, double precision, double precision, integer,
  integer) from public;
grant execute on function places_area(double precision, double precision, double precision,
  integer, integer) to service_role;

-- The export also covers the account's closed-for-good reports.
alter function account_export(uuid) rename to account_export_m39;
create function account_export(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select account_export_m39(p_user) || jsonb_build_object(
    'placeClosedReports', (
      select coalesce(jsonb_agg(jsonb_build_object('placeId', r.place_id, 'at', r.at,
        'distanceM', r.distance_m) order by r.at), '[]'::jsonb)
      from place_closed_reports r where r.user_id = p_user))
$$;
revoke all on function account_export(uuid), account_export_m39(uuid)
  from public, anon, authenticated;
grant execute on function account_export(uuid), account_export_m39(uuid) to service_role;

-- Places closed with one tap before reports existed: back on the map, the closure kept as one
-- report from the account that made it.
insert into place_closed_reports (place_id, user_id, at, distance_m)
select c.place_id, l.user_id, l.at, null
from place_changes c
cross join lateral (
  select g.user_id, g.at from place_log g
  where g.place_id = c.place_id and g.action = 'closed'
  order by g.at desc limit 1
) l
where c.closed and l.user_id is not null
on conflict do nothing;
update place_changes set closed = false, updated_at = now() where closed;
