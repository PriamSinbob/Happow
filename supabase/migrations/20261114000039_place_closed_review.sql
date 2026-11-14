-- A place closed for good goes to the moderators. It leaves the map at once, as before, and
-- shows in the moderation queue until a moderator keeps it closed ('checked' in place_log) or
-- opens it again ('open', with the moderator in value). Closing it again puts it back in the
-- queue. place_log actions now also include 'checked'.

-- Places closed for good that no moderator has looked at since they were last closed, newest
-- first, with who closed them: the account's email, or the hashed device.
create function place_closed_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.closed_at desc), '[]'::jsonb) from (
    select c.place_id as id, p.name, p.kind, p.address, l.at as closed_at,
      u.email as closed_by, l.device as closed_by_device
    from place_changes c
    join places p on p.osm_id = c.place_id
    cross join lateral (
      select g.at, g.user_id, g.device from place_log g
      where g.place_id = c.place_id and g.action = 'closed'
      order by g.at desc limit 1
    ) l
    left join auth.users u on u.id = l.user_id
    where c.closed
      and not exists (
        select 1 from place_log r
        where r.place_id = c.place_id and r.action = 'checked' and r.at > l.at
      )
    order by l.at desc
    limit 200
  ) q
$$;

-- A moderator's decision on a place closed for good: 'approve' keeps it closed, 'reject' opens
-- it again. P0001: it is not closed (any more).
create function moderate_place(p_place text, p_action text, p_moderator text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if not exists (select 1 from place_changes where place_id = p_place and closed) then
    raise exception 'not closed' using errcode = 'P0001';
  end if;
  if p_action = 'reject' then
    update place_changes set closed = false, updated_by = null, updated_at = now()
    where place_id = p_place;
    insert into place_log (place_id, action, value)
    values (p_place, 'open', 'moderator:' || p_moderator);
  else
    insert into place_log (place_id, action, value) values (p_place, 'checked', p_moderator);
  end if;
end;
$$;

revoke all on function place_closed_queue(), moderate_place(text, text, text)
  from public, anon, authenticated;
grant execute on function place_closed_queue(), moderate_place(text, text, text) to service_role;
