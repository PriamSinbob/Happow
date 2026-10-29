-- M12 slice O: the admin's coverage view (docs/milestones/M12-more-events.md §3). Live events per
-- district and category for today and the week (now to the end of day 7, as m12_metrics counts),
-- the emptiest districts first, with the five metrics now and their weekly rows.
create function coverage(p_region text, p_at timestamptz, p_evening_hour integer default 18,
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
    where e.region_id = p_region and e.status <> 'cancelled' and not e.hidden
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

revoke all on function coverage(text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function coverage(text, timestamptz, integer, integer) to service_role;
