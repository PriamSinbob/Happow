-- M12 slice C2: the admin's Sources tab (docs/design/admin.html, docs/milestones/M12-more-events.md
-- §2.2). The Worker lists the website check's candidates and moves them between new, accepted
-- ("read"), paused and rejected. Service role only, behind the admin check in /api/admin/sources.

-- How many events a site gave on its last run, for the Read list.
alter table source_candidates add column last_run_events integer;

create function source_candidates_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'regionId', c.region_id, 'venueName', c.venue_name, 'url', c.url,
    'kind', c.kind, 'eventCount', c.event_count, 'sample', c.sample, 'status', c.status,
    'failures', c.failures, 'lastError', c.last_error, 'foundAt', c.found_at,
    'decidedAt', c.decided_at, 'decidedBy', c.decided_by, 'lastRunAt', c.last_run_at,
    'lastRunEvents', c.last_run_events
  ) order by c.found_at, c.id), '[]'::jsonb)
  from source_candidates c
$$;

-- One decision. Null when there is no such candidate; HQ002 when the action does not fit its
-- status (someone else decided first). Resume clears the failure count.
create function source_candidate_decide(p_id bigint, p_action text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c source_candidates;
  next_status text;
begin
  select * into c from source_candidates where id = p_id for update;
  if not found then
    return null;
  end if;
  next_status := case
    when p_action = 'accept' and c.status = 'new' then 'accepted'
    when p_action = 'reject' and c.status = 'new' then 'rejected'
    when p_action = 'stop' and c.status in ('accepted', 'paused') then 'rejected'
    when p_action = 'resume' and c.status = 'paused' then 'accepted'
    when p_action = 'restore' and c.status = 'rejected' then 'new'
  end;
  if next_status is null then
    raise exception 'cannot % a % candidate', p_action, c.status using errcode = 'HQ002';
  end if;
  update source_candidates set
    status = next_status,
    decided_at = now(),
    decided_by = p_by,
    failures = case when p_action = 'resume' then 0 else failures end,
    last_error = case when p_action = 'resume' then null else last_error end
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', next_status);
end $$;

revoke all on function source_candidates_list(), source_candidate_decide(bigint, text, text)
  from public, anon, authenticated;
grant execute on function source_candidates_list(), source_candidate_decide(bigint, text, text)
  to service_role;
