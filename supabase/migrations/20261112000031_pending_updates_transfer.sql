-- Accounts that wait for activation, updates read for many events at once, and handing a
-- private event over to a guest.

-- ---------- Accounts waiting for activation ----------

-- Someone gave their email and has not typed the code yet. They get an account of their own (a
-- placeholder address on `auth.pending.domain`), never the email's real account: the email is
-- not proven, so it opens nothing that belongs to it. Such an account may accept invitations and
-- read its private events; once the code is typed, it is folded into the real account.
create table pending_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The address the code goes to, as typed (lower case). Not proven.
  email text not null check (char_length(email) between 3 and 254),
  created_at timestamptz not null default now()
);
create index pending_accounts_created_idx on pending_accounts (created_at);
alter table pending_accounts enable row level security;

create function pending_add(p_user uuid, p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into pending_accounts (user_id, email) values (p_user, lower(p_email))
  on conflict (user_id) do update set email = excluded.email;
$$;

create function pending_email(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from pending_accounts where user_id = p_user
$$;

-- Folds a waiting account into the activated one: its invitations and answers, the contacts
-- those made, its name and accepted terms where the real account has none, and its devices'
-- notifications and reminders. False when `p_from` is not a waiting account (nothing is moved:
-- a real account can never be folded into another). The caller then deletes `p_from`.
create function pending_merge(p_from uuid, p_to uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  f profiles;
begin
  if p_from = p_to or not exists (select 1 from pending_accounts where user_id = p_from) then
    return false;
  end if;

  -- Invited twice (the real account by name, the waiting one by link): the acceptance carries over.
  update invitations t set status = 'accepted', answered_at = x.answered_at,
    seen_at = greatest(t.seen_at, x.seen_at)
  from invitations x
  where x.invitee = p_from and x.status = 'accepted' and t.invitee = p_to
    and t.event_id = x.event_id and t.status in ('pending', 'declined');
  delete from invitations x where x.invitee = p_from and (
    exists (select 1 from invitations t where t.event_id = x.event_id and t.invitee = p_to)
    or exists (select 1 from events e where e.id = x.event_id and e.owner_id = p_to));
  update invitations set invitee = p_to where invitee = p_from;

  insert into contacts (owner, contact, blocked, created_at)
  select p_to, contact, blocked, created_at from contacts
  where owner = p_from and contact <> p_to
  on conflict (owner, contact) do nothing;
  insert into contacts (owner, contact, blocked, created_at)
  select owner, p_to, blocked, created_at from contacts
  where contact = p_from and owner <> p_to
  on conflict (owner, contact) do nothing;
  delete from contacts where owner = p_from or contact = p_from;

  insert into profiles (user_id) values (p_to) on conflict (user_id) do nothing;
  select * into f from profiles where user_id = p_from;
  if found then
    update profiles t set
      display_name = coalesce(t.display_name, f.display_name),
      locale = coalesce(t.locale, f.locale),
      terms_accepted_at = case when t.terms_version is null then f.terms_accepted_at
        else t.terms_accepted_at end,
      terms_version = coalesce(t.terms_version, f.terms_version)
    where t.user_id = p_to;
  end if;

  update push_subscriptions set user_id = p_to where user_id = p_from;
  update reminders set user_id = p_to where user_id = p_from;
  update attendance set user_id = p_to where user_id = p_from;
  update friend_overrides x set user_id = p_to where x.user_id = p_from
    and not exists (select 1 from friend_overrides t where t.user_id = p_to
      and t.event_id = x.event_id);

  delete from pending_accounts where user_id = p_from;
  return true;
end $$;

-- Waiting accounts nobody activated in `p_keep_days`: the caller deletes these users (their
-- invitations and contacts go with them).
create function pending_expired(p_keep_days integer, p_limit integer)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}') from (
    select user_id from pending_accounts
    where created_at < now() - make_interval(days => p_keep_days)
    order by created_at limit p_limit) x
$$;

-- ---------- Updates of many events at once ----------

-- What changed on the public events among `p_ids`: when the organiser last posted, when the
-- time or status last changed by hand, and the newest posts. Events with neither are left out.
-- The app asks for the events a person cares about (saved, going) and marks the ones
-- with something they have not seen.
create function events_updates(p_ids text[], p_posts integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'status', e.status::text,
      'lastPostAt', e.last_post_at, 'changedAt', e.changed_at,
      'posts', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'body', p.body,
            'change', p.change, 'createdAt', p.created_at) order by p.created_at desc)
        from (select * from event_posts x where x.event_id = e.id and not x.hidden
          order by x.created_at desc limit greatest(p_posts, 0)) p), '[]'::jsonb))), '[]'::jsonb)
  from events e
  where e.id = any (p_ids) and e.visibility = 'public' and not e.hidden
    and (e.last_post_at is not null or e.changed_at is not null)
$$;

-- ---------- Handing a private event over ----------

-- The owner gives a private event to one of its accepted guests. The guest becomes the owner
-- (inviting, editing, posting); the former owner stays on it as an accepted guest. Everyone
-- else's invitation stays as it is.
create function event_transfer(p_user uuid, p_event text, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not exists (select 1 from events where id = p_event and owner_id = p_user
    and visibility = 'private' and not hidden) then
    raise exception 'not your event' using errcode = 'P0002';
  end if;
  if p_to = p_user then
    raise exception 'already yours' using errcode = 'HQ010';
  end if;
  if not exists (select 1 from invitations where event_id = p_event and invitee = p_to
    and status = 'accepted') then
    raise exception 'not an accepted guest' using errcode = 'P0002';
  end if;
  -- Not to an account that waits for activation, nor to one stopped from running private events.
  if exists (select 1 from pending_accounts where user_id = p_to)
    or exists (select 1 from profiles where user_id = p_to and private_blocked_at is not null) then
    raise exception 'cannot take it' using errcode = 'HQ011';
  end if;

  delete from invitations where event_id = p_event and invitee = p_to;
  update invitations set inviter = p_to where event_id = p_event;
  insert into invitations (event_id, inviter, invitee, status, answered_at, seen_at)
  values (p_event, p_to, p_user, 'accepted', now(), now())
  on conflict (event_id, invitee) where invitee is not null do update
    set status = 'accepted', inviter = excluded.inviter, answered_at = now();
  update events set owner_id = p_to, changed_at = now() where id = p_event;
  -- "Your events" follows the owner.
  update submissions set user_id = p_to where event_id = p_event and user_id = p_user;
  perform contact_connect(p_user, p_to);

  select display_name into v_name from profiles where user_id = p_to;
  return jsonb_build_object('owner', p_to, 'ownerName', v_name);
end $$;

-- ---------- Grants ----------

do $$
declare
  f text;
begin
  foreach f in array array[
    'pending_add(uuid, text)', 'pending_email(uuid)', 'pending_merge(uuid, uuid)',
    'pending_expired(integer, integer)', 'events_updates(text[], integer)',
    'event_transfer(uuid, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
