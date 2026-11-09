-- Web push subscriptions, one row per browser endpoint, and reminders before an event starts,
-- sent by the Worker's Cron Trigger.
-- Everything here is read and written by the API with the service role only.

create table push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique check (length(endpoint) between 10 and 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  -- The salted device hash (as for submissions and attendance), and the account when signed in.
  device_hash text not null,
  user_id uuid references auth.users (id) on delete set null,
  lang text not null default 'pl',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_device_idx on push_subscriptions (device_hash);
create index push_subscriptions_user_idx on push_subscriptions (user_id) where user_id is not null;
alter table push_subscriptions enable row level security;

-- One reminder per device and event. `lead` is minutes before the start, or 'dayBefore' (the
-- evening before, at the hour in config). The fire time follows the event's current start, so a
-- moved event moves its reminder; `start_at` is the start when it was set, to say "time changed".
create table reminders (
  id bigint generated always as identity primary key,
  device_hash text not null,
  user_id uuid references auth.users (id) on delete cascade,
  event_id text not null,
  lead text not null check (lead ~ '^([0-9]{1,4}|dayBefore)$'),
  start_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (device_hash, event_id)
);
create index reminders_pending_idx on reminders (event_id) where sent_at is null;
alter table reminders enable row level security;

create function push_subscribe(
  p_device text, p_user uuid, p_endpoint text, p_p256dh text, p_auth text, p_lang text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into push_subscriptions (endpoint, p256dh, auth, device_hash, user_id, lang)
  values (p_endpoint, p_p256dh, p_auth, p_device, p_user, p_lang)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, device_hash = excluded.device_hash,
      user_id = excluded.user_id, lang = excluded.lang
$$;

-- Only the device that holds the subscription can remove it.
create function push_unsubscribe(p_device text, p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions where endpoint = p_endpoint and device_hash = p_device
$$;

-- When a reminder fires for a start: minutes before it, or the evening before in its time zone.
create function reminder_fire_at(p_start timestamptz, p_tz text, p_lead text, p_day_before time)
returns timestamptz
language sql
stable
as $$
  select case
    when p_lead = 'dayBefore'
      then (((p_start at time zone p_tz)::date - 1) + p_day_before) at time zone p_tz
    else p_start - make_interval(mins => p_lead::integer)
  end
$$;

-- Sets (or with p_lead null, removes) this device's reminder for an event. Returns false when the
-- event isn't listed, has started, or the device has p_max pending reminders already.
create function reminder_set(
  p_device text, p_user uuid, p_event text, p_lead text, p_max integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
begin
  -- With an account, one reminder per event across its devices: it reaches all of them.
  if p_lead is null then
    delete from reminders
    where event_id = p_event
      and (device_hash = p_device or (p_user is not null and user_id = p_user));
    return true;
  end if;
  select e.start_at into v_start from events_public e where e.id = p_event;
  if v_start is null or v_start <= now() then return false; end if;
  if not exists (
    select 1 from reminders where device_hash = p_device and event_id = p_event
  ) and (
    select count(*) from reminders where device_hash = p_device and sent_at is null
  ) >= p_max then
    return false;
  end if;
  if p_user is not null then
    delete from reminders
    where user_id = p_user and event_id = p_event and device_hash <> p_device;
  end if;
  insert into reminders (device_hash, user_id, event_id, lead, start_at)
  values (p_device, p_user, p_event, p_lead, v_start)
  on conflict (device_hash, event_id) do update
    set lead = excluded.lead, start_at = excluded.start_at, user_id = excluded.user_id,
      sent_at = null;
  return true;
end $$;

-- Pending reminders of this device, and with an account, of the account's other devices.
create function reminders_list(p_device text, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(event_id, lead), '{}'::jsonb)
  from (
    select distinct on (r.event_id) r.event_id, r.lead
    from reminders r
    where r.sent_at is null
      and (r.device_hash = p_device or (p_user is not null and r.user_id = p_user))
    order by r.event_id, (r.device_hash = p_device) desc, r.created_at desc
  ) x
$$;

-- What the cron should send now: reminders whose time comes before the next tick
-- (p_until = now + the cron interval), with the event as it is now and where to send. A reminder
-- set on several of an account's devices is sent once per subscription. Reminders of events that
-- ended, or were dropped, are deleted on the way.
create function reminders_due(p_until timestamptz, p_day_before time, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  delete from reminders r
  where r.sent_at is not null and r.sent_at < now() - interval '2 days'
     or not exists (select 1 from events e where e.id = r.event_id and e.end_at > now());

  with due as (
    select r.id, r.device_hash, r.user_id, r.lead, r.start_at as set_start, e.id as event_id,
      e.title, v.name as venue_name, e.start_at, e.timezone, e.status::text as status, e.hidden
    from reminders r
    join events e on e.id = r.event_id
    left join venues v on v.id = e.venue_id
    where r.sent_at is null
      and reminder_fire_at(e.start_at, e.timezone, r.lead, p_day_before) <= p_until
    order by e.start_at
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'eventId', d.event_id, 'title', d.title, 'venue', d.venue_name,
    'startAt', d.start_at, 'setStartAt', d.set_start, 'timezone', d.timezone,
    'status', d.status, 'hidden', d.hidden,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang
      )), '[]'::jsonb)
      from push_subscriptions s
      where s.device_hash = d.device_hash or (d.user_id is not null and s.user_id = d.user_id)
    )
  )), '[]'::jsonb) into v
  from due d;
  return v;
end $$;

-- After a tick: reminders done (sent, or nothing to send), and subscriptions the push service
-- says are gone.
create function reminders_done(p_ids bigint[], p_sent_endpoints text[], p_gone_endpoints text[])
returns void
language sql
security definer
set search_path = public
as $$
  update reminders set sent_at = now() where id = any (p_ids);
  update push_subscriptions set last_used_at = now() where endpoint = any (p_sent_endpoints);
  delete from push_subscriptions where endpoint = any (p_gone_endpoints);
$$;

revoke all on table push_subscriptions, reminders from public, anon, authenticated;
revoke all on function push_subscribe(text, uuid, text, text, text, text),
  push_unsubscribe(text, text), reminder_set(text, uuid, text, text, integer),
  reminders_list(text, uuid), reminders_due(timestamptz, time, integer),
  reminders_done(bigint[], text[], text[])
  from public, anon, authenticated;
grant execute on function push_subscribe(text, uuid, text, text, text, text),
  push_unsubscribe(text, text), reminder_set(text, uuid, text, text, integer),
  reminders_list(text, uuid), reminders_due(timestamptz, time, integer),
  reminders_done(bigint[], text[], text[])
  to service_role;
