-- Places from a photo, without an account.
-- A device without an account may add a place, or new hours for one already listed, with the pass
-- from reading a photo of its door (POST /api/places/photo). The log then keeps the salted device
-- hash instead of an account, so a moderator can still see what one device did.

alter table place_log add column device text;
create index place_log_device_idx on place_log (device, at desc) where device is not null;

-- As before, with p_device: who did it when p_user is null.
drop function place_add(uuid, text, text, text, double precision, double precision, text, text,
  text, double precision);
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
  p_same_m double precision,
  p_device text default null
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
    insert into place_log (place_id, user_id, device, action, value)
    values (v_id, p_user, p_device, 'hours', p_hours);
    return v_id;
  end if;
  v_id := 'user/' || gen_random_uuid();
  insert into places (osm_id, region_id, name, kind, point, address, website, opening_hours,
    source, added_by)
  values (v_id, p_region, p_name, p_kind, g, p_address, p_website, p_hours, 'user', p_user);
  insert into place_log (place_id, user_id, device, action, value)
  values (v_id, p_user, p_device, 'add', p_name);
  return v_id;
end;
$$;
revoke all on function place_add(uuid, text, text, text, double precision, double precision, text,
  text, text, double precision, text) from public;
grant execute on function place_add(uuid, text, text, text, double precision, double precision,
  text, text, text, double precision, text) to service_role;

drop function place_change(uuid, text, text, boolean, boolean, timestamptz);
create function place_change(
  p_user uuid,
  p_place text,
  p_hours text default null,
  p_closed boolean default null,
  p_private boolean default null,
  p_private_until timestamptz default null,
  p_device text default null
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
    insert into place_log (place_id, user_id, device, action, value)
    values (p_place, p_user, p_device, 'hours', p_hours);
  end if;
  if p_closed is not null then
    update place_changes set closed = p_closed where place_id = p_place;
    insert into place_log (place_id, user_id, device, action)
    values (p_place, p_user, p_device, case when p_closed then 'closed' else 'open' end);
  end if;
  if p_private is not null then
    update place_changes
    set private_until = case when p_private then p_private_until end
    where place_id = p_place;
    insert into place_log (place_id, user_id, device, action, value)
    values (p_place, p_user, p_device, case when p_private then 'private' else 'public' end,
      p_private_until::text);
  end if;
end;
$$;
revoke all on function place_change(uuid, text, text, boolean, boolean, timestamptz, text)
  from public;
grant execute on function place_change(uuid, text, text, boolean, boolean, timestamptz, text)
  to service_role;
