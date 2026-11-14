-- Regular services (worship-services) follow a weekly pattern that rarely changes, so the ingest
-- reads OSM's service times once a year and the database carries the pattern forward itself:
-- every occurrence is copied to the same weekday and wall-clock time in later weeks, up to
-- p_days ahead. The Worker's cron calls this every hour; it only adds what is missing.
--
-- An occurrence hidden by a report or by the yearly read (no longer listed) is not copied
-- forward. Copies keep the event id scheme of the ingest ("source:osmId|YYYY-MM-DDTHH:MI"), so
-- the yearly read updates them instead of adding duplicates. Base occurrences of the last four
-- weeks count, so a few weeks without the cron still catch up.
create function services_roll_forward(p_source text, p_days integer)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  added integer;
begin
  with base as (
    select e.*, e.start_at at time zone e.timezone as local_start,
      e.end_at at time zone e.timezone as local_end,
      split_part(e.primary_external_id, '|', 1) as osm_id,
      es.source_url
    from events e
    left join event_sources es on es.source_id = p_source
      and es.external_id = e.primary_external_id
    where e.primary_source_id = p_source and not e.hidden
      and e.start_at > now() - interval '28 days'
      and e.primary_external_id like '%|%'
  ), shifted as (
    select b.*, k,
      (b.local_start + make_interval(days => 7 * k)) at time zone b.timezone as n_start,
      (b.local_end + make_interval(days => 7 * k)) at time zone b.timezone as n_end,
      b.osm_id || '|' || to_char(b.local_start + make_interval(days => 7 * k),
        'YYYY-MM-DD"T"HH24:MI') as n_ext
    from base b, generate_series(1, p_days / 7 + 5) as k
  ), wanted as (
    select distinct on (n_ext) * from shifted
    where n_start > now() and n_start <= now() + make_interval(days => p_days)
    order by n_ext, k
  ), ins as (
    insert into events (id, region_id, title, description, category_ids, start_at, end_at,
      end_estimated, timezone, venue_id, point, h3_r9, price_min, price_max, currency, is_free,
      rules, official_url, ticket_url, image_url, status, trust, confidence, last_seen_at,
      primary_source_id, primary_external_id, density_cell, entry, grace_min, age_min, family)
    select p_source || ':' || w.n_ext, w.region_id, w.title, w.description, w.category_ids,
      w.n_start, w.n_end, w.end_estimated, w.timezone, w.venue_id, w.point, w.h3_r9,
      w.price_min, w.price_max, w.currency, w.is_free, w.rules, w.official_url, w.ticket_url,
      w.image_url, 'scheduled', w.trust, w.confidence, now(), p_source, w.n_ext,
      w.density_cell, w.entry, w.grace_min, w.age_min, w.family
    from wanted w
    on conflict (id) do nothing
    returning id, primary_external_id
  ), linked as (
    insert into event_sources (event_id, source_id, external_id, source_url, raw_payload_ref,
      fetched_at)
    select i.id, p_source, i.primary_external_id,
      (select w.source_url from wanted w where w.n_ext = i.primary_external_id),
      p_source || '/' || i.primary_external_id, now()
    from ins i
    on conflict (source_id, external_id) do nothing
    returning 1
  )
  select count(*) into added from ins;
  return added;
end $$;

revoke all on function services_roll_forward(text, integer) from public, anon, authenticated;
grant execute on function services_roll_forward(text, integer) to service_role;

-- The roll-forward and the yearly read look occurrences up by source and start.
create index events_primary_source_start_idx on events (primary_source_id, start_at);
