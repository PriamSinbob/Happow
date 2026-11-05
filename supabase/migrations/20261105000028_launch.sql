-- M13 launch readiness (docs/milestones/M13-launch-readiness.md).
-- Slice C: the crawler's page cache (conditional requests, unchanged pages skipped).

create table page_cache (
  source_id text not null,
  url text not null check (length(url) <= 2000),
  etag text,
  last_modified text,
  content_hash text not null,
  events jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (source_id, url)
);
create index page_cache_fetched_idx on page_cache (fetched_at);
alter table page_cache enable row level security;
revoke all on table page_cache from public, anon, authenticated;

-- Slice D: the export covers every table that refers to an account (a DB test enforces it).
alter function account_export(uuid) rename to account_export_m7;
create function account_export(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select account_export_m7(p_user) || jsonb_build_object(
    'feeds', (
      select coalesce(jsonb_agg(jsonb_build_object('url', f.url, 'status', f.status,
        'createdAt', f.created_at, 'lastRunAt', f.last_run_at, 'lastEvents', f.last_events)
        order by f.created_at), '[]'::jsonb)
      from account_feeds f where f.user_id = p_user),
    'reminders', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', r.event_id, 'lead', r.lead,
        'createdAt', r.created_at, 'sentAt', r.sent_at) order by r.created_at), '[]'::jsonb)
      from reminders r where r.user_id = p_user),
    -- The browsers that receive notifications: when and in which language, not their keys.
    'pushDevices', (
      select coalesce(jsonb_agg(jsonb_build_object('lang', s.lang, 'createdAt', s.created_at,
        'lastUsedAt', s.last_used_at) order by s.created_at), '[]'::jsonb)
      from push_subscriptions s where s.user_id = p_user),
    'attendance', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', a.event_id, 'kind', a.kind,
        'at', a.at) order by a.at), '[]'::jsonb)
      from attendance a where a.user_id = p_user),
    'reports', (
      select coalesce(jsonb_agg(jsonb_build_object('eventId', r.event_id, 'reason', r.reason,
        'note', r.note, 'createdAt', r.created_at, 'resolution', r.resolution)
        order by r.created_at), '[]'::jsonb)
      from reports r where r.reporter_user = p_user)
  )
$$;
revoke all on function account_export(uuid), account_export_m7(uuid) from public, anon, authenticated;
grant execute on function account_export(uuid), account_export_m7(uuid) to service_role;
