-- Happow: one compact, cacheable snapshot per area instead of a query per user and refresh.
-- The API server asks for every listed event around a grid point for the next hours; phones
-- filter it locally (radius, time window, categories, price) and count hotspots themselves.
-- Long fields (description, image, venue website, source page) come with the detail view.

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
  flag_count integer, flag_at timestamptz
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
    e.last_seen_at, e.primary_source_id, e.verified, e.flag_reason, e.flag_count, e.flag_at
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

grant execute on function events_area(double precision, double precision, double precision, timestamptz, timestamptz, integer)
  to anon, authenticated, service_role;
