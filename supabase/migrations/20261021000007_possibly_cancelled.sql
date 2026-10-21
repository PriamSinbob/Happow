-- Happow: "possibly cancelled". Sources that return every event they have in the fetch window
-- (config `completeListing`) count, per listing, the runs in a row that no longer returned it.
-- When the event's primary listing has been missing long enough, the event gets the warning
-- slot that community reports use, with reason 'source_missing' and no reporter count. A later
-- run that finds the listing again, or a moderator's dismissal, clears it.

alter table event_sources add column missed_runs integer not null default 0;

alter table events add column source_missing_at timestamptz;

-- Community reports win over the source signal: they are newer, first-hand information.
create or replace function refresh_event_flag(p_event text)
returns void
language sql
security definer
set search_path = public
as $$
  with open_status as (
    select reason::text as reason, created_at from reports
    where event_id = p_event and resolved_at is null
      and reason::text in ('cancelled', 'venue_closed', 'weather', 'moved')
  )
  update events set
    flag_count = (select count(*) from open_status),
    flag_at = coalesce((select max(created_at) from open_status),
      case when source_missing_at is not null then source_missing_at end),
    flag_reason = coalesce((select reason from open_status group by reason
                            order by count(*) desc, max(created_at) desc limit 1),
      case when source_missing_at is not null then 'source_missing' end)
  where id = p_event;
$$;

-- Dismissing a flag also dismisses the source signal, so a moderator who checked the event is
-- not overruled by the next run (a later miss streak starts again from zero).
create or replace function resolve_reports(p_event text, p_action text, p_note text, p_moderator text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  res text := case p_action when 'dismiss' then 'dismissed' when 'cancel' then 'cancelled'
    when 'hide' then 'hidden' end;
begin
  if res is null then raise exception 'unknown action %', p_action using errcode = '22023'; end if;
  if p_action = 'cancel' then update events set status = 'cancelled' where id = p_event; end if;
  if p_action = 'hide' then update events set hidden = true where id = p_event; end if;
  if p_action = 'dismiss' then
    update events set source_missing_at = null where id = p_event;
    update event_sources set missed_runs = 0 where event_id = p_event;
  end if;
  update reports set resolved_at = now(), resolution = res, resolved_by = p_moderator
  where event_id = p_event and resolved_at is null;
  get diagnostics n = row_count;
  perform refresh_event_flag(p_event);
  return n;
end $$;

revoke all on function refresh_event_flag(text) from public, anon, authenticated;

-- Moderators also see upcoming events a source stopped listing (reason source_missing), next to
-- the reported ones; dismissing clears the signal, "mark cancelled" confirms it.
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
        select id, kind, source_id, url, confidence, event_id, created_at,
          left(submitter_hash, 8) as submitter, extracted_payload -> 'event' as event,
          extracted_payload -> 'venue' as venue, form_payload as form
        from submissions where status = 'pending' order by created_at desc limit 100) s), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.last_at desc) from (
        select f.event_id, e.title, e.start_at, e.status, e.hidden, e.trust, e.verified,
          v.name as venue_name, f.count, f.last_at, f.reasons, f.notes
        from flagged f
        join events e on e.id = f.event_id
        left join venues v on v.id = e.venue_id
        order by f.last_at desc limit 100) r), '[]'::jsonb));
$$;
