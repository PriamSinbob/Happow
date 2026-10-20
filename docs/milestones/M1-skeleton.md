# Milestone 1 — Skeleton: report

Oct 20, 2026

## Built

- **Monorepo** (pnpm workspaces): `apps/web`, `packages/core`, `config/`, `data/seed/`, `supabase/migrations/`, `scripts/`.
- **Config-driven everything**: region (centre, bbox, timezone, enabled sources, seed file), 13-category taxonomy with pl/en labels, default durations, icons and colours, map provider, radius limits, H3 resolutions. Validated with zod plus cross-checks (unknown default region, unknown source, bad timezone, radius bounds). No city names or keys in code.
- **PWA shell**: React 19 + Vite, `vite-plugin-pwa` (manifest, icons including maskable, auto-updating service worker, cache-first map tiles, network-first API). MapLibre is split into its own long-cached chunk; h3-js loads only on the offline seed path.
- **Map**: MapLibre GL with the OpenFreeMap Positron (OSM) style and automatic fallback to OSM raster tiles; category-coloured pins, pulsing pins for events running now; dashed radius circle; the view fits the radius above the bottom panel; attribution always reachable.
- **Geolocation**: watches position; falls back to the region centre with a dismissible banner when denied, unavailable, or outside the region; locate button retries.
- **Radius slider**: 100 m – 25 km on a log scale with snapped values, default 500 m, remembered per device.
- **List toggle**: same filter state as the map; sorted by distance (10 m buckets) then start time; empty state offers a one-tap larger radius.
- **Event preview card** (tap a pin or row): categories, source badge, now/until or start-in, price/free, venue and address, distance and walking time, rules with translated labels, estimated-end footnote, Navigate (hands off to Apple/Google Maps), website, tickets.
- **i18n**: Polish and English from the start, with language detection, a toggle, and Polish plural forms.
- **Database**: Postgres + PostGIS schema following the brief's data model (regions, categories, sources, venues, events, event_sources, submissions, weather_cache), H3 r9 cells computed in code, RLS with public read, and `events_near(lat, lng, radius_m, from_ts, to_ts)` callable by the anon role through Supabase PostgREST.
- **Seed**: 20 hand-entered events at real Wrocław venues (fictional programmes). Times are offsets from now, so the demo always has events running now, soon and later today, plus one tomorrow, which tests the "today" window. The same materializer feeds the DB seed and the offline web fallback.
- **Data access**: an `EventRepository` interface with Supabase (PostgREST RPC) and static (bundled seed) implementations, chosen by env.
- **Tests and CI**: core unit tests (config, geo, radius scale, end-time estimation, sorting, seed validity, timezone/DST day bounds); web tests (i18n key/placeholder parity, Polish plurals, repositories, formatting); DB integration test against PostGIS (radius, ordering, time overlap, anon permissions). The CI workflow runs format, typecheck, tests and build, plus a PostGIS service container for the DB test. The Cloudflare Pages deploy and the manual Supabase migrate/seed workflows are gated on their secrets.

## Skipped / deferred (by milestone plan)

- Time-window chips, category and price filters, and the full event detail screen are milestone 2. The data layer already takes a time window; M1 shows "the rest of today".
- Real adapters, normalizer, dedup and scheduler: milestone 2. No adapter exists yet, so there are no adapter contract tests yet.
- Weather, hotspots, off-screen chevrons and the smart empty-radius guidance: milestone 3. M1's empty state only offers "expand radius".
- Add calendar (.ics), share, save and report actions: later milestones.

## Open issues

- **Hosting not connected yet**: needs a Supabase project (`DATABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) and Cloudflare (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) secrets. Until then the web build uses the bundled seed.
- **Migrations were tested on plain Postgres 16 + PostGIS 3**, not on a live Supabase project. They create the `anon`/`authenticated` roles only if missing and install PostGIS into the `extensions` schema, matching Supabase conventions.
- **Seed times are relative**: the hosted DB seed goes stale after a day unless the migrate/seed workflow is re-run. This disappears once real sources land in M2.
- **OpenFreeMap** is free with no key and no SLA. The raster fallback uses tile.openstreetmap.org, whose usage policy is fine for a PoC but not for production traffic.
- **Category icons are emoji**, which render differently per OS. Consider an SVG icon set in the M3 UI pass.
- Only verified in headless Chromium at 380 px. A real-device check on iOS Safari and Android Chrome in Wrocław is still to do.
