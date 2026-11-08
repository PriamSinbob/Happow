-- M9 slice B: the map on a shared event's preview image (docs/milestones/M9-sharing-attendance.md
-- §2, owner's answer to §9.1). The Worker draws the district outlines around the event's point
-- instead of map tiles, so the image needs no tile service.

-- The districts within p_radius_m of a point, simplified to about 10 m, as GeoJSON geometries.
-- `here` marks the district the point is in. Read only by the Worker (service role).
create function district_outlines(p_lat double precision, p_lng double precision, p_radius_m double precision)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with here as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326) as g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', d.name,
    'here', st_covers(d.polygon, here.g),
    'geometry', st_asgeojson(st_simplifypreservetopology(d.polygon, 0.0001), 5)::jsonb
  ) order by d.id), '[]'::jsonb)
  from districts d
  cross join here
  where st_dwithin(d.polygon::geography, here.g::geography, least(p_radius_m, 5000))
$$;

revoke all on function district_outlines(double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function district_outlines(double precision, double precision, double precision) to service_role;
