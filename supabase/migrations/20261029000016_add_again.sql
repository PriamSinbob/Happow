-- M12 slice H: "add again" (docs/milestones/M12-more-events.md §4.4). The account's own submission
-- read back as the form it was sent with, to open the add form for another date. Only its owner
-- gets it, and never for a rejected submission or a hidden event.
create function submission_form(p_user uuid, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select s.form_payload
  from submissions s
  left join events e on e.id = s.event_id
  where s.id = p_id and s.user_id = p_user and s.kind = 'user'
    and s.status <> 'rejected' and not coalesce(e.hidden, false)
$$;

revoke all on function submission_form(uuid, uuid) from public, anon, authenticated;
grant execute on function submission_form(uuid, uuid) to service_role;
