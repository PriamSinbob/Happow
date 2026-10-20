# Happow

Happening Now — a map-first app that shows every nearby event of any kind happening now, within hours, or today. Map overview with a list view, event-type filters (music, theatre, happening, festival, garage sale, etc.), event details (start, end, official site, price, rules, weather at the spot now and at the event's end). Default range is small (about 500 m) and adjustable.

See [docs/BRIEF.md](docs/BRIEF.md) for the full PoC build brief: scope, decisions, data sources, architecture and milestones. Milestone reports live in [docs/milestones](docs/milestones).

## Repository layout

| Path                   | What                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `apps/web`             | React + Vite PWA (MapLibre GL, OSM tiles via OpenFreeMap), Polish and English UI      |
| `packages/core`        | Shared types, config schemas, geo/time helpers, seed materializer                     |
| `config/`              | Regions, categories, sources, map provider, app defaults — everything region-specific |
| `data/seed/`           | Hand-entered demo events per region (times are offsets from now)                      |
| `supabase/migrations/` | Postgres + PostGIS schema and the `events_near` geo query                             |
| `scripts/`             | `migrate`, `seed` and the database integration test                                   |

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

### Checks

```sh
pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

## Configuration

Adding a region is a config change: add it to `config/regions.json` (centre, bbox, timezone, enabled sources, optional seed file) and, if needed, set `defaultRegion` in `config/app.json` or `VITE_REGION_ID` at build time. Categories (labels, default durations, icons, colours) are in `config/categories.json`. The map style and tile hosts are in `config/map.json`.

## Deployment

| Workflow                                                             | Needs                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` — format, typecheck, tests, build, PostGIS integration test | nothing                                                                                                                                                                          |
| `deploy-web.yml` — Cloudflare Pages on push to `main`                | secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; optional `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; optional variable `CLOUDFLARE_PAGES_PROJECT` (default `happow`) |
| `db-migrate.yml` — manual migrate + seed                             | secret `DATABASE_URL`                                                                                                                                                            |

Secrets live only in GitHub Secrets or a local `.env` (never committed).

## Attribution

Map data © OpenStreetMap contributors; tiles by OpenFreeMap / OpenMapTiles.
