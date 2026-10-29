# Milestone 12 — More events: spec

Oct 26, 2026

Spec from the scope draft of 2026-10-26 (agreed in direction by the owner the same day) and the owner's answers to its questions (§9). M12 comes right after M8. Build it the usual way: post each slice's plan, wait for the owner's OK, build it, then replace the "Status" line with the report.

**Status:** in progress. Spec agreed by the owner (2026-10-26). Built: slice A (metrics), C1 (OSM venues, the website check and accepted sites), C2 (the Sources tab), D (share into Happow) and E (contributions on the server), 2026-10-28; F (your impact and the contributor card) and G (poster photo), 2026-10-29. Slice B is folded into C.

Goal: **more events on the map, and more people adding events in the app.** Both halves matter. The reasons to add events (§6) matter most. The brief's rules hold throughout: no streaks, no guilt mechanics, no fake urgency, pull not push, and paid never buys visibility. Every source and provider lives in config, each adapter gets a contract test on recorded fixtures, and CI makes no live API calls.

## Build plan

One branch and one PR to `main` per slice, as in M6 and M8. The order follows the owner's answer to §9.1: sources A1 → A2, then share target → impact → premium for contributions → poster photo, then the rest. Slice A comes first because it is small and makes the progress measurable. Each slice PR updates its row below and the Status line, and adds a short "Built (slice X)" note under its spec section (built, skipped, open).

| Slice | Spec      | What                                                                                                                    | Needs | Mockup | Status  |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------- |
| A     | §1        | Metrics: districts in data, `m12_metrics()`, `pnpm metrics`, a weekly row by the cron                                   | —     | —      | built   |
| B     | §2.1      | Folded into C (owner, 2026-10-28): no feeds found by hand, so the website check finds them                              | —     | —      | folded  |
| C1    | §2.1–2.2  | OSM venues, links and pin moves, the website check, candidates, and the reader for accepted sites (iCal, REST, JSON-LD) | A     | —      | built   |
| C2    | §2.2      | Admin tab "Source candidates": samples, accept or reject, paused sites                                                  | C1    | admin  | built   |
| D     | §4.1      | Share into Happow: PWA share target opens the add form filling from the link                                            | —     | no     | built   |
| E     | §5        | Contributions on the server: rewards ledger, impact counters, premium days, trusted contributor, levels, credit opt-in  | —     | —      | built   |
| F     | §5 UI     | Your impact and contributor card: after-add screen, account card, level, credit toggle                                  | E     | waived | built   |
| G     | §4.2      | Poster photo: Claude Haiku reads a poster into the add form                                                             | D     | waived | built   |
| H     | §4.3–4.4  | "Happening here" quick add, and add again                                                                               | F     | waived | built   |
| I     | §4.5      | Recurring events by pattern, stored as separate occurrences                                                             | H     | waived | built   |
| J     | §2.3      | Regular services at places of worship, from OSM `service_times` and parish pages                                        | C     | —      | built   |
| K     | §2.4–2.5  | Cultural institutions, universities and more ticket sites as crawl targets                                              | B     | —      | planned |
| L     | §4.6      | Calendar feed import for an account                                                                                     | B, E  | yes    | planned |
| M     | §6.1, 6.4 | Places first on the map, and thanks from visitors after GoThere                                                         | E, F  | yes    | planned |
| N     | §6.2–6.3  | District goals in empty states, and season collections                                                                  | A, F  | yes    | planned |
| O     | §3        | Admin coverage view: events per district and category, today and the week                                               | A, C  | admin  | planned |

B, C, J and K add events with no UI and can ship while the UI slices wait for their mockups. D needs only the add form from M8 G.

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post each slice's detailed plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and `npx prettier --check` on changed files. Each new adapter has a contract test against recorded fixtures in `packages/ingest/test/fixtures/`. Overpass, feeds and Claude are faked in tests; no live calls in CI.
- **UI slices** (C admin, D, F, G, H, I, L, M, N, O): built from the prototype's components and the exact icons in `docs/design/icons/`. From slice D on, no mockup first (owner, 2026-10-28): new screens follow the existing ones, and the owner adjusts the design with the design studio once the whole functionality is built. C2 had its mockup before this. The `design-review` subagent is paused (owner, 2026-10-26); run it only if the owner asks.
- **Sign-in on previews.** Sign-in does not work on Cloudflare previews yet (the preview Worker lacks its Supabase secrets and build variables). It gets fixed later and does not block M12. Each UI PR lists what could not be checked signed in on the preview, and checks it locally with `pnpm dev` where possible.
- On the owner's Windows checkout: commit only files with real changes (`git diff --ignore-cr-at-eol`), and write commit messages to a file (`git commit -F`), because PowerShell 5.1 breaks quoted `-m` messages.
- GitHub auto-merge is off. Merge with `gh pr merge` once checks pass, when the owner asks.
- Wording and polish questions wait for the text pass after the app is finished; they don't block a slice.

## 1. How we measure it

Measured on the server, per week, in the default region (`config/app.json` → `defaultRegion`). "Live" means not cancelled.

| Metric                          | Definition                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Events today                    | Live events overlapping the local calendar day (start before tomorrow 00:00, end after today 00:00) |
| Events for 7 days               | Live events overlapping now → the end of day 7 (today plus the next 7 days)                         |
| Districts with an event tonight | Districts with at least one live event overlapping 18:00–24:00 local time, out of all districts     |
| Community share                 | Share of the 7-day events whose `trust` is `community`                                              |
| Accounts that added an event    | Distinct accounts with at least one user submission in the last 7 days (and the total since M8)     |

### Baseline (Mon 26 Oct 2026, measured at 22:44 Warsaw time)

| Metric                          | Baseline                                                        |
| ------------------------------- | --------------------------------------------------------------- |
| Events today                    | 119 (7 still running or ahead at 22:44)                         |
| Events for 7 days               | 404: wroclaw-go 385, eBilet 15, NFM 4, Ticketmaster 4           |
| Districts with an event tonight | **5 of 48** (59 events overlap the evening)                     |
| Community share                 | **0%** (0 of 404); 1 user submission ever, made before accounts |
| Accounts that added an event    | **0** (0 accounts on the live database; sign-in isn't live yet) |
| Venues                          | 192                                                             |

Districts: Wrocław's 48 osiedla (OSM `boundary=administrative`, `admin_level=9`). For the baseline they were read from Overpass once, by hand. Slice A stores them as data so the measure repeats the same way.

Read from the baseline: the city portal gives 95% of the week, the evening is concentrated in 5 districts, and nobody adds events yet. So slices B, C and K go for the long tail of venues outside the centre, and D–I go for the community share.

### Slice A: metrics

- **Districts as data.** `data/districts/<region>.geojson` (from OSM, ODbL, attribution in About) and a `districts` entry per region in `config/regions.json`: the file path, the OSM `admin_level`, and an optional name field. A `districts` table (region, id, name, polygon) is loaded by `pnpm seed`. No city names in code.
- **`m12_metrics(region, at)`** SQL function returning the five metrics, plus the 7-day counts per source and per category.
- **`pnpm metrics`** prints them. The Worker's existing 15-minute cron stores the week's row in `metrics_weekly` (region, week, json) from Monday 08:00 local on (owner, 2026-10-28: the Worker cron instead of a GitHub Actions job, which would spend Actions minutes). The admin coverage view (slice O) reads it.
- **Tests.** The function on fixture events across a district edge, the evening boundary and midnight in the region's time zone.
- **Built** (slice A, 2026-10-28):
  - **Districts.** `pnpm districts [region]` reads the region's `boundary=administrative` relations at `districts.adminLevel` inside its bbox from Overpass (`osm.overpassUrl` in `config/app.json`). It joins each district's ways into rings, simplifies each way to 10 m and writes `data/districts/wroclaw.geojson`: 48 districts, 55 KB. Neighbours share their border ways, so simplifying each way before joining keeps the borders gap-free. `--from <file>` builds from a saved Overpass answer. `pnpm db:seed` loads the file into `districts`.
  - **Database** (`20261028000012_metrics.sql`): the `districts` and `metrics_weekly` tables, and `m12_metrics(region, at, evening_hour)`. It counts live (not cancelled, not hidden) events and submissions that existed at `at`, so a past moment can be measured again, though later edits to events still show. `metrics_save` stores a week's row once and returns false after that. Both functions are callable by the service role only. `metrics.eveningFromHour` (18) and `metrics.weekly` (Monday, 08:00) are in `config/app.json`.
  - **Cron.** `saveWeeklyMetrics` (`packages/api/src/metrics.ts`) runs next to the ingest dispatch on every tick. On the configured weekday from the configured hour it calls `metrics_save`. A failure in one job no longer stops the other, and both are logged on the tick's line.
  - **Checked** against the live data, in a rolled-back transaction, for 26 Oct 22:44: 119 today, 59 tonight, 5 of 48 districts, as in the baseline. The 7-day count is 412, not 404: events the city portal changed since then.
  - **Seen in the numbers:** 329 of the week's 418 events (79%) are cinema screenings from wroclaw-go. "Events for 7 days" is mostly screenings, so `byCategory7d` matters when reading it.
  - **Tests:** ring joining, simplifying, holes and shared borders; the committed district file; the Worker job across the change to winter time; `scripts/m12.db.test.ts` on the 25-hour day of 25 Oct 2026 (CI database).
  - Skipped: nothing. Open: run `pnpm db:migrate` and `pnpm db:seed` on Supabase after merge (the "Migrate database" workflow). The first weekly row comes on Monday 2 Nov 2026.

## 2. More sources

Each source is an adapter plus config with a contract test on recorded fixtures. New sources start `enabled: false` with `termsNotes` filled in, and the owner switches them on.

### 2.1 Venue calendar feeds (slice B)

- **Adapter `ical-feed`**: reads iCalendar (`VEVENT`: `SUMMARY`, `DTSTART`/`DTEND` with `TZID`, `LOCATION`, `GEO`, `URL`, `RRULE` expanded within the window) and RSS/Atom with The Events Calendar's fields. One source entry per adapter, with `options.feeds: [{ url, venueId?, defaultCategories?, categoryMap? }]` in `config/sources.json`.
- **Place.** `GEO` if present, else the feed's `venueId`, else geocoding `LOCATION` (cached, as today). An event with no place goes to the moderation queue, not the map.
- **Politeness.** Conditional requests (ETag / If-Modified-Since), the crawler User-Agent, robots.txt, one fetch per feed per run, schedule `6h`.
- **Starter list.** 10–20 Wrocław feeds found by checking venue sites for `?ical=1`, `/feed/` and `.ics` links, each with a note on its terms. The PR lists them for the owner.
- **Tests.** Fixtures: a The Events Calendar export, a Google Calendar export with `RRULE` and `EXDATE`, an RSS feed, a feed with a broken event. Time zones and DST are checked.

### 2.2 OpenStreetMap venues (slice C)

- **Adapter `osm-venues`**: one Overpass query per region (bbox from config) for theatres, arts centres, cinemas, nightclubs, community centres, libraries, places of worship and music venues. The tag list lives in config. It runs weekly.
- **Venue table.** It upserts by OSM id (`venues.osm_id`), with name, point, website, `opening_hours` and wheelchair access. A venue already linked to events keeps its id; its pin is corrected only when it moved under 150 m (more goes to review).
- **Website probe.** For each venue with a `website` not yet checked (or checked over 30 days ago): fetch the home page once, look for a feed link (`rel=alternate` calendar or RSS, `?ical=1`) and for schema.org Event JSON-LD. Hits go to **`source_candidates`** (venue, url, kind feed/jsonld, sample count, status new / accepted / rejected). Nothing is crawled until an admin accepts it. Accepting adds the URL to the crawl list in the database, which the next config export writes back to `config/sources.json`.
- **Admin tab** "Source candidates" in the M8 admin panel: list, sample events, accept / reject. Mockup first.
- **Attribution.** "Venue data © OpenStreetMap contributors (ODbL)" in About.
- **Tests.** An Overpass fixture; upsert keeps ids; the probe on fixture pages (feed, JSON-LD, neither, robots disallow).
- **Owner decisions (2026-10-28).** Slice B is folded into C: a check of 16 major Wrocław venue sites found no calendar feeds, so feeds are found by checking every OSM venue's website instead of a hand-made list. The feed reader (iCal and The Events Calendar's REST API) is built here; RSS is left out (its items carry publishing dates, not event times). Accepted sites are read from `source_candidates` under one `venue-sites` source in config, so an accept needs no commit. C is split: C1 (server) and C2 (the admin tab, mockup first).
- **Built** (slice C1, 2026-10-28):
  - **Three sources** in `config/sources.json`, all on: `osm-venues` (weekly), `venue-probe` (daily, `venues.probe.perRun` 20 sites) and `venue-sites` (daily). They are on because nothing reaches the map until an admin accepts a site. Venue settings (OSM tags, link thresholds, probe words, pausing) are under `venues` in `config/app.json`. Overpass servers are a list (`osm.overpassUrls`), tried in order, with a plain User-Agent (`osm.userAgent`), because overpass-api.de refuses one with a URL in it.
  - **Database** (`20261028000013_venues.sql`): `osm_venues`, `venues.osm_id` and `venues.osm_point`, `venue_moves` (every pin move, for undoing) and `source_candidates`.
  - **OSM venues.** OSM venues get their own table, not rows in `venues`: `venues` holds the places events use, one row per source. An event venue links to the OSM venue with the most similar name within 150 m (similarity 0.6, the measure dedup uses for titles). At 0.8 and 15 m or more, the pin moves to OSM's point. Moving a pin on its own would not last: the next ingest run writes the source's point back. So `osm_point` is kept apart, and ingest puts events at a moved venue on it (within 150 m). Clearing `osm_point` undoes a move.
  - **Website check** (`packages/ingest/src/venues/probe.ts`). At most five requests per site: the home page, one events page (a link with one of `venues.probe.eventsPageWords`), The Events Calendar's REST API on WordPress sites, and up to two feeds. Each find goes to `source_candidates` with its number of upcoming events and three samples. Venues sharing a website are checked once, and again after 30 days. `pnpm venues:probe <url…>` runs the same check by hand and writes nothing.
  - **Reading accepted sites** (`venue-sites`). iCal through `ical.js`: a repeating event gives one event per date, removed and edited dates are respected, and zones the feed defines are converted. The Events Calendar's REST API: up to 4 pages of 50, following next pages on the same site only, virtual events marked online. JSON-LD pages use the crawler's reader. Items reuse the crawler's payload and parse step. An event with no place of its own is at the site's venue. A site failing 3 runs in a row is paused (`venues.pauseAfterFailures`).
  - **Crawler policy.** `docs/CRAWLER.md` now describes the website check. Both new crawling sources keep its promises: once a day per site and 5 s between requests (`rateLimit` "12/m").
  - **First real check.** 6 major sites through `pnpm venues:probe` (CK Zamek, Firlej, BWA, OKiS, CK Agora, Strefa Kultury): none publishes events in a readable form. Their events pages carry only SEO page data, and Firlej refused the connection. So the check's yield will come from smaller venues, if at all. Institutions like these need the crawler's AI fallback (slice K).
  - **Tests.** Readers on real recordings (The Events Calendar's demo site as iCal and REST, a Google Calendar export) and a hand-built Wrocław feed: repeats, removed and edited dates, all-day, cancelled, online, a broken event, UTC and US time zones. OSM parsing and linking; Overpass fallback; the website check (finds, robots, nothing, errors, five requests at most); the adapter end to end; the jobs as scheduled sources. `scripts/m12-venues.db.test.ts` covers the storage in CI. The migration was also run on the live data in a rolled-back transaction: 197 event venues in the region.
  - Skipped: nothing planned for C1. Open: no OSM data has been loaded yet, because Overpass refused this machine all day. The first weekly run in Actions will show how many venues and websites Wrocław has. C2, the admin tab for candidates, comes next.
- **Built** (slice C2, 2026-10-28), from `docs/design/admin.html` (approved by the owner on 2026-10-28):
  - **The Sources tab**, fourth after Queue · Codes · Grants. Its count is the new finds, shown before the tab is opened. Three lists: New, Read (paused sites first) and Rejected. Each card shows the venue, what was found (iCal, API, JSON-LD) and its link, plus:
    - in New: the number of upcoming events, three samples and "and N more";
    - in Read: the last run and how many events it gave;
    - for a paused site: the error that paused it.
  - **Decisions:** Read daily, Reject, Resume, Stop reading and Restore, all in one step. None asks first, because each can be undone from another list. An accepted card stays in New, saying when reading starts, until the next refresh.
  - **API:** `GET /api/admin/sources` and `POST /api/admin/sources/:id` (`{ action }`), admin only. Who decided is recorded. A step that no longer fits the candidate's status (decided in another tab, or paused by a run) answers 409, and the tab reloads.
  - **Database** (`20261028000014_sources_admin.sql`): `source_candidates_list()`, `source_candidate_decide()`, which allows only these steps: new → accepted or rejected, accepted or paused → rejected, paused → accepted, rejected → new. Resuming clears the failure count. A new column, `last_run_events`, is written by `venue-sites` after each good run.
  - **Sample times:** wall times and dates from feeds are shown as written; instants are shown in the region's time.
  - **Checked:**
    - API, UI and database tests pass;
    - the SQL ran on the live data in a rolled-back transaction;
    - the real tab was checked at 380 px in Polish and English with canned answers inside the dev build: no overflow, every sample on one line.
  - **Not checked signed in:** neither on the Cloudflare preview (it has no Supabase secrets yet) nor against the real Supabase.

### 2.3 Regular services at places of worship (slice J)

- From OSM `service_times` on places of worship (from slice C) and, where a parish page publishes a timetable, from that page through the crawler.
- A generator turns the weekly pattern into **separate events, one per occurrence**, for the next 14 days, in the `religious` category. They are never merged into one card (time-first principle). Holidays: where the source gives none, the pattern simply runs; a report from the card removes one occurrence.
- `trust: crawled`, `confidence` from the source. Attendance features stay off for religious events (M6 §9).
- **Tests.** `service_times` parsing (OSM's `opening_hours` grammar, e.g. `Su 08:00,10:00,12:00; Mo-Sa 18:00`), DST weeks, a malformed tag.

#### Built (slice J, 2026-10-29)

- **Source `worship-services`** (adapter of the same name), **off** until the owner switches it on: it puts events on the map without review. Daily, `trust: crawled`, `confidence` 0.8 and the title "Nabożeństwo" from its `options`, the `religious` category from `defaultCategories`. It makes no requests: it reads the OSM venues slice C loads (`options.kinds`: `amenity=place_of_worship`) that have `service_times`.
- **Reading the tag** (`packages/ingest/src/venues/services.ts`): the plain part of the `opening_hours` grammar: weekdays and ranges (`Mo-Sa`, `Su,We`, `Sa-Mo` across the week's end), start times or time ranges (`08:00,10:00`, `18:00-18:45`, past midnight too), a rule without days meaning every day. A rule with months, weeks, `off`, a comment or only holidays is skipped, not guessed; the rest of the tag still counts. `PH` and `SH` add nothing, since no holiday calendar is known.
- **One event per service** for the next 14 days (`options.horizonDays`), never merged (time-first). Each has its own id (OSM id and start), the place as its venue and link, free, a fixed start; services already over today are left out. Holidays: the pattern simply runs, and a report from the card removes one date.
- **Attendance features** stay off for religious events: co-presence (M6 §9) isn't built yet, so there's nothing to switch off today.
- **Skipped: parish timetable pages.** A free-form page of mass times needs an LLM to read a weekly pattern, not events, so it's left for later. Parish sites that publish a calendar feed or Event JSON-LD already come in through the website check and `venue-sites`.
- **Tests** (`packages/ingest/test/services.contract.test.ts`, on the recorded Overpass fixture): the grammar, skipped and broken rules, past midnight, two weeks across the end of summer time (25 Oct 2026), normalizing into the category and trust.

### 2.4 Cultural institutions and universities (slice K)

Crawl targets like NFM, or feeds where offered: city culture centres, the public library network, university calendars. Each is a `crawler` source entry with `termsNotes`. Where a site has a feed, slice B's adapter reads it instead.

### 2.5 More ticket sites (slice K)

JSON-LD crawl targets where their terms allow it (Biletyna, KupBilecik). Each gets a terms check written into `termsNotes` before it is enabled. Going and Eventim: the owner asks for a partner feed first (to-do in §8); no crawling them until that is answered.

## 3. Coverage view for the admin (slice O)

A tab in the admin panel: events per district × category for today and the week, from `m12_metrics` and `metrics_weekly`, with the weekly trend of the five metrics. Empty districts come first, so the next source is chosen by data. Mockup first.

## 4. Adding events: faster

All paths end in the M8 add form and the same server endpoint. Quotas stay as in M8 (15 a month free, 300 premium; autofills 5 / all).

### 4.1 Share into Happow (slice D)

- `share_target` in the PWA manifest (`GET /share?url=&text=&title=`). A link found in `url` or `text` opens the add form, which runs autofill on it (one autofill from the quota, only if it fills something, as in M8).
- Signed out: the M8 sign-in sheet first, then the form with the link kept.
- Android installed PWA shows Happow in the share sheet. iOS does not support web share targets: the add form's paste-link field stays the path there.
- **Owner decisions (2026-10-28).** When the shared page gives nothing (typical for Instagram and Facebook links, which need a login), the shared title goes into the event's title. No mockup: the form looks like the add form it is.
- **Built** (slice D, 2026-10-28):
  - **Share target.** `share_target` in the manifest (`vite.config.ts`): `GET /share` with `title`, `text` and `url`. No Worker change: `/share` gets the app page like any unknown path, and the offline cache does the same.
  - **Reading a share** (`apps/web/src/share.ts`). Before the app reads its route, `/share` is read:
    - the link is `url`, else the first web link in `text`, since many Android apps send "text https://…" with no `url`;
    - the title is `title`, else the rest of `text`, at most 160 characters.
    - It is kept for this tab only (sessionStorage), and the address becomes `/#/add`, so a reload or Back never fills again and the link leaves the address bar.
  - **The add form takes it once**, when the account is known, so a signed-out share waits through sign-in:
    - with an autofill left, it fills from the link straight away; an autofill counts only when it fills something;
    - with none left, or when the page gives nothing or fails, the link goes into the website field and the shared title into an empty title;
    - a line says the form came from a shared link.
  - **Checked.** Tests for reading shares and for the form (fills once, falls back to the title, spends nothing when none is left). The built manifest has the share target. In the dev build, `/share?…` became `/#/add` with the share waiting behind the sign-in sheet.
  - **Not checked.** Signed-in filling on the Cloudflare preview: it still lacks its Supabase settings. The Android share menu: it needs the installed app, and an already-installed app picks up the new manifest within about a day (or on reinstall).

### 4.2 Poster photo (slice G)

- A camera / gallery button in the add form. The photo is shrunk on the device (long edge ≤ 1568 px, JPEG) and sent to `/api/autofill/photo`. **Claude Haiku 5.5** (vision) reads title, start, end, place, price and category into the same strict JSON as text extraction.
- Counts as one autofill, only when it fills something. Bounded by the global daily cap `extraction.autofillLlmPerDay` (owner, §9.5). Model and limits in config.
- The photo is not stored and not sent anywhere else; the event gets no image from it (copyright rule).
- **Tests.** The endpoint with a fake extractor: quota taken only on a useful fill, cap reached, oversize rejected.

#### Built (slice G, 2026-10-29)

- **Form.** "Photo of a poster" (Tabler `camera`, owner OK 2026-10-29) sits under the link field and behaves like it:
  - it's off when autofill is off or used up;
  - it shows "Reading the poster…" while working;
  - several events give the same pick-one list, up to 5;
  - nothing found says so and leaves the form for manual entry.
- **On the phone** (`apps/web/src/photo.ts`). The photo is redrawn to `extraction.photo.maxEdge` (1568 px) on its long edge, as a JPEG at `jpegQuality` (0.85), the right way up. The original never leaves the phone. Checked in the browser: 4000 × 3000 became 1568 × 1176, about 20 KB for a simple test image.
- **Server.** `POST /api/autofill/photo {image, mediaType, regionId}`:
  - it needs an account, with the same hourly limit and monthly quota as the link (checked first, taken only when it fills something) and the shared daily LLM cap;
  - over `extraction.photo.maxBytes` (1.5 MB) gives 413, and only JPEG, PNG and WebP are accepted;
  - no image reader, or today's cap spent, gives 503 `photo_unavailable`, so the form says reading is unavailable, not that nothing was found.
- **Shared.** The link and the photo now share the quota check and the prefill step.
- **Extractor.** `ClaudeExtractor.extractImage` sends the image before the text, with a poster prompt (read only what is printed; skip logos, phone numbers and QR codes) and the same rules and strict schema as pages. A page request is unchanged. Links on a poster are kept only when absolute. The photo is not stored, and the event never gets it as its image.
- **Privacy.** About's privacy list says, whenever autofill is on, that page text or a photo goes to an AI service only to be read and is not kept.
- **Tests.**
  - extractor: the image request shape and prompt;
  - endpoint: a fill, nothing found or failed, cap and no reader, oversize and wrong type, account and quota;
  - web: the fill, several events, nothing found, unavailable, used up, and the resize sizing.
- **Checked** in the dev build at 380 px on a throwaway page with a stubbed `/api` (deleted): real shrinking, and picking a photo fills the form.
- **Not checked:** a real Claude read of a real poster, and the phone camera. The Cloudflare preview can't sign in, and CI makes no live calls.

### 4.3 "Happening here" quick add (slice H)

One screen: the pin at your location, the start at now (end from the category's default duration), a title and a category. More fields stay one tap away. Goes to the same queue.

### 4.4 Add again (slice H)

From your past events (account card and after-add screen): pick one, choose a new date and time, check, send. Each date is its own submission and its own event.

#### Built (slice H, 2026-10-29)

- **Quick add.** A "Happening here, now?" card tops the add form.
  - It shows only with a location fix within `submissions.quickAdd.maxAccuracyM` (100 m); without one the form is as before.
  - "Add it here" puts the pin at the fix and the start at now in the region, rounded down to `roundMin` (5) minutes. The end follows the first category's `defaultDurationMin`.
  - The short form asks for the title, category, place name and free or paid. The place name and price are on it because every event needs them (the server requires a place name, and the card shows the price).
  - "More details" opens the whole form, already filled in. An end set by hand stops following the start.
  - It goes to the same `/api/submissions`, with the same quota, moderation, trusted publishing and rewards. The link and photo autofill are hidden while it's open.
- **Add again.**
  - "Add again" sits on each of your events in the account card, except rejected or hidden ones. It opens `#/add?again=<submission>`, so Back works.
  - `GET /api/me/submissions/:id` returns the form the submission was sent with. It is answered only for its owner, never for a rejected submission or a hidden event; otherwise it's 404. The read is `submission_form()` in migration 16.
  - The form opens with everything copied except the date and time, under a "Copied from …" line. A new start moves the end by the original length.
  - "Add another date" on the thanks screen does the same from the event just sent, without a server call.
  - Each date is its own submission and counts once against the month's events.
- **No mockup** (owner, 2026-10-28). The card reuses the usage card's look; icons already in use (`locate`, `copy`).
- **Tests.**
  - API: the owner's form, 404 for others or bad ids, and an account is needed.
  - Database: owner only, never rejected or hidden.
  - Web: the card only with a precise fix, the short form and what it sends, "More details", a copy with the same length, the 404 message, another date from the thanks screen, the account card buttons, the route and the time helpers.
- **Checked** in the dev build at 380 px on a throwaway page with a stubbed `/api` (deleted): the card, the short form and a copied form.
- **Not checked:** a real GPS fix on a phone. Signed in on the Cloudflare preview isn't possible yet, so add again against Supabase is untested, and migration 16 needs "Migrate database".

### 4.5 Recurring events by pattern (slice I)

In the add form, "Repeats": weekly on chosen days at a time, until a date (at most 12 weeks ahead). The server stores **one event per occurrence**, linked by a `series_id`. Each occurrence counts against the monthly quota, and moderation approves the series once. Editing or cancelling one occurrence leaves the others.

#### Built (slice I, 2026-10-29)

- **Owner decisions** (2026-10-29, building the rest of M12 without stopping): a series earns premium days like one event, once, on its earliest date; cancelling a single date by its adder is left for later (the per-date storage allows it).
- **Form.** "Repeats": Does not repeat / Weekly.
  - Weekly shows the seven weekdays (the start's own day already on) and "Until", four weeks after the start at first and at most `submissions.recurring.maxWeeks` (12).
  - A line gives the count and the range of dates. It turns into a warning, and sending is held, when there are no dates, more than `maxOccurrences` (24), or more than the month's events left.
  - Hidden in the quick add short form; add again and "Add another date" start without a repeat.
  - The thanks screen says how many dates were added, each its own event.
- **Dates** (`packages/core/src/recurrence.ts`): `weeklyStarts` gives the wall-clock starts, earliest first, so 19:00 stays 19:00 across a change of clocks. The form and the server use the same function, so both count the same dates.
- **Server.** `POST /api/submissions` takes `repeat: {days, until}` (ISO weekdays). A repeat needs an account. Each date gets its own submission, its own event and its own form (so add again copies that date), with the original length; the series shares one venue row.
  - `submit_series()` (migration 17) stores every date in one transaction through `submit_event`: each counts once against the month, and if the quota runs out partway nothing is stored (429).
  - A trusted account's series publishes at once and earns on its first date.
- **Moderation.** The queue shows a series as one card with its dates; Approve or Reject goes to `POST /api/moderation/series/:id`, `moderate_series()` decides every pending date, earliest first, and the reward goes to the first. After that everything is per date: a report, a cancel or a hide touches one date only.
- **Account card.** A series is one row: its count, the next date ahead, and the opens and days of all its dates. Opening it opens the next date; "Add again" copies that date as a single event.
- **No mockup** (owner, 2026-10-28); the weekday buttons follow the category chips. No new icons.
- **Tests.** Core: weekdays, the until day, the 12-week limit, the change of clocks. API: dates and times per submission, one venue, too many or none, an account needed, the quota, a trusted series rewarded once, series moderation (approve, reject, 409, 404, 403). Database (CI): storing a series, all or nothing on the quota, deciding it once. Web: the form, the quota and empty warnings, back to a single event, the moderation card, the account card row.
- **Checked** in the dev build at 380 px in Polish on a throwaway page with a stubbed `/api` (deleted): the weekday row fits without overflow.
- **Not checked:** signed in on the Cloudflare preview, and against Supabase (migration 17 needs "Migrate database").

### 4.6 Calendar feed import for an account (slice L)

- In the account card: paste an iCal URL once. The server reads it with slice B's adapter on its schedule, and its events come in as the account's submissions.
- **Ownership:** the first batch goes to moderation; after it is approved, later events follow the account's trust (§5.3). An admin can stop a feed. Imported events count against the monthly quota.
- At most `contributions.feedsPerAccount` feeds (config, default 2).

## 5. Contributions on the server, and your impact (slices E and F)

Owner, 2026-10-26: all of §6 of the scope draft is in M12. The guardrails hold for every reward:

- **Rewards count only after moderation** (or trusted publishing). A submission the dedup merges into an event that already existed from another source earns nothing.
- **Quotas stay the spam ceiling.**
- **Any public credit needs the contributor's opt-in.**
- **No streaks, no daily targets, no countdowns, no public leaderboards, nothing that can be lost.**

A `contributions` table (user, submission, event, kind, status, created_at) is the ledger every reward reads from, filled when a submission is approved. Config: `contributions` in `config/plans.json`.

### 5.1 Your impact

- Per-event totals in `event_counts` (event, day, opens, routes, arrivals, thanks): totals only, no device or user stored with them. The app sends them in batches (`/api/counts`), rate-limited by the salted device hash as for reports.
- Shown after adding and in the account card: "opened 34 times, 6 walked there". "Going" joins in M9.
- "Shown on the map" is left out: area snapshots are cached at the edge, so there is no honest count of them. Opens are the first true number.

### 5.2 Premium for contributions

- **3 premium days per verified event, at most 30 earned days per calendar month** (owner, §9.2). An M8 grant with a new source, `contribution` (the `plan_grants.source` check gains it).
- **Days stack after the account's current premium end**: days earned during the promotion start counting on 1 Dec 2026. After the promotion ends, contribution days are how people get premium until a payment provider exists (owner, §9.2). `earlyAccess.until` stays 2026-11-30.
- An event removed later for being wrong takes back its days if they have not started yet.

### 5.3 Trusted contributor

- **After 5 verified events with no rejections** (owner, §9.3): new events publish without the "Unverified" label and skip the queue. Moderators still see them in a "published by trusted" list for spot checks, and reports work as for any event.
- One rejection removes trust until an admin restores it. Thresholds in config.

### 5.4 Levels without streaks

Neighbour → Local → Guide → City guide, from verified events and opens of your events (thresholds in config). Levels only go up. Shown on your account card and, with the credit opt-in, on your events.

### 5.5 Public credit

"Added by <display name>" (and the level) on an event card only when the account turns on **"Show my name on events I add"**; off by default (owner, §9.4). Otherwise events stay anonymous. Turning it off hides the name everywhere at once.

### 5.6 Built (slice E, 2026-10-28)

Owner, 2026-10-28: the levels as proposed (Neighbour 1 verified event; Local 5; Guide 20 and 200 opens; City guide 50 and 1,000 opens).

- **Ledger** (`20261028000015_contributions.sql`). `contributions` has one row per account submission that a moderator approved or a trusted account published. Premium days, trust and levels all read from it. `contribution_award` records a submission once:
  - it gives `premiumDaysPerEvent` (3), never past `premiumDaysPerMonth` (30) in the calendar month, counted in Warsaw time;
  - the days are a `contribution` grant that starts after the account's latest premium end, and not before a running promotion ends;
  - one award at a time per account, so two approvals can't both pass the cap.
- **Duplicates earn nothing.** This was needed because a user's event is published without dedup. Before recording, the API checks other live events within `dedup.radiusM` (200 m) starting within the dedup tolerance, and compares titles with ingest's dedup rule. An older listing with a similar title makes it a `duplicate`, worth 0 days. On real data, other screenings at the same cinema and time have different titles, so they don't count.
- **Taking back.** A moderator hiding a reported event, or rejecting a trusted publication, revokes its reward: days not yet started are taken back, started ones stay.
- **Showing the real end of premium.** Core `effectivePlan` carries the end through back-to-back grants of the same plan, so days banked behind the promotion show their real end. `grants_active` already returned future grants.
- **Trusted.** At least `trustedAfter` (5) approved events and no rejection since trust was last restored. A trusted account's events are stored as approved by `trusted` and published verified, with their reward recorded at once. Moderators see the last 7 days under "Published by trusted contributors" in the queue, with Reject. The admin restores trust with `POST /api/admin/trust {email}`; its button comes with F.
- **Counts.** `POST /api/counts {deviceId, items}` adds opens (an event card opened), routes (in-app "Going there" started) and arrivals to `event_counts`:
  - per event and day, totals only, nothing stored about the device;
  - at most `counts.maxBatch` (50) items, rate-limited per device (`counts.perHourPerDevice`);
  - the app batches them every 10 s and when the page is hidden, once per event and kind per session, and drops failures.
- **Contributor's side.** `GET /api/me/contributions` returns verified events, opens, routes and arrivals, whether you're trusted, this month's days, your level (stored as the highest reached), the credit setting and your events with their counts. `PUT /api/me` takes `showName` and `displayName`.
- **Credit.** `event_credit(event)` (public) gives the name and level only while the adder has the credit on and a name. It's read live, so turning it off hides it everywhere at once. Showing it on the card comes with F.
- **Export.** It now includes the account's rewards.
- **Tests.** Core (the cap, joining grants, levels, the config check), API (rewards on approval and trusted publishing, duplicates, revoking, counts, the contributor's side, credit and trust), web (the counts batch, the trusted list), and `scripts/m12-contributions.db.test.ts` in CI. The migration ran on the live data in a rolled-back transaction.
- **Not checked signed in** on the Cloudflare preview: it still lacks its Supabase settings. The restore-trust button and showing the credit came with slice F (§5.8). The database test's own helper had a type error, so its first CI run failed after the merge; fixed in #37, where all seven tests pass on Postgres.

### 5.7 Slice F UI

The after-add screen (what happens next, your impact so far, days earned), and the account card's contributor section: impact totals, level, trusted status, days earned this month, the credit toggle and your past events (for add again). No mockup (owner, 2026-10-28): built from the account card and usage styles.

### 5.8 Built (slice F, 2026-10-29)

- **After adding.** Under "Thanks!", what the event earns:
  - waiting for review: the days it earns once approved;
  - a trusted account's event: the days it got, and from which day when they start after the promotion;
  - the month's cap reached, or a duplicate: said plainly, without blame.
- **Impact after adding.** Below the note are the impact totals and "See your impact", which opens the account card. Nothing shows when signed out.
- **Account card** (`components/Contributor.tsx`). A "Your contributions" section, shown once the account has added an event:
  - the level, and what the next one needs, worded as information;
  - verified events, opens, routes started and arrivals;
  - the trusted badge, or how trust is earned;
  - this month's premium days, "9 of 30";
  - the credit switch, then the account's events (newest first, up to 100) with their state, opens and the days each earned. A live or pending event opens its card. "Add again" comes with slice H.
- **Credit switch.** "Show my name on events I add" is off by default. Turning it on asks for a name first, and nothing is saved until one is given. Turning it off saves at once. Both go through `PUT /api/me`.
- **"Added by"** on the event card, for community events only. It's read live through the public `event_credit` (the event repositories' `credit()`), not from the cached area, so turning the credit off hides it at once. Lists and the map don't show it.
- **Admin.** "Restore trust" (email) next to "Give premium". The grants list now labels contribution grants.
- **Level names** are strings per configured level id. A test checks that every level in config has them in both languages.
- **Tests.** `apps/web/test/m12-impact.test.tsx` covers the section (levels, states, opening, trusted, empty), the credit switch, the after-add variants, the card credit and restore trust.
- **Checked** in the dev build at 380 px, in Polish and English, on a throwaway page with a stubbed `/api` (deleted, not committed): no horizontal scroll, and the credit switch saves and shows the name. The account card sits in About's `.prose`, whose list rule indented the events list. Fixed.
- **Not checked signed in** on the Cloudflare preview, which still lacks its Supabase settings.

## 6. Reasons to add, on the map and in lists

### 6.1 Places first (slice M)

Adding the first event at a place with no event in the past 90 days and none upcoming (same venue, or same H3 r10 cell when there is no venue) marks it in the ledger. The adder's card shows "first added by you"; others see nothing extra. The new place lights up on the map for everyone simply by having an event.

### 6.2 District goals (slice N)

"Nadodrze has 3 events this weekend: know something on?" appears **only** in the list's empty state and the guidance card when your reach is empty, from the district data (slice A). Never a notification.

### 6.3 Season collections (slice N)

`config/seasons.json`: id, labels, date range, categories and keywords. An event that fits shows in a themed list anyone can open from the list view while the season runs. The adder's account card counts their events in it. No ranking inside the list beyond time and distance.

### 6.4 Thanks from visitors (slice M)

After GoThere marks an arrival, a one-tap "Thanks" on the card. Anonymous, one per device per event. The adder sees the total in their impact. Never shown on the public card.

## 7. Free and paid after M12

| Feature                                 | No account | Free account | Premium |
| --------------------------------------- | ---------- | ------------ | ------- |
| Share into Happow, quick add, add again |            | ✓            | ✓       |
| Poster photo (counts as an autofill)    |            | 5 a month    | all     |
| Recurring events, feed import           |            | ✓ (quota)    | ✓       |
| Your impact, levels, credit opt-in      |            | ✓            | ✓       |
| Premium days for verified events        |            | ✓            | ✓       |
| Thanks after arriving                   | ✓          | ✓            | ✓       |

Paid never changes where or how an event shows.

## 8. Acceptance

- The five metrics are recorded weekly from slice A on; the M12 report compares them with the baseline.
- Each new source has a contract test on recorded fixtures; CI makes no live calls.
- On a phone (Android, installed PWA): share a link from another app into Happow and get a filled form; add an event from a poster photo; add one with quick add; repeat one with add again.
- A test account goes from 0 to trusted with 5 approved events, earns 15 days, and sees its impact counts; a rejection removes trust.
- Docs updated: the brief's "More venue and event data", `docs/ADVANTAGES.md` (sources and contributor rows), About (OSM attribution).
- **Owner to-do:** ask Going and Eventim for a partner feed; fix the preview Worker's Supabase secrets and build variables so signed-in flows can be checked on previews.

## 9. Owner decisions (2026-10-26)

1. **Order:** A1 → A2 (with the source review list) → share target → impact → premium for contributions → poster photo, then the rest. Slice A (metrics) goes first as a small measuring step.
2. **Premium for contributions:** 3 days per verified event, at most 30 a month. After the promotion ends on 30 Nov 2026 they are the way to premium until a payment provider exists.
3. **Trusted contributor:** after 5 verified events with no rejections.
4. **Public credit:** opt-in, off by default.
5. **Poster photo:** one Claude Haiku call per photo, counted as an autofill and bounded by the daily LLM cap.
6. **Gamification in M12:** all of it: your impact, premium days, trusted contributor, places first, levels without streaks, district goals, season collections and thanks from visitors.
7. **Faster adding in M12:** all of it: share target, poster photo, quick add, add again, recurring events and account feed import.

Not in M12: streaks, daily goals, public leaderboards, points with no meaning, paid visibility. Instagram, Google Places and Facebook events stay out (brief).
