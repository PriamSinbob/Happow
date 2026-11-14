# Happow

Happening Now: a map-first app that shows every nearby event of any kind happening now, within hours, or in the next days. The reach is small by default (about 500 m) and adjustable; when nothing is in reach, the map itself shows where things are. It covers ten Polish cities with their suburbs (Wrocław first) and is meant for every city in Poland and beyond: every source, region and provider is config.

**Direction:** Happow is an Android app, then an iOS app, each built in its own repository against this one's API ([docs/NATIVE.md](docs/NATIVE.md)). This repository holds the server, database, ingest, config and the web app. The web app is not launched as a product: it serves shared event links and embeds on other sites, and it is the reference client where every behaviour is built and tested first.

## Principles

- **Every event is shown to everyone, equally.** No paid placement, paid ranking, ads on the map or sale of location data. Money may only come from event add-ons and user features.
- **Config, not code.** Sources, regions, categories, plans, theme and providers live in `config/`; a new city is a config change plus at most one adapter. Apps read it from `GET /api/config`, so a new city needs no app release.
- **One API for every client.** Apps, embeds and the web read and write through `/api` ([docs/API.md](docs/API.md)) and sign in with Supabase Auth; no client touches the database. Installed apps are never broken: fields are added, never renamed or removed.
- **Native apps are the product; the web is the reference.** Nothing is removed from the web app: it is where behaviour is defined, tested and shared.
- **Legal by default.** Prefer official APIs and published structured data; honour robots.txt and TDM reservations; no logged-in scraping; store facts and link back, never republish crawled descriptions or images; keep personal data minimal (no account needed to browse, salted device hashes); terms, report button, moderation and takedown for user content.

## Repository layout

| Path                   | What                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `apps/web`             | Reference client: React + Vite PWA (MapLibre GL), Polish and English UI  |
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

Without `VITE_SUPABASE_URL` the web app serves the region's seed file. Geolocation on a phone needs HTTPS: use a deployed preview or a tunnel. `pnpm dev` also serves `/api` when `.env` has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUBMITTER_SALT` (see `.env.example`).

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

Checks: `pnpm format:check && pnpm typecheck && pnpm test && pnpm build`. Before launch: `pnpm launch:check`. Run the checks once, when the work is accepted, not after every change; each push also runs them in CI, so push once at the end.

Moderators and admins sign in with an email code like everyone else; the role comes from the `moderators` table ([SETUP §4](docs/SETUP.md#4-moderators-the-admin-and-sign-in-codes)).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system, ingestion, API and app charts
- [docs/API.md](docs/API.md): the API every client is built against, and its compatibility rules
- [docs/NATIVE.md](docs/NATIVE.md): the Android and iOS apps: what they get from here, shared core, first server steps
- [docs/SETUP.md](docs/SETUP.md): hosted services, secrets, deploy, cron, admin
- [docs/DESIGN.md](docs/DESIGN.md): design rules
- [docs/REDESIGN.md](docs/REDESIGN.md): the redesign: decisions, picked features, order of work
- [docs/LAUNCH.md](docs/LAUNCH.md): what is left before a public launch
- [docs/FUTURE.md](docs/FUTURE.md): unbuilt ideas and open items
- [docs/CRAWLER.md](docs/CRAWLER.md) and [docs/legal](docs/legal): public pages rendered by the build

Map data © OpenStreetMap contributors; tiles by OpenFreeMap / OpenMapTiles; geocoding by Nominatim.
