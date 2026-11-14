-- Places whose opening hours are unknown: OpenStreetMap lists about half the region's places
-- without hours, and a place without hours never shows as open. The map shows them close in as
-- hollow pins, so people can add the hours from a photo of the door. Same area and corrections
-- as places_area: a place closed for good is left out, and one with corrected hours is no longer
-- unknown.
create function places_unknown(
  lat double precision,
  lng double precision,
  radius_m double precision,
  max_places integer default 3000
)
returns table (
  id text, name text, kind text, lat double precision, lng double precision, address text,
  website text
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
      ) as hours
    from places p
    left join place_changes c on c.place_id = p.osm_id
    where not coalesce(c.closed, false)
  )
  select
    s.osm_id, s.name, s.kind,
    extensions.st_y(s.point::extensions.geometry), extensions.st_x(s.point::extensions.geometry),
    s.address, s.website
  from shown s
  cross join here
  where extensions.st_dwithin(s.point, here.g, least(radius_m, 60000))
    and s.hours is null
  order by extensions.st_distance(s.point, here.g)
  limit least(greatest(max_places, 1), 10000);
$$;
revoke all on function places_unknown(double precision, double precision, double precision, integer)
  from public;
grant execute on function places_unknown(double precision, double precision, double precision,
  integer) to service_role;
