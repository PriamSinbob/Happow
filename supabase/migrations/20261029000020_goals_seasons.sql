-- M12 slice N: district goals and season collections (docs/milestones/M12-more-events.md §6.2,
-- §6.3). The empty list and its guidance card may say how many events the district you're in has
-- this weekend; seasons are config, matched in the app, and the account card counts the adder's
-- events in a running season, so its events carry their end and categories.

-- The district containing a point and its live events overlapping [p_from, p_to). Public: it
-- gives a count and a name, nothing about anyone.
create function district_goal(p_region text, p_lat double precision, p_lng double precision,
  p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('id', d.id, 'name', d.name, 'count', (
      select count(*) from events e
      where e.region_id = p_region and not e.hidden and e.status <> 'cancelled'
        and e.start_at < p_to and e.end_at > p_from
        and st_covers(d.polygon, e.point::geometry)))
  from districts d
  where d.region_id = p_region and st_covers(d.polygon, st_setsrid(st_point(p_lng, p_lat), 4326))
  limit 1
$$;

-- The account card as before, each event with its end and categories.
create or replace function contributions_get(p_user uuid, p_month date, p_trusted_after integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select s.id, s.event_id, s.status, s.reviewed_by, s.created_at, s.series_id, s.first_place,
      coalesce(e.title, s.form_payload ->> 'title') as title, e.start_at, e.end_at,
      e.category_ids, e.verified, e.hidden,
      c.kind, c.days, c.revoked_at
    from submissions s
    left join events e on e.id = s.event_id
    left join contributions c on c.submission_id = s.id
    where s.user_id = p_user and s.kind = 'user'
  ), counted as (
    select m.*, coalesce(sum(ec.opens), 0)::int as opens, coalesce(sum(ec.routes), 0)::int as routes,
      coalesce(sum(ec.arrivals), 0)::int as arrivals,
      (select count(*) from event_thanks t where t.event_id = m.event_id)::int as thanks
    from mine m left join event_counts ec on ec.event_id = m.event_id
    group by m.id, m.event_id, m.status, m.reviewed_by, m.created_at, m.series_id, m.first_place,
      m.title, m.end_at, m.category_ids,
      m.start_at, m.verified, m.hidden, m.kind, m.days, m.revoked_at
  )
  select jsonb_build_object(
    'verified', (select count(*) from counted where kind = 'verified' and revoked_at is null),
    'opens', (select coalesce(sum(opens), 0) from counted where kind = 'verified' and revoked_at is null),
    'routes', (select coalesce(sum(routes), 0) from counted),
    'arrivals', (select coalesce(sum(arrivals), 0) from counted),
    'thanks', (select coalesce(sum(thanks), 0) from counted),
    'trusted', contributor_trusted(p_user, p_trusted_after),
    'monthDays', (select coalesce(sum(days), 0) from contributions
      where user_id = p_user and month = p_month and revoked_at is null),
    'level', (select level from profiles where user_id = p_user),
    'showName', coalesce((select show_name from profiles where user_id = p_user), false),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'submissionId', id, 'seriesId', series_id, 'eventId', event_id, 'title', title,
        'startAt', start_at, 'endAt', end_at, 'categoryIds', to_jsonb(coalesce(category_ids, '{}')), 'status', status, 'trusted', reviewed_by = 'trusted',
        'hidden', coalesce(hidden, false),
        'reward', case when revoked_at is not null then 'revoked' else kind end,
        'days', coalesce(days, 0), 'opens', opens, 'routes', routes, 'arrivals', arrivals,
        'thanks', thanks, 'firstPlace', coalesce(first_place, false)
      ) order by created_at desc, start_at) from (
        select * from counted order by created_at desc, start_at limit 200) x),
      '[]'::jsonb)
  )
$$;

grant execute on function district_goal(text, double precision, double precision, timestamptz, timestamptz)
  to anon, authenticated, service_role;
