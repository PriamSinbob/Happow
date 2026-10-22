# Milestone 7 — Search and followed artists: spec

Oct 22, 2026

Spec agreed with the owner on 2026-10-22, to be built after M6 (it uses M6's list overlay, icon set and pin badges). Build it in the usual way: plan, show the plan, build, then replace the "Status" line with the report.

**Status:** spec, not built.

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

## 5. Alerts (premium, logged in)

- **"Tell me when a new date is announced."** Follows are stored server-side per user (row-level security) and matched after each ingest run.
- **Delivery.** By web push, which needs the installed PWA (on iOS, Home Screen web apps from 16.4), or by email.
- **Account.** Uses the same account and premium tier as atlas sync (M6 §8), and follows sync across devices.
- **GDPR.** Once stored, follows are personal data: consent when alerts are switched on, plus export and deletion with the account.

## 6. Importing artists

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
| Alerts on new dates (push or email)                         |      | ✓       |
| Follows synced across devices                               |      | ✓       |

## 9. Cost and performance

- **Search.** One RPC per query on trigram indexes; target p95 < 300 ms with 10,000 stored events.
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
