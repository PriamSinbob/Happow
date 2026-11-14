-- A place added where one of a similar name already stands gets the hours instead of a duplicate.
-- Before, only the same name counted: "śluza bar cafe" next to OpenStreetMap's "Śluza" (listed
-- without hours) made a second place. Now one name containing the other counts too, when the
-- shorter one has at least 4 letters, so "Bar" alone never matches.

create or replace function place_add(
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
  v_name text := lower(btrim(p_name));
  v_id text;
  v_base text;
begin
  select p.osm_id, p.opening_hours into v_id, v_base
  from places p
  where extensions.st_dwithin(p.point, g, p_same_m)
    and (
      lower(p.name) = v_name
      or (least(length(p.name), length(v_name)) >= 4
        and (strpos(v_name, lower(p.name)) > 0 or strpos(lower(p.name), v_name) > 0))
    )
  order by lower(p.name) = v_name desc, extensions.st_distance(p.point, g)
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
