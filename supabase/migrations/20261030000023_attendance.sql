-- M9 slices E and F: "I'm going", co-presence and the sharer's link counts
-- (docs/milestones/M9-sharing-attendance.md §5, §6). Anonymous: one row per device (salted hash,
-- as for submissions), event and signal. A signed-in account is kept with the row, unused until
-- M11's friends' view. Rows live until the event ends plus a margin, or a shorter signal's window.
-- Read and written only by the Worker (service role); the API buckets the counts and leaves them
-- out for categories with publicAttendance: false.

create table attendance (
  event_id text not null references events (id) on delete cascade,
  device text not null,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('going', 'looking', 'onway', 'here')),
  -- The share link this device arrived with (another device's), for that sharer's count.
  share_token text,
  at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (event_id, device, kind)
);
create index attendance_expires_idx on attendance (expires_at);
create index attendance_token_idx on attendance (share_token) where share_token is not null;
alter table attendance enable row level security;

-- A share link's token and the device that made it: only that device sees the link's count.
create table share_links (
  token text primary key,
  event_id text not null references events (id) on delete cascade,
  device text not null,
  created_at timestamptz not null default now()
);
create index share_links_device_idx on share_links (device, event_id);
alter table share_links enable row level security;

-- Live counts per signal, this device's own signals, how many people who came through this
-- device's links are going, and the event's categories (the API hides counts for some).
create function attendance_get(p_event text, p_device text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'categories', (select to_jsonb(e.category_ids) from events e where e.id = p_event),
    'counts', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from attendance
            where event_id = p_event and expires_at > now() group by kind) c),
    'mine', (
      select coalesce(jsonb_agg(kind order by kind), '[]'::jsonb) from attendance
      where event_id = p_event and device = p_device and expires_at > now()),
    'fromMyLinks', (
      select count(*) from attendance a
      join share_links s on s.token = a.share_token and s.event_id = a.event_id
      where a.event_id = p_event and a.kind = 'going' and a.expires_at > now()
        and s.device = p_device)
  )
$$;

-- Sets or clears one signal for a device. A signal lives until the event ends plus p_keep_hours,
-- or until p_until when that's sooner (a short-lived signal). Only events that haven't ended can
-- get a signal; null when the event is unknown, hidden or over. A token counts only for a link
-- made by another device for this same event, and the first link a device came with is kept.
create function attendance_set(
  p_event text,
  p_device text,
  p_user uuid,
  p_kind text,
  p_on boolean,
  p_token text,
  p_keep_hours integer,
  p_until timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_end timestamptz;
begin
  delete from attendance where expires_at < now();
  select e.end_at into v_end from events_public e where e.id = p_event;
  if v_end is null or v_end < now() then return null; end if;
  if p_on then
    insert into attendance as a (event_id, device, user_id, kind, share_token, expires_at)
    values (
      p_event, p_device, p_user, p_kind,
      (select s.token from share_links s
        where s.token = p_token and s.event_id = p_event and s.device <> p_device),
      least(v_end + make_interval(hours => p_keep_hours), coalesce(p_until, 'infinity'))
    )
    on conflict (event_id, device, kind) do update set
      at = now(),
      expires_at = excluded.expires_at,
      user_id = coalesce(excluded.user_id, a.user_id),
      share_token = coalesce(a.share_token, excluded.share_token);
  else
    delete from attendance where event_id = p_event and device = p_device and kind = p_kind;
  end if;
  return attendance_get(p_event, p_device);
end;
$$;

-- A new share link for an event; false when the event isn't public. Links older than 90 days go.
create function share_link_create(p_token text, p_event text, p_device text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from events_public where id = p_event) then return false; end if;
  delete from share_links where created_at < now() - interval '90 days';
  insert into share_links (token, event_id, device) values (p_token, p_event, p_device);
  return true;
end;
$$;

revoke all on table attendance, share_links from public, anon, authenticated;
revoke all on function attendance_get(text, text) from public, anon, authenticated;
revoke all on function attendance_set(text, text, uuid, text, boolean, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function share_link_create(text, text, text) from public, anon, authenticated;
grant execute on function attendance_get(text, text) to service_role;
grant execute on function attendance_set(text, text, uuid, text, boolean, text, integer, timestamptz) to service_role;
grant execute on function share_link_create(text, text, text) to service_role;
