-- M12 slice E: contributions on the server (docs/milestones/M12-more-events.md §5). A ledger of
-- verified events every reward reads from: premium days (grants with source 'contribution'),
-- trusted publishing, levels; per-event counts for "your impact"; the opt-in public credit.
-- The Worker passes the numbers from config/plans.json; nothing here is region- or city-specific.

alter table plan_grants drop constraint plan_grants_source_check;
alter table plan_grants add constraint plan_grants_source_check
  check (source in ('manual', 'trial', 'purchase', 'contribution'));

-- One row per account submission that passed moderation or was published by a trusted account.
create table contributions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  submission_id uuid not null unique references submissions (id) on delete cascade,
  event_id text references events (id) on delete set null,
  -- 'duplicate': the same event was already listed by another source; it earns nothing.
  kind text not null check (kind in ('verified', 'duplicate')),
  duplicate_of text,
  days integer not null default 0 check (days >= 0),
  grant_id uuid references plan_grants (id) on delete set null,
  -- The calendar month it was earned in (first day, region time): the monthly cap counts here.
  month date not null check (extract(day from month) = 1),
  created_at timestamptz not null default now(),
  -- Set when the event turned out wrong; days not yet started are taken back.
  revoked_at timestamptz
);
create index contributions_user_idx on contributions (user_id, month);
alter table contributions enable row level security;

-- Totals per event and day: no device or user is stored with them.
create table event_counts (
  event_id text not null references events (id) on delete cascade,
  day date not null,
  opens integer not null default 0 check (opens >= 0),
  routes integer not null default 0 check (routes >= 0),
  arrivals integer not null default 0 check (arrivals >= 0),
  primary key (event_id, day)
);
alter table event_counts enable row level security;

alter table profiles add column show_name boolean not null default false;
-- A rejection removes trust; the admin restores it by stamping this time.
alter table profiles add column trust_restored_at timestamptz;
-- The highest level reached (levels only go up).
alter table profiles add column level text;

-- Trusted: at least p_after approved events and no rejection since trust was last restored.
create function contributor_trusted(p_user uuid, p_after integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from submissions s where s.user_id = p_user and s.kind = 'user'
            and s.status = 'approved') >= p_after
    and not exists (
      select 1 from submissions s left join profiles p on p.user_id = p_user
      where s.user_id = p_user and s.kind = 'user' and s.status = 'rejected'
        and s.reviewed_at > coalesce(p.trust_restored_at, '-infinity'::timestamptz))
$$;

-- Records a submission's reward once. Premium days: p_per_event, never past p_cap in p_month;
-- they start after the account's latest premium end (and not before p_not_before, the end of a
-- running promotion), so earned days stack instead of overlapping. Null if already recorded.
create function contribution_award(
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
  if not found or s.user_id is null then
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

-- The event turned out wrong: its reward stops counting, and days not yet started are taken back.
create function contribution_revoke(p_submission uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c contributions;
  back integer := 0;
begin
  select * into c from contributions where submission_id = p_submission and revoked_at is null
  for update;
  if not found then
    return 0;
  end if;
  if c.grant_id is not null then
    delete from plan_grants where id = c.grant_id and starts_at > now();
    if found then
      back := c.days;
    end if;
  end if;
  update contributions set revoked_at = now() where id = c.id;
  return back;
end $$;

-- Every reward of an event a moderator hid (a report found it wrong).
create function contribution_revoke_event(p_event text)
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(contribution_revoke(c.submission_id)), 0)::integer
  from contributions c where c.event_id = p_event and c.revoked_at is null
$$;

-- Other live events at the same place and time, for the duplicate check (the API compares
-- titles the way ingest's dedup does).
create function duplicate_candidates(p_event text, p_radius_m double precision, p_minutes integer)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('title', e.title, 'others',
    coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title)) filter (where o.id is not null), '[]'::jsonb))
  from events e
  left join events o on o.id <> e.id and not o.hidden and o.status <> 'cancelled'
    and abs(extract(epoch from o.start_at - e.start_at)) <= p_minutes * 60
    and st_dwithin(o.point, e.point, p_radius_m)
    -- Older listings only: a later copy can't make the first one a duplicate.
    and o.created_at <= e.created_at
  where e.id = p_event
  group by e.id, e.title
$$;

-- Submissions now take a trusted flag: a trusted account's event is published verified and
-- recorded as approved by 'trusted', so it skips the queue (moderators still see it).
drop function submit_event(jsonb, text, text, boolean, uuid, date, integer);
create function submit_event(
  p jsonb, p_submitter text, p_region text, p_publish boolean,
  p_user uuid default null, p_month date default null, p_max integer default 0,
  p_trusted boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid := (p ->> 'id')::uuid;
  eid text;
begin
  if p_user is not null and not usage_take(p_user, p_month, 'events', p_max) then
    raise exception 'events quota used up' using errcode = 'HQ001';
  end if;
  insert into submissions (id, kind, url, form_payload, extracted_payload, status, submitter_hash,
    region_id, source_id, external_id, confidence, user_id, reviewed_at, reviewed_by)
  values (sid, 'user', p -> 'form' ->> 'url', p -> 'form', p -> 'normalized',
    case when p_trusted then 'approved'::submission_status else 'pending' end, p_submitter,
    p_region, p -> 'normalized' ->> 'sourceId', sid::text, 1, p_user,
    case when p_trusted then now() end, case when p_trusted then 'trusted' end);
  if p_publish or p_trusted then
    eid := publish_event((p -> 'normalized') || jsonb_build_object('regionId', p_region, 'verified', p_trusted));
    update submissions set event_id = eid where id = sid;
  end if;
  return sid;
end $$;

-- What trusted accounts published lately, for the moderators' spot checks.
create function trusted_recent(p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) from (
    select id, kind, source_id, url, confidence, event_id, created_at,
      left(submitter_hash, 8) as submitter, extracted_payload -> 'event' as event,
      extracted_payload -> 'venue' as venue
    from submissions
    where status = 'approved' and reviewed_by = 'trusted'
      and created_at > now() - make_interval(days => p_days)
    order by created_at desc limit 100) s
$$;

-- A moderator rejects a trusted account's published event: hidden, its reward revoked, and the
-- rejection removes the account's trust (contributor_trusted).
create function moderate_trusted(p_id uuid, p_note text, p_moderator text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s submissions;
begin
  select * into s from submissions where id = p_id for update;
  if not found then raise exception 'unknown submission' using errcode = 'P0002'; end if;
  if s.status <> 'approved' or s.reviewed_by is distinct from 'trusted' then
    raise exception 'already reviewed' using errcode = 'P0001';
  end if;
  update events set hidden = true where id = s.event_id;
  update submissions set status = 'rejected', moderator_note = p_note, reviewed_at = now(),
    reviewed_by = p_moderator where id = p_id;
  perform contribution_revoke(p_id);
  return jsonb_build_object('id', p_id, 'eventId', s.event_id, 'action', 'reject');
end $$;

-- Adds a batch of counts: [{ eventId, opens, routes, arrivals }]. Unknown events are skipped.
create function counts_add(p_items jsonb, p_day date)
returns integer
language sql
security definer
set search_path = public
as $$
  with items as (
    select i ->> 'eventId' as event_id,
      sum(greatest(coalesce((i ->> 'opens')::int, 0), 0)) as opens,
      sum(greatest(coalesce((i ->> 'routes')::int, 0), 0)) as routes,
      sum(greatest(coalesce((i ->> 'arrivals')::int, 0), 0)) as arrivals
    from jsonb_array_elements(p_items) i group by 1
  ), added as (
    insert into event_counts as c (event_id, day, opens, routes, arrivals)
    select i.event_id, p_day, i.opens, i.routes, i.arrivals
    from items i join events e on e.id = i.event_id
    on conflict (event_id, day) do update set opens = c.opens + excluded.opens,
      routes = c.routes + excluded.routes, arrivals = c.arrivals + excluded.arrivals
    returning 1
  )
  select count(*)::int from added
$$;

-- The contributor's side for the account card (slice F): totals, this month's days, the stored
-- level and the account's events with their counts, newest first.
create function contributions_get(p_user uuid, p_month date, p_trusted_after integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select s.id, s.event_id, s.status, s.reviewed_by, s.created_at,
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
    group by m.id, m.event_id, m.status, m.reviewed_by, m.created_at, m.title, m.start_at,
      m.verified, m.hidden, m.kind, m.days, m.revoked_at
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
        'submissionId', id, 'eventId', event_id, 'title', title, 'startAt', start_at,
        'status', status, 'trusted', reviewed_by = 'trusted', 'hidden', coalesce(hidden, false),
        'reward', case when revoked_at is not null then 'revoked' else kind end,
        'days', coalesce(days, 0), 'opens', opens, 'routes', routes, 'arrivals', arrivals
      ) order by created_at desc) from (select * from counted order by created_at desc limit 100) x),
      '[]'::jsonb)
  )
$$;

-- Levels only go up: stores p_level unless the account already reached a level at least as high
-- (the Worker passes the order from config).
create function contributor_level_set(p_user uuid, p_level text, p_order text[])
returns text
language sql
security definer
set search_path = public
as $$
  update profiles set level = p_level
  where user_id = p_user and p_level is not null
    and coalesce(array_position(p_order, level), 0) < array_position(p_order, p_level)
  returning level
$$;

-- The opt-in credit and its name (null leaves a field as it is).
create function profile_prefs(p_user uuid, p_show_name boolean, p_display_name text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  update profiles set show_name = coalesce(p_show_name, show_name),
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name)
  where user_id = p_user;
$$;

create or replace function profile_get(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p profiles;
begin
  insert into profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into p from profiles where user_id = p_user;
  return jsonb_build_object(
    'displayName', p.display_name, 'locale', p.locale, 'termsVersion', p.terms_version,
    'termsAcceptedAt', p.terms_accepted_at, 'createdAt', p.created_at,
    'showName', p.show_name, 'level', p.level
  );
end $$;

-- "Added by": only for an account that turned the credit on and has a name. Read live, never
-- copied onto the event, so turning it off hides the name everywhere at once. Public.
create function event_credit(p_event text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', p.display_name, 'level', p.level)
  from submissions s join profiles p on p.user_id = s.user_id
  where s.event_id = p_event and s.kind = 'user' and s.status <> 'rejected'
    and p.show_name and p.display_name is not null
  order by s.created_at limit 1
$$;

-- The admin gives trust back after a rejection.
create function trust_restore(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    return false;
  end if;
  insert into profiles (user_id) values (v_user) on conflict (user_id) do nothing;
  update profiles set trust_restored_at = now() where user_id = v_user;
  return true;
end $$;

-- The export gains the account's rewards.
create or replace function account_export(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile', profile_get(p_user),
    'grants', (
      select coalesce(jsonb_agg(grant_json(g) order by g.created_at), '[]'::jsonb)
      from plan_grants g where g.user_id = p_user
    ),
    'usage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(u.month, 'YYYY-MM'), 'events', u.events, 'autofills', u.autofills
      ) order by u.month), '[]'::jsonb)
      from account_usage u where u.user_id = p_user
    ),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.form_payload ->> 'title', 'status', s.status,
        'eventId', s.event_id, 'createdAt', s.created_at
      ) order by s.created_at), '[]'::jsonb)
      from submissions s where s.user_id = p_user
    ),
    'contributions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'submissionId', c.submission_id, 'kind', c.kind, 'days', c.days,
        'month', to_char(c.month, 'YYYY-MM'), 'createdAt', c.created_at, 'revokedAt', c.revoked_at
      ) order by c.created_at), '[]'::jsonb)
      from contributions c where c.user_id = p_user
    )
  )
$$;

revoke all on function contributor_trusted(uuid, integer),
  contribution_award(uuid, text, integer, integer, date, timestamptz),
  contribution_revoke(uuid), contribution_revoke_event(text),
  duplicate_candidates(text, double precision, integer),
  submit_event(jsonb, text, text, boolean, uuid, date, integer, boolean),
  trusted_recent(integer), moderate_trusted(uuid, text, text), counts_add(jsonb, date),
  contributions_get(uuid, date, integer), contributor_level_set(uuid, text, text[]),
  profile_prefs(uuid, boolean, text), trust_restore(text)
  from public, anon, authenticated;
grant execute on function contributor_trusted(uuid, integer),
  contribution_award(uuid, text, integer, integer, date, timestamptz),
  contribution_revoke(uuid), contribution_revoke_event(text),
  duplicate_candidates(text, double precision, integer),
  submit_event(jsonb, text, text, boolean, uuid, date, integer, boolean),
  trusted_recent(integer), moderate_trusted(uuid, text, text), counts_add(jsonb, date),
  contributions_get(uuid, date, integer), contributor_level_set(uuid, text, text[]),
  profile_prefs(uuid, boolean, text), trust_restore(text)
  to service_role;
grant execute on function event_credit(text) to anon, authenticated;
