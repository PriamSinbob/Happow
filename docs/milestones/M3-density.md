# Milestone 3 — Density: report

Oct 20, 2026

## Scope change

Weather is out of the PoC (owner's decision, 2026-10-20). The brief's Decisions table, core features, architecture diagram, data model, legal notes and milestone list were updated. The weather research (MET Norway, IMGW, Open-Meteo, Pirate Weather, cost control) now sits under **Future features** in the brief, so nothing is lost. In code, the unused `h3.weatherResolution` setting is gone and migration 3 drops the `weather_cache` table. Milestone 3 is now **Density** only.

## Built

- **Density cells.** Every event now also carries an H3 cell at `h3.densityResolution` (r8, about 0.7 km²). The cell is computed in code by the seed, the ingest normalizer and the offline repository, and stored as `events.density_cell` (migration 3). Rows written before the migration fall back to `h3_r9` until their next ingest or seed run.
- **`density_near` (Postgres).** Counts the events that match the same window, category and price rules as `events_near`, per density cell, within `density.searchRadiusM` (5 km). Each cell returns:
  - its centroid and event count;
  - how many of its events lie beyond the user's own radius, and the nearest of them;
  - its most common venue name, used to name the spot.

  The function is callable by the anon role. The offline repository uses the same logic in TypeScript (`densityClusters` in core), so the bundled demo behaves like the hosted database.

- **Hotspot.** The busiest cell within 5 km, if it has at least `density.hotspotMinEvents` events (3), with ties going to the nearer cell. When part of it is outside the circle, the map shows a pulsing orange marker with the event count. Tapping it opens a card: "Busiest: Rynek, 860 m, 3 events", with **Expand to …** and **Take me there** (walking navigation).
- **Off-screen chevrons.** Pills on the map edge point to clusters outside the visible map: "↗ 1.2 km · 7". They show the distance to the cluster's nearest event and the cluster's count. They work as follows:
  - Each pill sits where the line from the view's centre to the cluster leaves the visible area, clear of the top bars, the attribution button and the bottom sheet, including any open card.
  - They are nearest first, capped at `density.maxChevrons` (6), kept apart so they never overlap, and faded with distance.
  - They follow the map as it pans. Tapping one moves the map there.
- **Outside-radius bubbles.** Clusters that are on screen but beyond the circle show a dashed count bubble. Tapping it widens the radius just enough to include them.
- **Empty-radius guidance.** An empty circle never shows a blank screen. The map and the list both say "Nothing within 100 m. Nearest: 580 m north. Busiest: Rynek, 860 m, 3 events." with **Expand to 600 m** (the smallest snapped radius that reaches the nearest event), **Take me there** and, when filters are on, **Clear filters**. With nothing within 5 km, the card says so and falls back to the old "expand ×2.5" button.
- **Strings.** All new strings are in Polish and English, including 8-point compass directions and Polish plurals.
- **Fix carried over from M2.** When two listings from one source merged, `source_url` could pick either one at random, and one database test was flaky because of it. The view now prefers the exact owning listing.
- **Tests (all passing locally).**
  - Core: 28 (bearings and compass points, density clusters, hotspot, nearest-outside, `snapRadiusUp`).
  - Ingest: 41.
  - Web: 19 (offline density versus `near()`, the `density_near` request and row mapping, guidance, direction strings).
  - PostGIS: 16. They check that `density_near` counts exactly the same events as `events_near`, that inside plus outside counts add up, that filters apply, that seeded and ingested events have density cells, that `weather_cache` is gone, and that the anon role can call the function. The detail test now passes on five runs in a row.
- **UI check.** Headless Chromium at 380 px, in Polish and English: empty-radius guidance on the map and in the list, the hotspot card, chevrons before and after panning and after a tap, and the expand action. No console errors. Two problems found in this check were fixed: pills half off the screen edge, and pills hidden behind an open card.

## Skipped

- Hotspot naming uses the most common venue in the cell. When that venue sits away from the cell's centroid, the name and distance can disagree slightly ("Rynek, 370 m"). A dedicated "area name" (e.g. from OSM places) is not in scope.
- Chevrons point to cells, not to individual events. A cell spanning the radius edge is counted as one cluster.
- No server-side caching of density results. The query runs with each event refresh (every minute or after a change), which is fine at PoC volumes.

## Open issues

- **Apply migration 3 to Supabase.** Run the **Database migrate + seed** workflow, then re-seed or let ingestion run so existing rows get `density_cell`.
- **Thresholds.** The values in `config/app.json` (r8 cells, 5 km search, 3 events for a hotspot, 6 chevrons) are tuned on the 20 demo events. Review them with real Ticketmaster and Meetup data on a phone in Wrocław.
- **Real-device check** on iOS Safari and Android Chrome is still to do, including how the pills behave with the browser toolbar showing and hidden.
