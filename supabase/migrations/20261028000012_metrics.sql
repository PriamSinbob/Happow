-- M12 slice A: how we know M12 worked (docs/milestones/M12-more-events.md §1). Districts come from
-- data/districts/<region>.geojson (loaded by `pnpm db:seed`); m12_metrics() computes the five
-- numbers for one moment, and metrics_save() keeps one row per region and week, called by the
-- Worker's cron and by `pnpm metrics --save`.

create table districts (
  region_id text not null references regions (id) on delete cascade,
  -- The OSM relation id.
  id text not null,
  name text not null,
  polygon extensions.geometry(multipolygon, 4326) not null,
  primary key (region_id, id)
);
create index districts_polygon_idx on districts using gist (polygon);
alter table districts enable row level security;

create table metrics_weekly (
  region_id text not null references regions (id) on delete cascade,
  -- Monday of the week, in the region's time zone.
  week date not null check (extract(isodow from week) = 1),
  measured_at timestamptz not null,
  metrics jsonb not null,
  primary key (region_id, week)
);
alter table metrics_weekly enable row level security;

-- The numbers at p_at, in the region's own time zone, so "today" and "tonight" follow its clock
-- (a 23- or 25-hour day when the clocks change). "Live" = not cancelled and not hidden. Only events and
-- submissions that existed at p_at count, so a past moment can be measured again. Tonight runs from
-- p_evening_hour to midnight.
create function m12_metrics(p_region text, p_at timestamptz, p_evening_hour integer default 18)
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
    where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.created_at <= p_at and e.start_at < t8 and e.end_at > p_at
  ), k as (select count(*) n, count(*) filter (where trust = 'community') c from w)
  select jsonb_build_object(
    'region', p_region,
    'at', p_at,
    'eventsToday', (
      select count(*) from events e
      where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.created_at <= p_at and e.start_at < t1 and e.end_at > t0),
    'events7d', k.n,
    'districts', (select count(*) from districts where region_id = p_region),
    'districtsTonight', (
      select count(distinct ds.id) from districts ds
      join events e on e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.created_at <= p_at
        and e.start_at < t1 and e.end_at > eve and st_covers(ds.polygon, e.point::geometry)
      where ds.region_id = p_region),
    'eventsTonight', (
      select count(*) from events e
      where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden and e.created_at <= p_at and e.start_at < t1 and e.end_at > eve),
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

-- Saves the week's row once: true if it was saved now, false if the week already has one.
create function metrics_save(p_region text, p_at timestamptz, p_evening_hour integer default 18)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tz text := (select timezone from regions where id = p_region);
  wk date;
  ok boolean;
begin
  if tz is null then
    raise exception 'unknown region %', p_region;
  end if;
  wk := date_trunc('week', p_at at time zone tz)::date;
  if exists (select 1 from metrics_weekly where region_id = p_region and week = wk) then
    return false;
  end if;
  insert into metrics_weekly (region_id, week, measured_at, metrics)
  values (p_region, wk, p_at, m12_metrics(p_region, p_at, p_evening_hour))
  on conflict (region_id, week) do nothing
  returning true into ok;
  return coalesce(ok, false);
end $$;

revoke all on function m12_metrics(text, timestamptz, integer), metrics_save(text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function m12_metrics(text, timestamptz, integer), metrics_save(text, timestamptz, integer)
  to service_role;
