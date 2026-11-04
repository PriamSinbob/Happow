-- M10 plan ahead (docs/milestones/M10-plan-ahead.md).
-- Slice A: the agenda reads the events on someone's list by id, also beyond the map's 14 days.
-- Slice B: an account's saved list, synced across its devices (`saved.sync` in config/plans.json).

-- The events among `ids` that are still listed (events_public leaves out hidden ones); ended
-- ones are included, for the agenda's "Past". The same columns as event_by_id.
create function events_by_ids(
  ids text[],
  lat double precision default null,
  lng double precision default null
)
returns table (
  id text, title text, description text, category_ids text[], start_at timestamptz,
  end_at timestamptz, end_estimated boolean, timezone text, venue_id text, venue_name text,
  venue_address text, venue_website text, lat double precision, lng double precision, h3_r9 text,
  price_min numeric, price_max numeric, currency text, is_free boolean, rules jsonb,
  official_url text, ticket_url text, image_url text, status event_status, trust trust_level,
  confidence real, last_seen_at timestamptz, primary_source_id text, source_url text,
  distance_m double precision, verified boolean, flag_reason text, flag_count integer,
  flag_at timestamptz, entry text, grace_min smallint, age_min smallint, family boolean
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    e.id, e.title, e.description, e.category_ids, e.start_at, e.end_at, e.end_estimated, e.timezone,
    e.venue_id, e.venue_name, e.venue_address, e.venue_website, e.lat, e.lng, e.h3_r9,
    e.price_min, e.price_max, e.currency, e.is_free, e.rules, e.official_url, e.ticket_url,
    e.image_url, e.status, e.trust, e.confidence, e.last_seen_at, e.primary_source_id, e.source_url,
    case when events_by_ids.lat is null or events_by_ids.lng is null then null
      else extensions.st_distance(
        e.point,
        extensions.st_setsrid(extensions.st_makepoint(events_by_ids.lng, events_by_ids.lat), 4326)::extensions.geography)
    end,
    e.verified, e.flag_reason, e.flag_count, e.flag_at, e.entry, e.grace_min, e.age_min, e.family
  from events_public e
  -- At most 500 ids per call (config/app.json agenda.maxPerRead is lower).
  where e.id = any (ids[1:500])
  order by e.start_at;
$$;

grant execute on function events_by_ids(text[], double precision, double precision)
  to anon, authenticated;

-- One row per account and event. A removal stays as saved = false for a while (keep_removed_days),
-- so a device that was offline doesn't bring the event back. No foreign key to events: an event
-- can be dropped (a source's cache limit) while it is still on someone's list.
create table saved_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 200),
  saved boolean not null,
  -- Marked "I'm going" on one of the account's devices (going also saves).
  going boolean not null default false,
  changed_at timestamptz not null,
  primary key (user_id, event_id)
);
-- Read and written only through the API (service role), for the signed-in account.
alter table saved_events enable row level security;

create function saved_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.event_id, 'on', v.saved, 'going', v.going,
    'at', (extract(epoch from v.changed_at) * 1000)::bigint
  ) order by v.changed_at, v.event_id), '[]'::jsonb)
  from saved_events v where v.user_id = p_user
$$;

-- Merges a device's list into the account's (M10 §2) and returns the account's whole list.
-- Per event the latest change wins; a time from the future counts as now. Removals older than
-- p_keep_removed_days go, and of the saved ones the oldest go past p_max.
create function saved_sync(p_user uuid, p_items jsonb, p_keep_removed_days integer, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into saved_events (user_id, event_id, saved, going, changed_at)
  select p_user, i.id, i.on_, i.on_ and i.going, least(i.at, now())
  from (
    select distinct on (x ->> 'id')
      x ->> 'id' as id,
      coalesce((x ->> 'on')::boolean, false) as on_,
      coalesce((x ->> 'going')::boolean, false) as going,
      to_timestamp(((x ->> 'at')::bigint) / 1000.0) as at
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    where x ->> 'id' is not null and x ->> 'at' is not null
    order by x ->> 'id', (x ->> 'at')::bigint desc
  ) i
  on conflict (user_id, event_id) do update
    set saved = excluded.saved, going = excluded.going, changed_at = excluded.changed_at
    where excluded.changed_at > saved_events.changed_at;

  delete from saved_events
  where user_id = p_user and not saved
    and changed_at < now() - make_interval(days => p_keep_removed_days);

  delete from saved_events v
  using (
    select event_id from saved_events
    where user_id = p_user and saved
    order by changed_at desc, event_id desc
    offset greatest(p_max, 0)
  ) extra
  where v.user_id = p_user and v.event_id = extra.event_id;

  return saved_json(p_user);
end $$;

revoke all on table saved_events from public, anon, authenticated;
revoke all on function saved_json(uuid), saved_sync(uuid, jsonb, integer, integer)
  from public, anon, authenticated;
grant execute on function saved_json(uuid), saved_sync(uuid, jsonb, integer, integer)
  to service_role;

-- The account export (M8, GDPR art. 15/20) includes the saved list.
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
    ),
    'saved', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'eventId', v.event_id, 'saved', v.saved, 'going', v.going, 'changedAt', v.changed_at
      ) order by v.changed_at), '[]'::jsonb)
      from saved_events v where v.user_id = p_user
    )
  )
$$;
