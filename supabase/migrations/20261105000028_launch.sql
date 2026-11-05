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
