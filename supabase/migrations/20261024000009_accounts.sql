-- M8 slice A: user accounts. Profiles, staff roles and sign-in code requests sent by hand
-- (docs/milestones/M8-accounts-premium.md §2). The API reaches all of this through the
-- service-role functions below; row-level security is the backstop for direct PostgREST access.

-- ---------- Supabase Auth on plain Postgres ----------

-- Supabase provides auth.users and auth.uid(). Plain Postgres (local, CI) gets a minimal stand-in
-- with the columns used here, so the trigger, policies and DB tests run the same everywhere.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      last_sign_in_at timestamptz,
      created_at timestamptz not null default now()
    );
    -- Same claim lookup as Supabase: the user id of the request's JWT, null when anonymous.
    create function auth.uid() returns uuid language sql stable as $f$
      select nullif(coalesce(
        current_setting('request.jwt.claim.sub', true),
        current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
      ), '')::uuid
    $f$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  end if;
end $$;

-- ---------- Profiles ----------

create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Optional; shown only to people one invites or is invited by (M11).
  display_name text check (char_length(display_name) between 1 and 60),
  locale text,
  -- The terms and privacy notice version the user accepted, and when.
  terms_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "own profile" on profiles for select to authenticated using (user_id = auth.uid());
grant select on profiles to authenticated;

create function happow_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

create trigger happow_new_user after insert on auth.users
  for each row execute function happow_new_user();

-- ---------- Staff roles ----------

-- Moderators review the queue; the admin (the owner) also sends sign-in codes and, from slice B,
-- grants plans. Rows are added by hand: see docs/SETUP.md.
alter table moderators add column role text not null default 'moderator'
  check (role in ('moderator', 'admin'));

create function staff_role(p_email text)
returns text
language sql
stable
security definer
set search_path = public
as $$ select role from moderators where email = lower(p_email) $$;

-- ---------- Sign-in codes sent by hand (auth.emailDelivery = "manual") ----------

create table code_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  locale text not null,
  client_hash text not null,
  created_at timestamptz not null default now(),
  generated_at timestamptz
);

-- One open request per email: asking again only refreshes it.
create unique index code_requests_open_idx on code_requests (email) where generated_at is null;

-- No policies: only the service role reads these.
alter table code_requests enable row level security;

create function request_code(p_email text, p_locale text, p_client text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into code_requests (email, locale, client_hash)
  values (lower(p_email), p_locale, p_client)
  on conflict (email) where generated_at is null
  do update set locale = excluded.locale, client_hash = excluded.client_hash, created_at = now();
$$;

-- Open and generated requests, oldest first. Drops requests older than p_retention_days and
-- those whose code was used (the user signed in after it was generated).
create function code_requests_list(p_retention_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from code_requests where created_at < now() - make_interval(days => p_retention_days);
  delete from code_requests r using auth.users u
  where r.generated_at is not null and lower(u.email) = r.email and u.last_sign_in_at > r.generated_at;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'email', r.email, 'locale', r.locale,
      'createdAt', r.created_at, 'generatedAt', r.generated_at,
      'existingUser', exists (select 1 from auth.users u where lower(u.email) = r.email)
    ) order by r.created_at)
    from code_requests r
  ), '[]'::jsonb);
end $$;

create function code_request_get(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'email', email, 'locale', locale, 'generatedAt', generated_at)
  from code_requests where id = p_id
$$;

create function code_request_mark(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A newer open request for the same email would collide with the open index: drop it.
  delete from code_requests o using code_requests r
  where r.id = p_id and o.email = r.email and o.id <> r.id and o.generated_at is null;
  update code_requests set generated_at = now() where id = p_id;
  return found;
end $$;

create function code_request_delete(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from code_requests where id = p_id;
  return found;
end $$;

-- ---------- Account ----------

-- The user's profile; created here too for users made before this migration (moderators).
create function profile_get(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p profiles;
begin
  insert into profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into p from profiles where user_id = p_user;
  return jsonb_build_object(
    'displayName', p.display_name, 'locale', p.locale, 'termsVersion', p.terms_version,
    'termsAcceptedAt', p.terms_accepted_at, 'createdAt', p.created_at
  );
end $$;

-- Null arguments leave a field as it is; a new terms version stamps the acceptance time.
create function profile_update(p_user uuid, p_locale text, p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform profile_get(p_user);
  update profiles set
    locale = coalesce(p_locale, locale),
    terms_accepted_at = case
      when p_terms_version is not null and p_terms_version is distinct from terms_version then now()
      else terms_accepted_at end,
    terms_version = coalesce(p_terms_version, terms_version)
  where user_id = p_user;
  return profile_get(p_user);
end $$;

-- Everything stored for the user (GDPR export). Later slices add their own parts.
create function account_export(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$ select jsonb_build_object('profile', profile_get(p_user)) $$;

-- Before the auth user is deleted (which cascades to the profile): open code requests by email.
create function account_forget(p_user uuid, p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from code_requests where email = lower(p_email);
  delete from profiles where user_id = p_user;
$$;

revoke all on function staff_role(text), request_code(text, text, text), code_requests_list(integer),
  code_request_get(uuid), code_request_mark(uuid), code_request_delete(uuid), profile_get(uuid),
  profile_update(uuid, text, text), account_export(uuid), account_forget(uuid, text),
  happow_new_user() from public, anon, authenticated;
grant execute on function staff_role(text), request_code(text, text, text),
  code_requests_list(integer), code_request_get(uuid), code_request_mark(uuid),
  code_request_delete(uuid), profile_get(uuid), profile_update(uuid, text, text),
  account_export(uuid), account_forget(uuid, text) to service_role;
