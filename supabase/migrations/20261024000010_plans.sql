-- M8 slice B: plan grants (docs/milestones/M8-accounts-premium.md §4). The early-access promotion
-- is not stored here: the Worker works it out from config/plans.json, so moving its end date
-- extends it for everyone at once. Grants give one account a plan: by hand (the admin), as a
-- trial, or bought through a premium provider.

create table plan_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null check (plan in ('account', 'premium')),
  source text not null check (source in ('manual', 'trial', 'purchase')),
  -- The provider that sold it and its own id for the purchase (subscription, order).
  provider text,
  provider_ref text,
  starts_at timestamptz not null default now(),
  -- Null = no end (manual grants only).
  ends_at timestamptz,
  note text check (char_length(note) <= 500),
  -- The admin's email for manual grants.
  created_by text,
  created_at timestamptz not null default now(),
  check ((provider is null) = (provider_ref is null)),
  check (source <> 'purchase' or provider is not null),
  check (ends_at is null or ends_at >= starts_at)
);

-- A provider's notification may arrive twice: the same purchase updates its one grant.
create unique index plan_grants_provider_idx on plan_grants (provider, provider_ref);
create index plan_grants_user_idx on plan_grants (user_id);

alter table plan_grants enable row level security;
create policy "own grants" on plan_grants for select to authenticated using (user_id = auth.uid());
grant select on plan_grants to authenticated;

create function grant_json(g plan_grants)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', g.id, 'plan', g.plan, 'source', g.source, 'provider', g.provider,
    'startsAt', g.starts_at, 'endsAt', g.ends_at, 'note', g.note, 'createdAt', g.created_at
  )
$$;

-- The user's grants that have not ended; the Worker picks the plan in force (core/plans.ts).
create function grants_active(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(grant_json(g) order by g.starts_at), '[]'::jsonb)
  from plan_grants g
  where g.user_id = p_user and (g.ends_at is null or g.ends_at > now())
$$;

-- Every grant with its account's email, newest first (admin).
create function grants_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    grant_json(g) || jsonb_build_object(
      'email', lower(u.email), 'createdBy', g.created_by,
      'active', g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
    ) order by g.created_at desc), '[]'::jsonb)
  from plan_grants g join auth.users u on u.id = g.user_id
$$;

-- A manual grant by email (admin). The account must exist: the API creates it first.
create function grant_add(
  p_email text, p_plan text, p_ends_at timestamptz, p_note text, p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  g plan_grants;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'no account for %', p_email using errcode = 'P0002';
  end if;
  insert into plan_grants (user_id, plan, source, ends_at, note, created_by)
  values (v_user, p_plan, 'manual', p_ends_at, p_note, lower(p_created_by))
  returning * into g;
  return grant_json(g);
end $$;

-- Ends a grant now; one already over is left as it was. False when there is no such grant.
create function grant_end(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update plan_grants set ends_at = now(), starts_at = least(starts_at, now())
  where id = p_id and (ends_at is null or ends_at > now());
  return exists (select 1 from plan_grants where id = p_id);
end $$;

-- A premium provider's purchase: created on first sight, then updated in place (renewal moves
-- ends_at on, cancellation sets it to the period end, a refund to now).
create function grant_apply(
  p_user uuid, p_plan text, p_provider text, p_ref text, p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g plan_grants;
begin
  insert into plan_grants (user_id, plan, source, provider, provider_ref, starts_at, ends_at)
  values (p_user, p_plan, 'purchase', p_provider, p_ref, p_starts_at, p_ends_at)
  on conflict (provider, provider_ref) do update
    set plan = excluded.plan, starts_at = excluded.starts_at, ends_at = excluded.ends_at
    where plan_grants.user_id = excluded.user_id
  returning * into g;
  if g.id is null then
    raise exception 'purchase % belongs to another account', p_ref using errcode = 'P0001';
  end if;
  return grant_json(g);
end $$;

-- The export now carries the user's grants too.
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
    )
  )
$$;

revoke all on function grant_json(plan_grants), grants_active(uuid), grants_list(),
  grant_add(text, text, timestamptz, text, text), grant_end(uuid),
  grant_apply(uuid, text, text, text, timestamptz, timestamptz), account_export(uuid)
  from public, anon, authenticated;
grant execute on function grant_json(plan_grants), grants_active(uuid), grants_list(),
  grant_add(text, text, timestamptz, text, text), grant_end(uuid),
  grant_apply(uuid, text, text, text, timestamptz, timestamptz), account_export(uuid)
  to service_role;
