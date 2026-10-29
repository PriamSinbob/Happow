-- M12 slice I: recurring events by pattern (docs/milestones/M12-more-events.md §4.5). A weekly
-- pattern is stored as one submission and one event per date, linked by series_id. The dates go
-- in together or not at all (each counts against the monthly quota); moderators decide a series
-- once; everything after that (reports, cancelling, hiding) stays per date.

alter table submissions add column series_id uuid;
create index submissions_series_idx on submissions (series_id) where series_id is not null;

-- Stores every date of a series in one transaction: p_items is [{ id, form, normalized }], as
-- submit_event takes one. Returns [{ id, eventId }] in the given order.
create function submit_series(p_series uuid, p_items jsonb, p_submitter text, p_region text,
  p_publish boolean, p_user uuid, p_month date, p_max integer, p_trusted boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  sid uuid;
  eid text;
  done jsonb := '[]'::jsonb;
begin
  for item in select value from jsonb_array_elements(p_items) loop
    sid := submit_event(item, p_submitter, p_region, p_publish, p_user, p_month, p_max, p_trusted);
    update submissions set series_id = p_series where id = sid returning event_id into eid;
    done := done || jsonb_build_array(jsonb_build_object('id', sid, 'eventId', eid));
  end loop;
  return done;
end $$;

-- Approves or rejects every pending date of a series, earliest first. Returns what
-- moderate_submission returned for each.
create function moderate_series(p_series uuid, p_action text, p_note text, p_moderator text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  done jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from submissions where series_id = p_series) then
    raise exception 'unknown series' using errcode = 'P0002';
  end if;
  for sid in
    select id from submissions where series_id = p_series and status = 'pending'
    order by extracted_payload -> 'event' ->> 'startAt', id
  loop
    done := done || jsonb_build_array(moderate_submission(sid, p_action, p_note, p_moderator));
  end loop;
  if jsonb_array_length(done) = 0 then
    raise exception 'already reviewed' using errcode = 'P0001';
  end if;
  return done;
end $$;

-- The queue as before, with each submission's series.
create or replace function moderation_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with open_reports as (
    select * from reports where resolved_at is null
  ),
  per_reason as (
    select event_id, jsonb_object_agg(reason, n) as reasons
    from (select event_id, reason, count(*)::int as n from open_reports group by 1, 2) x
    group by event_id
  ),
  per_event as (
    select event_id, count(*)::int as count, max(created_at) as last_at,
      (array_agg(note order by created_at desc) filter (where note is not null))[1:5] as notes
    from open_reports group by event_id
  ),
  missing as (
    select id as event_id, source_missing_at from events
    where source_missing_at is not null and not hidden and status = 'scheduled' and end_at > now()
  ),
  flagged as (
    select coalesce(p.event_id, m.event_id) as event_id, coalesce(p.count, 0) as count,
      greatest(p.last_at, m.source_missing_at) as last_at,
      coalesce(pr.reasons, '{}'::jsonb)
        || case when m.event_id is null then '{}'::jsonb else '{"source_missing": 1}'::jsonb end
        as reasons,
      p.notes
    from per_event p
    join per_reason pr using (event_id)
    full join missing m on m.event_id = p.event_id
  )
  select jsonb_build_object(
    'submissions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc) from (
        select id, kind, source_id, url, confidence, event_id, created_at, series_id,
          left(submitter_hash, 8) as submitter, extracted_payload -> 'event' as event,
          extracted_payload -> 'venue' as venue, form_payload as form
        from submissions where status = 'pending' order by created_at desc limit 200) s), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.last_at desc) from (
        select f.event_id, e.title, e.start_at, e.status, e.hidden, e.trust, e.verified,
          v.name as venue_name, f.count, f.last_at, f.reasons, f.notes
        from flagged f
        join events e on e.id = f.event_id
        left join venues v on v.id = e.venue_id
        order by f.last_at desc limit 100) r), '[]'::jsonb));
$$;

-- The account card's events as before, each with its series.
create or replace function contributions_get(p_user uuid, p_month date, p_trusted_after integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select s.id, s.event_id, s.status, s.reviewed_by, s.created_at, s.series_id,
      coalesce(e.title, s.form_payload ->> 'title') as title, e.start_at, e.verified, e.hidden,
      c.kind, c.days, c.revoked_at
    from submissions s
    left join events e on e.id = s.event_id
    left join contributions c on c.submission_id = s.id
    where s.user_id = p_user and s.kind = 'user'
  ), counted as (
    select m.*, coalesce(sum(ec.opens), 0)::int as opens, coalesce(sum(ec.routes), 0)::int as routes,
      coalesce(sum(ec.arrivals), 0)::int as arrivals
    from mine m left join event_counts ec on ec.event_id = m.event_id
    group by m.id, m.event_id, m.status, m.reviewed_by, m.created_at, m.series_id, m.title,
      m.start_at, m.verified, m.hidden, m.kind, m.days, m.revoked_at
  )
  select jsonb_build_object(
    'verified', (select count(*) from counted where kind = 'verified' and revoked_at is null),
    'opens', (select coalesce(sum(opens), 0) from counted where kind = 'verified' and revoked_at is null),
    'routes', (select coalesce(sum(routes), 0) from counted),
    'arrivals', (select coalesce(sum(arrivals), 0) from counted),
    'trusted', contributor_trusted(p_user, p_trusted_after),
    'monthDays', (select coalesce(sum(days), 0) from contributions
      where user_id = p_user and month = p_month and revoked_at is null),
    'level', (select level from profiles where user_id = p_user),
    'showName', coalesce((select show_name from profiles where user_id = p_user), false),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'submissionId', id, 'seriesId', series_id, 'eventId', event_id, 'title', title,
        'startAt', start_at, 'status', status, 'trusted', reviewed_by = 'trusted',
        'hidden', coalesce(hidden, false),
        'reward', case when revoked_at is not null then 'revoked' else kind end,
        'days', coalesce(days, 0), 'opens', opens, 'routes', routes, 'arrivals', arrivals
      ) order by created_at desc, start_at) from (
        select * from counted order by created_at desc, start_at limit 200) x),
      '[]'::jsonb)
  )
$$;

revoke all on function submit_series(uuid, jsonb, text, text, boolean, uuid, date, integer, boolean),
  moderate_series(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function submit_series(uuid, jsonb, text, text, boolean, uuid, date, integer, boolean),
  moderate_series(uuid, text, text, text)
  to service_role;
