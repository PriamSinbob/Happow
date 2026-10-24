-- M8 slice C: monthly quotas per account (docs/milestones/M8-accounts-premium.md §5). The Worker
-- works out the calendar month in the region's time zone and the limit from the user's plan, and
-- passes both in; the count is checked and raised in the same statement, so parallel requests at
-- the limit can't both pass.

create table account_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The first day of the calendar month, in the region's time zone.
  month date not null check (extract(day from month) = 1),
  events integer not null default 0 check (events >= 0),
  autofills integer not null default 0 check (autofills >= 0),
  primary key (user_id, month)
);

alter table account_usage enable row level security;
create policy "own usage" on account_usage for select to authenticated using (user_id = auth.uid());
grant select on account_usage to authenticated;

-- The account that added an event. Deleting the account keeps the event, without the link.
alter table submissions add column user_id uuid references auth.users (id) on delete set null;
create index submissions_user_idx on submissions (user_id) where user_id is not null;

-- Counts one use of p_kind ('events' or 'autofills') in p_month if fewer than p_max were used.
-- False, and nothing counted, when the quota is used up.
create function usage_take(p_user uuid, p_month date, p_kind text, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  e integer := (p_kind = 'events')::integer;
  a integer := (p_kind = 'autofills')::integer;
  ok boolean;
begin
  if p_kind not in ('events', 'autofills') then
    raise exception 'unknown usage kind %', p_kind;
  end if;
  if p_max <= 0 then
    return false;
  end if;
  insert into account_usage as u (user_id, month, events, autofills)
  values (p_user, p_month, e, a)
  on conflict (user_id, month) do update
    set events = u.events + e, autofills = u.autofills + a
    where (case when e = 1 then u.events else u.autofills end) < p_max
  returning true into ok;
  return coalesce(ok, false);
end $$;

create function usage_get(p_user uuid, p_month date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'events', coalesce((select events from account_usage where user_id = p_user and month = p_month), 0),
    'autofills', coalesce((select autofills from account_usage where user_id = p_user and month = p_month), 0)
  )
$$;

-- Submissions from an account count against its events quota in the same transaction: a quota
-- used up stores nothing (error HQ001), and a failed insert or publish counts nothing. Without
-- p_user (anonymous) nothing is counted, as before.
drop function submit_event(jsonb, text, text, boolean);
create function submit_event(
  p jsonb, p_submitter text, p_region text, p_publish boolean,
  p_user uuid default null, p_month date default null, p_max integer default 0
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
    region_id, source_id, external_id, confidence, user_id)
  values (sid, 'user', p -> 'form' ->> 'url', p -> 'form', p -> 'normalized', 'pending', p_submitter,
    p_region, p -> 'normalized' ->> 'sourceId', sid::text, 1, p_user);
  if p_publish then
    eid := publish_event((p -> 'normalized') || jsonb_build_object('regionId', p_region, 'verified', false));
    update submissions set event_id = eid where id = sid;
  end if;
  return sid;
end $$;

-- The export adds monthly usage and the events the account added.
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
    )
  )
$$;

revoke all on function usage_take(uuid, date, text, integer), usage_get(uuid, date),
  submit_event(jsonb, text, text, boolean, uuid, date, integer), account_export(uuid)
  from public, anon, authenticated;
grant execute on function usage_take(uuid, date, text, integer), usage_get(uuid, date),
  submit_event(jsonb, text, text, boolean, uuid, date, integer), account_export(uuid)
  to service_role;
