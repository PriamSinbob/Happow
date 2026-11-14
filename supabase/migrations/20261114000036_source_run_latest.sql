-- The ingest dispatcher (Worker cron) reads the latest run of each source in each region, per
-- status: a fixed number of rows (regions × sources × 4) however long the schedules are. Reading
-- recent runs instead is cut at the API's row limit once a monthly job runs in ten regions.
-- security_invoker: callers see what source_runs' RLS lets them see (only the service role).
create view source_run_latest with (security_invoker = true) as
  select source_id, region_id, status, max(started_at) as started_at
  from source_runs
  group by source_id, region_id, status;

revoke all on source_run_latest from public, anon, authenticated;
grant select on source_run_latest to service_role;
