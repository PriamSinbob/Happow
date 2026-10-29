-- M12 slice L: calendar feed import for an account (docs/milestones/M12-more-events.md §4.6).
-- An account adds an iCal URL; the ingest job reads it on its schedule and its events come in as
-- the account's submissions, counting against the monthly quota. The first batch goes to
-- moderation; once a moderator approves one of its events, later ones follow the account's trust.
-- An admin can stop a feed. Imported events earn no premium days.

create table account_feeds (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  region_id text not null references regions (id),
  url text not null,
  status text not null default 'active' check (status in ('active', 'stopped')),
  -- A moderator approved one of its events: later ones follow the account's trust.
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_error text,
  last_events integer,
  stopped_by text,
  stopped_at timestamptz,
  unique (user_id, url)
);
alter table account_feeds enable row level security;

alter table submissions add column feed_id bigint references account_feeds (id) on delete set null;
-- One submission per feed event (its UID and start), so a run never imports one twice.
alter table submissions add column feed_key text;
create unique index submissions_feed_key_idx on submissions (feed_id, feed_key)
  where feed_id is not null;

create function feed_json(f account_feeds)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('id', f.id, 'url', f.url, 'status', f.status, 'approved', f.approved,
    'createdAt', f.created_at, 'lastRunAt', f.last_run_at, 'lastError', f.last_error,
    'lastEvents', f.last_events,
    'imported', (select count(*) from submissions s where s.feed_id = f.id))
$$;

create function feeds_list(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(feed_json(f) order by f.created_at), '[]'::jsonb)
  from account_feeds f where f.user_id = p_user
$$;

-- Adds a feed, at most p_max per account; a stopped one can't be added again.
create function feed_add(p_user uuid, p_url text, p_region text, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f account_feeds;
begin
  perform 1 from auth.users where id = p_user for update;
  select * into f from account_feeds where user_id = p_user and url = p_url;
  if found then
    if f.status = 'stopped' then raise exception 'feed stopped' using errcode = 'HQ003'; end if;
    return feed_json(f);
  end if;
  if (select count(*) from account_feeds where user_id = p_user) >= p_max then
    raise exception 'too many feeds' using errcode = 'HQ002';
  end if;
  insert into account_feeds (user_id, region_id, url) values (p_user, p_region, p_url)
  returning * into f;
  return feed_json(f);
end $$;

-- Removes the account's own feed; its events stay, as any submission does.
create function feed_remove(p_user uuid, p_id bigint)
returns boolean
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from account_feeds where id = p_id and user_id = p_user and status = 'active'
    returning 1)
  select exists (select 1 from gone)
$$;

-- Active feeds in a region for the ingest job, the longest unread first.
create function feeds_due(p_region text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.user_id, 'url', f.url,
      'approved', f.approved) order by f.last_run_at nulls first, f.id), '[]'::jsonb)
  from account_feeds f where f.region_id = p_region and f.status = 'active'
$$;

-- Imports one feed event as the account's submission, unless the feed already gave it. It goes
-- through submit_event, so it counts against the month (HQ001 when used up) and is published
-- before moderation when config says so. Trusted only once the feed was approved.
create function feed_import(p_feed bigint, p_key text, p jsonb, p_submitter text,
  p_publish boolean, p_month date, p_max integer, p_trusted_after integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f account_feeds;
  sid uuid;
  v_trusted boolean;
begin
  select * into f from account_feeds where id = p_feed and status = 'active';
  if not found then return null; end if;
  if exists (select 1 from submissions where feed_id = p_feed and feed_key = p_key) then
    return null;
  end if;
  v_trusted := f.approved and contributor_trusted(f.user_id, p_trusted_after);
  sid := submit_event(p, p_submitter, f.region_id, p_publish, f.user_id, p_month, p_max, v_trusted);
  update submissions set feed_id = p_feed, feed_key = p_key where id = sid;
  return jsonb_build_object('id', sid, 'trusted', v_trusted);
end $$;

-- After a run: what it gave, or why it stopped.
create function feed_record(p_feed bigint, p_error text, p_events integer)
returns void
language sql
security definer
set search_path = public
as $$
  update account_feeds set last_run_at = now(), last_error = p_error, last_events = p_events
  where id = p_feed
$$;

-- An admin stops a feed (or starts it again); its events stay.
create function feed_set_status(p_feed bigint, p_status text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f account_feeds;
begin
  update account_feeds set status = p_status,
    stopped_by = case when p_status = 'stopped' then p_by end,
    stopped_at = case when p_status = 'stopped' then now() end
  where id = p_feed returning * into f;
  if not found then raise exception 'unknown feed' using errcode = 'P0002'; end if;
  return feed_json(f);
end $$;

-- The first approved event makes the feed trusted for later ones (with the account's trust).
create function feed_approved_on_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.feed_id is not null and new.status = 'approved' and new.reviewed_by is distinct from 'trusted' then
    update account_feeds set approved = true where id = new.feed_id;
  end if;
  return new;
end $$;
create trigger submissions_feed_approved after update of status on submissions
  for each row when (old.status is distinct from new.status)
  execute function feed_approved_on_review();

-- The queue as before, with each submission's feed so moderators see where it came from.
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
        select s.id, s.kind, s.source_id, s.url, s.confidence, s.event_id, s.created_at,
          s.series_id, s.feed_id, f.url as feed_url, f.status as feed_status,
          left(s.submitter_hash, 8) as submitter, s.extracted_payload -> 'event' as event,
          s.extracted_payload -> 'venue' as venue, s.form_payload as form
        from submissions s left join account_feeds f on f.id = s.feed_id
        where s.status = 'pending' order by s.created_at desc limit 200) s), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.last_at desc) from (
        select f.event_id, e.title, e.start_at, e.status, e.hidden, e.trust, e.verified,
          v.name as venue_name, f.count, f.last_at, f.reasons, f.notes
        from flagged f
        join events e on e.id = f.event_id
        left join venues v on v.id = e.venue_id
        order by f.last_at desc limit 100) r), '[]'::jsonb));
$$;

-- Imported events earn no premium days: otherwise as before.
create or replace function contribution_award(
  p_submission uuid, p_duplicate_of text, p_per_event integer, p_cap integer, p_month date,
  p_not_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s submissions;
  earned integer;
  v_days integer := 0;
  v_start timestamptz;
  v_grant uuid;
begin
  select * into s from submissions where id = p_submission;
  if not found or s.user_id is null or s.feed_id is not null then
    return null;
  end if;
  -- One award at a time per account, so two approvals can't both pass the cap.
  insert into profiles (user_id) values (s.user_id) on conflict (user_id) do nothing;
  perform 1 from profiles where user_id = s.user_id for update;
  if exists (select 1 from contributions where submission_id = p_submission) then
    return null;
  end if;
  if p_duplicate_of is null then
    select coalesce(sum(days), 0) into earned from contributions
    where user_id = s.user_id and month = p_month and revoked_at is null;
    v_days := greatest(0, least(p_per_event, p_cap - earned));
  end if;
  if v_days > 0 then
    select greatest(now(), coalesce(p_not_before, now()), coalesce(max(ends_at), now())) into v_start
    from plan_grants where user_id = s.user_id and plan = 'premium' and ends_at > now();
    insert into plan_grants (user_id, plan, source, starts_at, ends_at, note)
    values (s.user_id, 'premium', 'contribution', v_start, v_start + make_interval(days => v_days),
      'verified event')
    returning id into v_grant;
  end if;
  insert into contributions (user_id, submission_id, event_id, kind, duplicate_of, days, grant_id,
    month)
  values (s.user_id, p_submission, s.event_id,
    case when p_duplicate_of is null then 'verified' else 'duplicate' end, p_duplicate_of,
    v_days, v_grant, p_month);
  return jsonb_build_object('kind', case when p_duplicate_of is null then 'verified' else 'duplicate' end,
    'days', v_days, 'startsAt', v_start);
end $$;

revoke all on function feed_json(account_feeds), feeds_list(uuid),
  feed_add(uuid, text, text, integer), feed_remove(uuid, bigint), feeds_due(text),
  feed_import(bigint, text, jsonb, text, boolean, date, integer, integer),
  feed_record(bigint, text, integer), feed_set_status(bigint, text, text),
  feed_approved_on_review()
  from public, anon, authenticated;
grant execute on function feed_json(account_feeds), feeds_list(uuid),
  feed_add(uuid, text, text, integer), feed_remove(uuid, bigint), feeds_due(text),
  feed_import(bigint, text, jsonb, text, boolean, date, integer, integer),
  feed_record(bigint, text, integer), feed_set_status(bigint, text, text)
  to service_role;
