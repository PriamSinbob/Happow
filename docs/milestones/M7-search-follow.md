# Milestone 7 — Search and followed artists: spec

Oct 22, 2026

Spec agreed with the owner on 2026-10-22, to be built after M6 (it uses M6's list overlay, icon set and pin badges). Moved by the owner on 2026-10-24: built after M12, just before M13, as the hyper-local milestones 8–12 matter more. It then builds on M8's accounts. Build it in the usual way: plan, show the plan, build, then replace the "Status" line with the report.

**Status:** spec, not built. Build plan below (2026-10-24); each slice's detailed plan goes to the owner before building.

## Build plan

Written on 2026-10-24. As in M6, M7 ships as slices, one branch and one PR to `main` each. The data and API slices come first, so the live app keeps working between PRs. Each slice PR updates its row below and the Status line, and adds a short "Built (slice X)" note under its spec section (built, skipped, open).

The PWA is built feature-complete before the native rewrite, the last milestone (brief, 2026-10-24). So every slice is built in full, UI included, and the web UI becomes the reference for the native app. The server side (tables, RPCs, `/api/search`, `/api/follows/match`) stays as it is, so it is shaped for a native client to use unchanged. Speed is not tested on the web build.

| Slice | Spec           | What                                                                    | Needs | Status  |
| ----- | -------------- | ----------------------------------------------------------------------- | ----- | ------- |
| A     | §1, §3         | Performers in the data from every source; 60-day ingest for API sources | —     | planned |
| B     | §2 API, §9     | `f_unaccent`, trigram indexes, `search_events` RPC, `GET /api/search`   | A     | planned |
| C     | §2 UI, §4 chip | Mockup first; search in the list overlay, performer chips on the card   | B     | planned |
| D     | §4             | Follows on the device, `POST /api/follows/match`, ★ on pins and cards   | B, C  | planned |
| E     | §4 nationwide  | Ticketmaster nationwide lookups, `follow_lookups` cache, city in list   | D     | planned |
| F     | §7             | Meetup public pages through the crawler (config + fixtures)             | —     | planned |
| G     | §5             | Follows synced per account; new-date alerts (web push, email)           | D, M8 | planned |
| H     | §4.1           | "My plans" filter: one tap shows only saved events and invitations      | —     | planned |
| —     | §6             | Last.fm import dropped                                                  | —     | dropped |

### Slice A: performers and horizon

- **Migration 9** `event_performers (event_id, name, norm, source_id, external_id)`, primary key `(event_id, norm)`, cascade on event delete. `publish_event` writes the performers it gets. A merge takes the union, keyed by `norm`; when the same name has an `external_id`, that one wins.
- **`normName`** in core: lowercase, unaccent (NFD, strip marks, plus `ł` → `l`, which NFD leaves alone), collapse whitespace. Unit-tested on Polish names. The SQL `f_unaccent` in slice B must give the same result, and a DB test checks that.
- **Sources:**
  - Ticketmaster: `_embedded.attractions[]` with the id as `external_id`. Recorded fixture with attractions.
  - schema.org: `performer` (Person, PerformingGroup, MusicGroup, a plain string, or an array) in `schemaorg.ts`. Fixtures for each shape.
  - Claude extractor: `performers: string[]` in the output schema and prompt. The recorded LLM fixtures are updated.
  - Add-event form: an optional "Kto występuje / Who's performing" field (comma or new line). It goes through moderation like the rest of the submission.
- **`HappowEvent.performers`** (`{ name, externalId? }[]`) in core types and schemas. The area snapshot carries names only (for the card chips in slice C), capped at 5 per event, so the payload stays small.
- **Horizon (§3).** `ingest.lookaheadHours` 360 → 1440 (60 days). It applies to every source, and the crawlers already use 60. The config check that windows stay within the lookahead still holds. The area snapshot is unchanged. Check Ticketmaster's page count against the 1,000-result cap on the first run, and the database size in Supabase after a week.
- **Tests.** Contract tests for the Ticketmaster and schema.org changes, a dedup test for the performer union, and a DB test for migration 9.

### Slice B: search API

- **Migration 10:** `create extension pg_trgm, unaccent`; immutable `f_unaccent(text)`; a stored generated column `events.search_text` (title + venue name, normalised); GIN `gin_trgm_ops` indexes on it and on `event_performers.norm`.
- **RPC `search_events(q, lat, lng, from, to, limit)`.** Upcoming events in the region up to the horizon, with no radius and no time window. Ranking: an exact performer `norm`, then performer similarity, then title/venue similarity (threshold in config, `search.minSimilarity`, about 0.3). Ties break by start time. It returns the distance and the matched performer.
- **Worker `GET /api/search?q=&lat=&lng=`.** `q` is 2–80 characters after trimming. A per-client rate limit (`search.perHourPerClient` in config) uses the existing `limit()`. Short cache headers (60 s). Nothing about the query is logged; Plausible gets a `search` event without the text.
- **Tests.** API tests with a stubbed Supabase; a DB test on seed data for the §10 cases ("podsiadlo", "Podsiadło", "podsiadło dawid", one-letter typo). The DB test checks with `explain` that the trigram indexes are used; no timing runs on the web build.

### Slice C: search UI and performer chips

- **Mockup first:** `docs/design/search-follow.html`, in the prototype's style. It shows the search field at the top of the list overlay, the magnifier on the map screen (where it sits next to the list button), results grouped by day with distance and city, empty and error states, performer chips with ♡ on the card, and the ★ badge on a pin and a card. The owner approves it before any build. It is added to the design README as normative.
- **Build.** The magnifier opens the list with the field focused. Typing is debounced (300 ms, at least 2 characters) and in-flight requests are cancelled. A result tap opens the card and flies the map there; a result outside the snapshot opens the card only. PL and EN strings.
- design-review subagent before the PR.

### Slice D: follow

- **On the device.** A store of `{ name, norm, tmAttractionId? }` (localStorage, max 200, never throws), plus a `useFollows` hook.
- **Ways to follow.** ♡ on a card's performer chip, ♡ on a search result's matched performer, and a "Followed" screen reached from the list. It has a typed name, bulk paste (one per line, de-duplicated by `norm`) and remove.
- **`POST /api/follows/match`** `{ follows: [...] }` → upcoming matches by `norm` or attraction id, up to the horizon. The body is validated (≤ 200), the request is rate-limited and nothing is stored or logged. The app calls it on open and at most hourly after that, keeping the last answer for that hour.
- **Display.** ★ on pins (a sprite badge, like the age badge) and cards for matched events. A "Followed" group tops the list when a match is upcoming.
- **Tests.** Core matching, the API (no write to any table), the store, and the web flows. design-review before the PR.

### Slice E: nationwide Ticketmaster

- **Migration 11** `follow_lookups (attraction_id, fetched_at, events jsonb)`, with no user link.
- In `follows/match`, for attraction ids whose lookup is older than 24 h: one Discovery call (`attractionId`, `countryCode=PL`). Cached matches outside the region are returned with their city. A daily cap goes in config (`follows.tmLookupsPerDay`), well inside the 5,000/day key.
- They show in the Followed group with the city, not on the map, and link to Ticketmaster.
- A contract test on a recorded nationwide response.

### Slice F: Meetup public pages

- A `meetup-pages` crawler source in `config/sources.json`: `startUrls` are each listed group's `/events/` page, following event pages only, with JSON-LD read and the LLM fallback. robots.txt is respected (search and feed URLs stay blocked). It is marked private testing only (ToS §5.4) and switched off before monetising.
- Check on the first run that JSON-LD is present, then record a fixture for the contract test.
- Independent of A–E, so it can go at any point.

### Alerts and dropped

- **§5 alerts and synced follows: slice G**, on the accounts and premium tier built in M8. Web push and email; the native milestone replaces web push with native push. Its detailed plan is written when M7 starts.
- **§6 Last.fm import: dropped.** Its terms allow non-commercial use only, and Spotify is closed. Follows come from cards, search and bulk paste (the spec's default path).

### Decisions (owner, 2026-10-24)

1. Every slice is built in full, UI included: the PWA is finished before the native rewrite.
2. M7 is built after M12 (2026-10-24). Alerts and synced follows stay in M7 as slice G, on M8's accounts. The native rewrite is in the brief's Decisions table and milestones list.
3. Recommended, override if needed: the Last.fm import is dropped (above). Meetup public pages (slice F) are built for private testing and switched off before monetising, as §7 says.

### Working notes

- Read `CLAUDE.md`, `docs/BRIEF.md` and this spec first. Post the slice plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and `npx prettier --check` on changed files. No live API calls in tests.
- On the owner's Windows checkout, many files show as modified with line-ending-only changes. Commit only files with real changes (`git diff --ignore-cr-at-eol`).

## Why

- **A reason to open the app you chose yourself.** "Is anyone I like playing soon?" is a question people come back with, and it is driven by their own follows, not by engineered prompts.
- **It turns Happow into a planning tool as well as a "now" tool.** It pairs with the Week/Later windows.
- **It costs almost nothing to run.** One indexed query per search; no new paid APIs.

## 1. Data: performers

Today no performer is stored: the Ticketmaster adapter ignores `_embedded.attractions`, and the schema.org reader does not keep `performer`.

- **New table `event_performers`.** Columns: `event_id`, `name`, `norm`, `source_id`, `external_id`.
  - `norm` is the name lowercased, unaccented and with whitespace collapsed.
  - Merged events take the union of their performers.
- **Where names come from:**
  - **Ticketmaster.** `_embedded.attractions[]`: name, plus the attraction id as `external_id`. The id is stable, which enables the nationwide lookups in §4.
  - **schema.org JSON-LD.** `performer` (Person, PerformingGroup, MusicGroup). Add it to the parser's key list in `packages/extract/src/schemaorg.ts`.
  - **Claude extractor.** One more output field, `performers: string[]`: names exactly as printed on the page.
  - **Add-event form.** An optional "Who's performing" field.
  - **Meetup hosts** are organisers, not performers, and are not stored.
- **Privacy.** A performer's name is personal data when it belongs to an individual. Publicly announced artists are processed under legitimate interest; the brief's launch to-do already lists the GDPR art. 14 notice for performer and organiser names. Only names as published: no profiles, no photos.

## 2. Search

- **API.** `GET /api/search?q=` in the Worker → Postgres RPC `search_events(q, lat, lng, from, to, limit)`.
- **Matching.**
  - Searches the title, performers and venue.
  - `pg_trgm` similarity on lowercased, unaccented text, so typos and missing Polish diacritics still match ("podsiadlo" finds "Dawid Podsiadło").
  - `unaccent` is not immutable, so add an immutable `f_unaccent` wrapper and index with it: GIN trigram indexes on a generated `events.search_text` and on `event_performers.norm`.
- **Scope.**
  - Covers every stored upcoming event in the user's region, up to the horizon in §3. It is not limited by the radius or the selected time window.
  - Ranking: exact performer match, then fuzzy performer match, then title. Ties break by start time, and distance is shown.
- **UI (M6 list style B).**
  - The search field sits at the top of the list overlay; a magnifier on the map opens the list with the field focused.
  - Results are grouped by day; tapping one opens the card and the map flies there.
- **Limits and privacy.** The existing per-device and per-IP rate limits apply. Queries are counted in Plausible but never stored with an identifier.

## 3. Horizon

- **Ingest further ahead.** Search needs events beyond the map's window, so API sources (Ticketmaster, Meetup) ingest 60 days ahead. That matches the crawlers' `horizonDays` (60).
- **The map is unaffected.** Its area snapshot stays as M6 and the Week/Later windows define it.
- **Ticketmaster paging.** Its deep-paging cap (1,000 results per query) is far above Wrocław's volume.

## 4. Follow

- **Ways to follow.** Tap ♡ on a performer chip in the event card, follow from a search result, or type a name. Paste a list (one name per line) for bulk add.
- **Stored on the device.** Each follow is `{ name, norm, tmAttractionId? }`. Free, with no account.
- **Matching on open.**
  - The app sends one `POST /api/follows/match` with the list (max 200 names) on open, and at most once an hour after that. It returns upcoming matches.
  - The server keeps no copy of the list.
- **Display.**
  - Followed artists' events get a small ★ on the pin and the card.
  - A "Followed" group tops the list whenever a match is upcoming.
- **Beyond the region (Ticketmaster).**
  - For follows with a Ticketmaster attraction id, the server also checks Ticketmaster nationwide (`attractionId` + `countryCode=PL`).
  - Results are cached per artist for 24 h in a `follow_lookups` table, with no link to any user.
  - They appear in the list with the city, not on the map.
  - Budget: one call per distinct artist per day, well inside the 5,000/day key.

### 4.1 "My plans" filter (slice H; owner, 2026-10-30)

- **One tap to see only your plans.** A button in the top-left row on the map, right after the live counter and the family shortcut. When it's on, the map and the list show only:
  - events you saved (the bookmark on the event card);
  - events you're invited to, once private events and invitations exist (M11). Until then, saved events only.
- **Why.** It un-crowds the map down to what you already decided to go to, without touching any other filter. Off again, everything comes back as it was.
- **Behaviour.**
  - It works on top of the time window, category, price and family filters, so "this evening" plus "my plans" shows tonight's saved events.
  - Saved events outside the reach still show on the map (they're yours), and the list puts the nearest first.
  - With nothing saved, the button says so ("Nothing saved yet: tap the bookmark on an event") instead of showing an empty map.
  - On or off is remembered on the device, like the family shortcut.
- **Data.** Saved events live on the device today (`useSaved`, up to 200). M10 (plan ahead) turns them into one agenda together with accepted invitations; this filter reads the same list, so it needs no server change of its own.
- **Icon.** The bookmark the card already uses; no new icon.
- **Free** for everyone, no account needed.

## 5. Alerts (premium, logged in)

Slice G, on M8's accounts (2026-10-24).

- **"Tell me when a new date is announced."** Follows are stored server-side per user (row-level security) and matched after each ingest run.
- **Delivery.** By web push, which needs the installed PWA (on iOS, Home Screen web apps from 16.4), or by email.
- **Account.** Uses the same account and premium tier as atlas sync (M6 §8), and follows sync across devices.
- **GDPR.** Once stored, follows are personal data: consent when alerts are switched on, plus export and deletion with the account.

## 6. Importing artists

Dropped on 2026-10-24: cards, search and bulk paste only.

- **Spotify: not viable.**
  - Since February 2026, development-mode apps are limited to 5 users.
  - Extended access requires a registered business with 250,000 monthly users.
- **Last.fm: possible, with a catch.** `user.getTopArtists` takes a username, no login. Its terms allow non-commercial use only; commercial use needs a separate agreement, and Last.fm reserves a share of revenue. Fine for private testing; decide before launch.
- **Default path.** Follow from cards and search, plus bulk paste.

## 7. More data: Meetup public pages

This applies until the Meetup API (Meetup Pro) is decided.

- **Discovery.** Crawl the public event pages of Wrocław Meetup groups listed in config: `startUrls` = each group's `/events/` page, following event pages and reading JSON-LD. Check on the first run that JSON-LD is present (LLM fallback otherwise).
- **robots.txt** allows event pages. It blocks search pages with `?location=` or `?distance=` and the event feeds, so discovery must start from the group list, not from search.
- **Terms.** Meetup's ToS §5.4 prohibits scraping for commercial purposes. That is acceptable for private testing; switch to the API, or drop the source, before monetising.

## 8. Free and premium

| Feature                                                     | Free | Premium |
| ----------------------------------------------------------- | ---- | ------- |
| Search                                                      | ✓    | ✓       |
| Follow artists on the device, ★ on their events             | ✓    | ✓       |
| Followed matches on open, including nationwide Ticketmaster | ✓    | ✓       |
| "My plans" filter: saved events and invitations only        | ✓    | ✓       |
| Alerts on new dates (push or email)                         |      | ✓       |
| Follows synced across devices                               |      | ✓       |

## 9. Cost and performance

- **Search.** One RPC per query on trigram indexes; target p95 < 300 ms with 10,000 stored events (a server budget, not tested on the web build).
- **Follow matching.** One request per app open, at most hourly.
- **Ticketmaster.** At most one extra call per distinct followed artist per day.
- **Claude.** One extra output field; no extra calls.

## 10. Acceptance

- "podsiadlo", "Podsiadło" and "podsiadło dawid" find the same event; a one-letter typo still finds it.
- Following an artist from a card shows ★ on all their upcoming events after a reload, with no account.
- A followed artist with a Ticketmaster id playing in another Polish city appears in the list, not on the map.
- For anonymous users, neither queries nor follow lists are stored on the server.

## 11. Open

- Alert channel: web push only, or email too (and which provider).
- Last.fm: commercial agreement, or drop the import before launch.
- Meetup: API (Pro pricing) or public-page crawl.
- Nationwide results beyond Ticketmaster wait for more regions.
