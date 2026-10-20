# Milestone 2 — Official APIs: report

Oct 20, 2026

## Built

- **Ingestion package** (`packages/ingest`). Each adapter implements the brief's contract, `fetch(region, window) → RawEvent[]`, plus `parse(raw) → ParsedEvent`, so stored payloads can be re-parsed without fetching again. Endpoints, page sizes, schedules, rate limits, trust levels, required secrets, API cache limits and source-label → category maps all live in `config/sources.json`. Adding a source means adding config and at most one adapter.
- **Ticketmaster Discovery v2 adapter.** It searches with a geohash and a radius that covers the region's bounding box, the region's country code and a lookback/lookahead window, and pages until `totalPages`, stopping at the API's 1,000-result deep-paging cap. It handles:
  - UTC and local-only times, and day-long listings (`noSpecificTime`).
  - Cancelled and postponed statuses.
  - Classification hierarchy (the most specific mapped label wins).
  - Price ranges (plain `standard` ranges are preferred over "including fees" duplicates).
  - Age and accessibility rules, and picks a ~640 px 16:9 image.
- **Meetup adapter.** It targets the `gql-ext` endpoint with the server-to-server OAuth JWT bearer flow (RS256 signing in `node:crypto`; the private key may hold literal `\n`). It follows cursor pagination, drops online-only events and Meetup's "Online event" placeholder venues, derives the end from `endTime` or the ISO 8601 `duration`, and maps the fee, cover photo and group topic category. The query lives in `adapters/meetup.graphql`, so it can be adjusted without touching code.
- **HTTP client.** Per-source throttling from `rateLimit` ("5/s"), retries with exponential backoff on 429 and 5xx responses and network errors, `Retry-After` support, 20 s timeouts, and the identifying User-Agent from config. Credentials are masked in every logged URL and error.
- **Normalizer.** Cleans titles, strips HTML, entities and Markdown from descriptions and truncates them (copyright: store facts, link back). Maps categories through config, estimates missing ends from category defaults, and handles free or zero prices. Computes the H3 r9 cell, stamps `last_seen_at` and the API cache expiry (`stale_after`), and rejects events with no title, a bad date, no location, or a location outside the region. Rejection counts are reported per run.
- **Deduplication.** A pure, unit-tested decision function. Two listings merge when they share an H3 r9 neighbourhood (1 ring, so venues on a cell edge still match), start within 30 minutes, and have similar titles (Dice bigram score or token containment, ignoring diacritics, punctuation and filler words). Thresholds are in `config/app.json`. The highest-trust source owns the primary fields (trust first, then order in `sources.json`), and the other listings fill gaps such as a real end time, ticket link or image. Ownership belongs to a specific listing, so two equal-rank listings of one show never flip the title back and forth between runs.
- **Store and scheduler.** One transaction per source run:
  1. Upsert the raw payloads.
  2. Resolve each listing to its existing event, a duplicate, or a new event.
  3. Write venues, events and `event_sources` links.

  `source_runs` records every run with its stats and errors, and is what the scheduler checks to see whether a source is due. `pnpm ingest` supports `--source`, `--region`, `--force`, `--dry-run` (no database needed) and `--record <dir>` (re-records fixtures and never writes token responses). The GitHub Actions workflow `ingest.yml` runs every 15 minutes, is gated on `DATABASE_URL`, and skips each source whose secrets are missing.

- **Database (migration 2).** Adds:
  - On `events`: `primary_source_id`, `primary_external_id` and `stale_after`, plus an (h3, start) index.
  - Tables `raw_payloads` (latest payload per listing) and `source_runs`, both closed to anon.
  - Public read of `event_sources`.
  - An `events_public` view (security invoker) that hides events past their API cache age.
  - `events_near(…, categories, price)` with category-overlap and free/paid filters, and `event_by_id` for details and shared links. Both return the venue website, the primary source and the source URL.
- **Web.**
  - **Time-window chips:** Now (start ≤ now ≤ end), 2 h, 6 h, Today. They are defined in config, the default is "Today", and the choice is remembered per device.
  - **Filter sheet:** category multi-select across the 13-category taxonomy, plus free/paid/any. Filters apply live behind the sheet with a pluralised "Show N events" button, an active-filter badge, and a "Clear filters" option in the empty state.
  - **Event detail screen** at `#/e/<id>`:
    - Hero image or category art, categories and trust badge.
    - Cancelled/postponed banner.
    - Day, time range or "all day"; now/until/starts-in.
    - Venue, address, distance and walking time; price.
    - Navigate, tickets and website.
    - Add to calendar (RFC 5545 `.ics`, escaped and folded), share (Web Share API with a copy-link fallback) and save (per device).
    - Description and rules.
    - "via Ticketmaster · checked 5 min ago" with links to the source page and the venue website.

    Deep links open straight into the detail screen (fetched by id when the event is outside the current filters). Back closes it, and Escape closes dialogs. Every new string exists in Polish and English, including Polish plural forms and the new `=0` plural branch in the formatter.
- **Tests (all passing locally).**
  - **Core:** 21 tests (time windows, filters, config cross-checks, DST-safe local time).
  - **Ingest:** 41 tests: Ticketmaster and Meetup contract tests against fixtures (request shape, auth, pagination, parse schema, mapping, rejections), plus dedup, normalizer, HTTP client and scheduler tests.
  - **Web:** 12 tests (repository filters, `byId`, Supabase RPC payloads, ICS, i18n).
  - **PostGIS:** 11 tests (M1 queries plus ingest-into-database: in-batch merge, idempotent re-runs, not-due skip, category/price filters, anon detail access, stale hiding).
  - **UI:** checked in headless Chromium at 380 px and 320 px in Polish and English: no horizontal scroll and no console errors; back button and shared links checked.

## Skipped / deferred

- **Fixtures are not live recordings.** No Ticketmaster or Meetup keys were available, so the fixtures follow each API's documented response shape with illustrative IDs and programmes. Run `pnpm ingest --dry-run --source <id> --record packages/ingest/test/fixtures` once keys exist, then update the test expectations.
- **Report as wrong/cancelled** needs a write path and moderation. It is part of milestone 4 (submissions and moderation).
- **Saved events** are stored per device, but there is no "Saved" list view yet. That belongs with the later user features.
- **Geocoding** (pipeline step 4) is not needed for these two APIs, which return coordinates. Events without coordinates are rejected and counted. Nominatim arrives with the crawler in milestone 4.
- **Cross-source venue merging.** Venues are keyed per source (`ticketmaster:<id>`), and only events are deduplicated.
- **"Possibly cancelled" after two missed fetches** is milestone 5. API events already disappear once they pass `stale_after` (24 h without confirmation).
- Weather, hotspots, chevrons and smarter empty-radius guidance remain milestone 3.

## Open issues

- **Meetup schema is unverified.** Meetup's public docs name `eventSearch` (which replaced `keywordSearch` in the 2025 `gql-ext` migration) but do not document its filter input or the venue and fee fields. `meetup.graphql` uses the field names from the migration guide, and the parser accepts both old and new shapes. Before relying on it, introspect `https://api.meetup.com/gql-ext` with a real token. Meetup API access is a **Meetup Pro** feature, so someone needs to decide whether that subscription is worth it for the PoC.
- **Secrets to add** in GitHub Secrets: `DATABASE_URL`, `TICKETMASTER_API_KEY`, and `MEETUP_CLIENT_KEY`, `MEETUP_MEMBER_ID`, `MEETUP_SIGNING_KEY_ID`, `MEETUP_PRIVATE_KEY`. Supabase must also have migration 2 applied (the **Database migrate + seed** workflow).
- **Ticketmaster coverage of Wrocław is unknown** until a real run. Watch the `source_runs.stats` rejection counts after the first runs.
- **Quotas.** Ticketmaster runs hourly with up to 5 pages, which is at most 120 calls a day against 5,000. GitHub disables scheduled workflows in public repos after 60 days without repository activity, so the cron needs a commit or a manual run within that time.
- **Seed demo events** are still enabled alongside the real sources. Turn them off (`enabled: false` for `seed`, then re-seed) once real data is flowing, or they mix fictional programmes with real ones.
- **Dedup thresholds** (0.5 similarity, 30 min, 1 H3 ring) are tuned on the fixtures only. Review the merges after a week of real data.
