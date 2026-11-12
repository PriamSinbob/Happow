-- "Maybe" as an answer to a private event's invitation: going, maybe, or can't make it.
--
-- A maybe is an accepted invitation with `maybe` set: the guest keeps the event in their plans,
-- sees the guest list and gets the updates, and installed apps that only know `accepted` keep
-- working. The guest lists and the event's own `invitation` say which it is.

alter table invitations add column maybe boolean not null default false;

drop function invitation_answer(uuid, text, boolean);

-- Going, maybe or declined; going and maybe connect you with the organiser.
create function invitation_answer(p_user uuid, p_event text, p_accept boolean,
  p_maybe boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  i invitations;
begin
  select * into i from invitations where event_id = p_event and invitee = p_user
    and status in ('pending', 'accepted', 'declined') for update;
  if not found then raise exception 'no invitation' using errcode = 'P0002'; end if;
  update invitations set status = case when p_accept then 'accepted' else 'declined' end,
    maybe = p_accept and coalesce(p_maybe, false),
    answered_at = now(), seen_at = now() where id = i.id;
  if p_accept then perform contact_connect(i.inviter, p_user); end if;
  return case when p_accept then 'accepted' else 'declined' end;
end $$;

create or replace function private_events_for(p_user uuid, p_lat double precision default null,
  p_lng double precision default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(event_row_json(e.id, p_lat, p_lng) || jsonb_build_object(
      'mine', e.owner_id = p_user,
      'owner_name', (select p.display_name from profiles p where p.user_id = e.owner_id),
      'invitation', (
        select jsonb_build_object('id', i.id, 'status', i.status, 'seenAt', i.seen_at,
          'maybe', i.status = 'accepted' and i.maybe)
        from invitations i where i.event_id = e.id and i.invitee = p_user
          and i.status in ('pending', 'accepted'))
    ) order by e.start_at), '[]'::jsonb)
  from events e
  where e.visibility = 'private' and not e.hidden
    and (e.owner_id = p_user or exists (
      select 1 from invitations i where i.event_id = e.id and i.invitee = p_user
        and i.status in ('pending', 'accepted')))
$$;

create or replace function private_event_get(p_user uuid, p_event text, p_token text,
  p_lat double precision default null, p_lng double precision default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select event_row_json(e.id, p_lat, p_lng) || jsonb_build_object(
      'mine', e.owner_id is not distinct from p_user and p_user is not null,
      'owner_name', (select p.display_name from profiles p where p.user_id = e.owner_id),
      'invitation', (
        select jsonb_build_object('id', i.id, 'status', i.status, 'seenAt', i.seen_at,
          'maybe', i.status = 'accepted' and i.maybe)
        from invitations i where i.event_id = e.id and i.invitee = p_user
          and i.status in ('pending', 'accepted', 'declined')),
      'link', p_token is not null and exists (
        select 1 from invitations i where i.event_id = e.id and i.token = p_token
          and i.invitee is null and i.status = 'pending'))
  from events e
  where e.id = p_event and e.visibility = 'private' and not e.hidden
    and (
      (p_user is not null and (e.owner_id = p_user or exists (
        select 1 from invitations i where i.event_id = e.id and i.invitee = p_user
          and i.status in ('pending', 'accepted', 'declined'))))
      or (p_token is not null and exists (
        select 1 from invitations i where i.event_id = e.id and i.token = p_token
          and i.status = 'pending' and i.invitee is null)))
$$;

-- The organiser's view: every invitation by person or link. For accepted guests, the list of
-- who else accepted, each with `maybe`.
create or replace function event_guests(p_user uuid, p_event text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select owner_id from events where id = p_event and visibility = 'private');
begin
  if v_owner is null then raise exception 'unknown event' using errcode = 'P0002'; end if;
  if v_owner = p_user then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'label', i.label,
          'person', i.invitee, 'name', p.display_name, 'link', i.token is not null,
          'token', case when i.invitee is null and i.status = 'pending' then i.token end,
          'maybe', i.status = 'accepted' and i.maybe,
          'createdAt', i.created_at, 'answeredAt', i.answered_at)
        order by i.status, lower(coalesce(p.display_name, i.label, '')), i.created_at)
      from invitations i left join profiles p on p.user_id = i.invitee
      where i.event_id = p_event), '[]'::jsonb);
  end if;
  if not exists (select 1 from invitations where event_id = p_event and invitee = p_user
    and status = 'accepted') then
    raise exception 'not a guest' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('status', 'accepted', 'person', i.invitee,
        'name', p.display_name, 'maybe', i.maybe)
      order by i.maybe, lower(coalesce(p.display_name, '')))
    from invitations i left join profiles p on p.user_id = i.invitee
    where i.event_id = p_event and i.status = 'accepted'), '[]'::jsonb);
end $$;

revoke all on function invitation_answer(uuid, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function invitation_answer(uuid, text, boolean, boolean) to service_role;
