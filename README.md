# Happow

Happening Now — a map-first app that shows every nearby event of any kind happening now, within hours, or today. Map overview with a list view, event-type filters (music, theatre, happening, festival, garage sale, etc.), event details (start, end, official site, price, rules, weather at the spot now and at the event's end). Default range is small (about 500 m) and adjustable.

See [docs/BRIEF.md](docs/BRIEF.md) for the full PoC build brief: scope, decisions, data sources, architecture and milestones. Milestone reports live in [docs/milestones](docs/milestones).

## Repository layout

| Path                   | What                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `apps/web`             | React + Vite PWA (MapLibre GL, OSM tiles via OpenFreeMap), Polish and English UI      |
| `packages/core`        | Shared types, config schemas, geo/time/filter helpers, seed materializer              |
| `packages/ingest`      | Source adapters (Ticketmaster, Meetup), normalizer, dedup, scheduler, `pnpm ingest`   |
| `config/`              | Regions, categories, sources, map provider, app defaults — everything region-specific |
| `data/seed/`           | Hand-entered demo events per region (times are offsets from now)                      |
| `supabase/migrations/` | Postgres + PostGIS schema, `events_near` (filtered geo query) and `event_by_id`       |
| `scripts/`             | `migrate`, `seed` and the database integration tests                                  |

## Quick start

Requires Node 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev            # http://localhost:5173 — works without a backend (bundled seed data)
```

Without `VITE_SUPABASE_URL` the app serves the region's seed file directly, so the UI can be demoed on a phone with no database. Open the dev server from your phone on the same network (`vite --host` prints the address); geolocation on a phone needs HTTPS, so use a deployed preview or a tunnel for real GPS.

### With a database

```sh
cp .env.example .env                 # set DATABASE_URL
pnpm db:reset                        # local only: drop, migrate, seed
pnpm test:db                         # geo query integration test
```

Against Supabase: set `DATABASE_URL` to the project's connection string and run `pnpm db:migrate && pnpm db:seed` (or the **Database migrate + seed** workflow). Then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the web build.

### Ingesting real events

```sh
pnpm ingest --dry-run                      # fetch + normalize, print, write nothing
pnpm ingest                                # run every due source into DATABASE_URL
pnpm ingest --source ticketmaster --force  # one source, ignoring its schedule
```

Each source in `config/sources.json` names its adapter, schedule, rate limit, trust level, required secrets, category mapping and API cache limit. Raw payloads are stored unchanged (`raw_payloads`), normalized into `events`, and merged with existing events when they share an H3 neighbourhood, start within 30 minutes and have similar titles; the highest-trust source owns the merged event. Adapter contract tests replay fixtures in `packages/ingest/test/fixtures` (no live calls in CI); `pnpm ingest --dry-run --source <id> --record packages/ingest/test/fixtures` re-records them.

### Checks

```sh
pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

## Configuration

Adding a region is a config change: add it to `config/regions.json` (centre, bbox, timezone, country code, enabled sources, optional seed file), list it in each source's `regionIds`, and, if needed, set `defaultRegion` in `config/app.json` or `VITE_REGION_ID` at build time. Categories (labels, default durations, icons, colours) are in `config/categories.json`. Time-window chips, dedup thresholds and ingestion windows are in `config/app.json`. The map style and tile hosts are in `config/map.json`.

## Deployment

| Workflow                                                             | Needs                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` — format, typecheck, tests, build, PostGIS integration test | nothing                                                                                                                                                                          |
| `deploy-web.yml` — Cloudflare Pages on push to `main`                | secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; optional `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; optional variable `CLOUDFLARE_PAGES_PROJECT` (default `happow`) |
| `db-migrate.yml` — manual migrate + seed                             | secret `DATABASE_URL`                                                                                                                                                            |
| `ingest.yml` — every 15 min, runs due sources                        | secret `DATABASE_URL`; per source `TICKETMASTER_API_KEY`, `MEETUP_CLIENT_KEY`, `MEETUP_MEMBER_ID`, `MEETUP_SIGNING_KEY_ID`, `MEETUP_PRIVATE_KEY`                                 |

Secrets live only in GitHub Secrets or a local `.env` (never committed).

## Attribution

Map data © OpenStreetMap contributors; tiles by OpenFreeMap / OpenMapTiles. Event data from Ticketmaster and Meetup links back to the source listing.
