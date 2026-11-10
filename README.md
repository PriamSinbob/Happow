# Happow

Happening Now: a map-first PWA that shows every nearby event of any kind happening now, within hours, or in the next days. The reach is small by default (about 500 m) and adjustable; when nothing is in reach, the map itself shows where things are. It runs in Wrocław, but every source, region and provider is config.

## Principles

- **Every event is shown to everyone, equally.** No paid placement, paid ranking, ads on the map or sale of location data. Money may only come from event add-ons and user features.
- **Config, not code.** Sources, regions, categories, plans, theme and providers live in `config/`; a new city is a config change plus at most one adapter.
- **PWA first, native later.** The PWA is feature-complete; a native rewrite (stores, widgets, native push) reuses the server, database and API.
- **Legal by default.** Prefer official APIs and published structured data; honour robots.txt and TDM reservations; no logged-in scraping; store facts and link back, never republish crawled descriptions or images; keep personal data minimal (no account needed to browse, salted device hashes); terms, report button, moderation and takedown for user content.

## Repository layout

| Path                   | What                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `apps/web`             | React + Vite PWA (MapLibre GL, OpenFreeMap tiles), Polish and English UI |
| `apps/web/worker`      | Cloudflare Worker: serves the app, `/api/*` from `packages/api`, cron    |
| `packages/core`        | Shared types, config schemas, geo/time/filter helpers, API contract      |
| `packages/ingest`      | Source adapters, normalizer, dedup, `pnpm ingest`                        |
| `packages/extract`     | JSON-LD parsing, robots.txt, SSRF-safe fetch, geocoder, Claude extractor |
| `packages/api`         | The `/api` fetch handler: `handler.ts` routes, one module per feature    |
| `config/`              | Regions, categories, sources, plans, map, theme, app defaults            |
| `data/`                | Seed events per region, districts                                        |
| `supabase/migrations/` | Postgres + PostGIS schema and RPCs                                       |
| `scripts/`             | `migrate`, `seed`, `districts`, `launch:check`, `push:keys`, DB tests    |

## Run

Requires Node 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev            # http://localhost:5173 — works without a backend (bundled seed data)
```

Without `VITE_SUPABASE_URL` the app serves the region's seed file. Geolocation on a phone needs HTTPS: use a deployed preview or a tunnel. `pnpm dev` also serves `/api` when `.env` has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUBMITTER_SALT` (see `.env.example`).

With a database:

```sh
cp .env.example .env    # set DATABASE_URL
pnpm db:reset           # local only: drop, migrate, seed
pnpm test:db            # all database integration tests
```

Against Supabase: `pnpm db:migrate && pnpm db:seed` (or the **Database migrate + seed** workflow).

Ingest:

```sh
pnpm ingest --dry-run                      # fetch + normalize, print, write nothing
pnpm ingest --source ticketmaster --force  # one source, ignoring its schedule
```

Adapter contract tests replay fixtures in `packages/ingest/test/fixtures` (no live calls in CI); `pnpm ingest --dry-run --source <id> --record packages/ingest/test/fixtures` re-records them.

Checks: `pnpm format:check && pnpm typecheck && pnpm test && pnpm build`. Before launch: `pnpm launch:check`.

Moderators and admins sign in with an email code like everyone else; the role comes from the `moderators` table ([SETUP §4](docs/SETUP.md#4-moderators-the-admin-and-sign-in-codes)).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system, ingestion, API and app charts
- [docs/SETUP.md](docs/SETUP.md): hosted services, secrets, deploy, cron, admin
- [docs/DESIGN.md](docs/DESIGN.md): design rules
- [docs/LAUNCH.md](docs/LAUNCH.md): what is left before a public launch
- [docs/FUTURE.md](docs/FUTURE.md): unbuilt ideas and open items
- [docs/CRAWLER.md](docs/CRAWLER.md) and [docs/legal](docs/legal): public pages rendered by the build

Map data © OpenStreetMap contributors; tiles by OpenFreeMap / OpenMapTiles; geocoding by Nominatim.
