# Milestone 12 — More events: spec

Oct 26, 2026

Spec from the scope draft of 2026-10-26 (agreed in direction by the owner the same day) and the owner's answers to its questions (§9). M12 comes right after M8. Build it the usual way: post each slice's plan, wait for the owner's OK, build it, then replace the "Status" line with the report.

**Status:** in progress. Spec agreed by the owner (2026-10-26). Built: slice A (metrics) and C1 (OSM venues, the website check and accepted sites), 2026-10-28. Slice B is folded into C.

Goal: **more events on the map, and more people adding events in the app.** Both halves matter. The reasons to add events (§6) matter most. The brief's rules hold throughout: no streaks, no guilt mechanics, no fake urgency, pull not push, and paid never buys visibility. Every source and provider lives in config, each adapter gets a contract test on recorded fixtures, and CI makes no live API calls.

## Build plan

One branch and one PR to `main` per slice, as in M6 and M8. The order follows the owner's answer to §9.1: sources A1 → A2, then share target → impact → premium for contributions → poster photo, then the rest. Slice A comes first because it is small and makes the progress measurable. Each slice PR updates its row below and the Status line, and adds a short "Built (slice X)" note under its spec section (built, skipped, open).

| Slice | Spec      | What                                                                                                                    | Needs | Mockup | Status  |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------- |
| A     | §1        | Metrics: districts in data, `m12_metrics()`, `pnpm metrics`, a weekly row by the cron                                   | —     | —      | built   |
| B     | §2.1      | Folded into C (owner, 2026-10-28): no feeds found by hand, so the website check finds them                              | —     | —      | folded  |
| C1    | §2.1–2.2  | OSM venues, links and pin moves, the website check, candidates, and the reader for accepted sites (iCal, REST, JSON-LD) | A     | —      | built   |
| C2    | §2.2      | Admin tab "Source candidates": samples, accept or reject, paused sites                                                  | C1    | admin  | planned |
| D     | §4.1      | Share into Happow: PWA share target opens the add form filling from the link                                            | —     | yes    | planned |
| E     | §5        | Contributions on the server: rewards ledger, impact counters, premium days, trusted contributor, levels, credit opt-in  | —     | —      | planned |
| F     | §5 UI     | Your impact and contributor card: after-add screen, account card, level, credit toggle                                  | E     | yes    | planned |
| G     | §4.2      | Poster photo: Claude Haiku reads a poster into the add form                                                             | D     | yes    | planned |
| H     | §4.3–4.4  | "Happening here" quick add, and add again                                                                               | F     | yes    | planned |
| I     | §4.5      | Recurring events by pattern, stored as separate occurrences                                                             | H     | yes    | planned |
| J     | §2.3      | Regular services at places of worship, from OSM `service_times` and parish pages                                        | C     | —      | planned |
| K     | §2.4–2.5  | Cultural institutions, universities and more ticket sites as crawl targets                                              | B     | —      | planned |
| L     | §4.6      | Calendar feed import for an account                                                                                     | B, E  | yes    | planned |
| M     | §6.1, 6.4 | Places first on the map, and thanks from visitors after GoThere                                                         | E, F  | yes    | planned |
| N     | §6.2–6.3  | District goals in empty states, and season collections                                                                  | A, F  | yes    | planned |
| O     | §3        | Admin coverage view: events per district and category, today and the week                                               | A, C  | admin  | planned |

B, C, J and K add events with no UI and can ship while the UI slices wait for their mockups. D needs only the add form from M8 G.

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post each slice's detailed plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and `npx prettier --check` on changed files. Each new adapter has a contract test against recorded fixtures in `packages/ingest/test/fixtures/`. Overpass, feeds and Claude are faked in tests; no live calls in CI.
- **UI slices** (C admin, D, F, G, H, I, L, M, N, O): a mockup in `docs/design/` for the owner's OK first, built from the prototype's components and the exact icons in `docs/design/icons/`. The `design-review` subagent is paused (owner, 2026-10-26); run it only if the owner asks.
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

### 2.3 Regular services at places of worship (slice J)

- From OSM `service_times` on places of worship (from slice C) and, where a parish page publishes a timetable, from that page through the crawler.
- A generator turns the weekly pattern into **separate events, one per occurrence**, for the next 14 days, in the `religious` category. They are never merged into one card (time-first principle). Holidays: where the source gives none, the pattern simply runs; a report from the card removes one occurrence.
- `trust: crawled`, `confidence` from the source. Attendance features stay off for religious events (M6 §9).
- **Tests.** `service_times` parsing (OSM's `opening_hours` grammar, e.g. `Su 08:00,10:00,12:00; Mo-Sa 18:00`), DST weeks, a malformed tag.

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
- Android installed PWA shows Happow in the share sheet. iOS does not support web share targets: the add form's paste-link field stays the path there, and the mockup shows the iOS hint.

### 4.2 Poster photo (slice G)

- A camera / gallery button in the add form. The photo is shrunk on the device (long edge ≤ 1568 px, JPEG) and sent to `/api/autofill/photo`. **Claude Haiku 5.5** (vision) reads title, start, end, place, price and category into the same strict JSON as text extraction.
- Counts as one autofill, only when it fills something. Bounded by the global daily cap `extraction.autofillLlmPerDay` (owner, §9.5). Model and limits in config.
- The photo is not stored and not sent anywhere else; the event gets no image from it (copyright rule).
- **Tests.** The endpoint with a fake extractor: quota taken only on a useful fill, cap reached, oversize rejected.

### 4.3 "Happening here" quick add (slice H)

One screen: the pin at your location, the start at now (end from the category's default duration), a title and a category. More fields stay one tap away. Goes to the same queue.

### 4.4 Add again (slice H)

From your past events (account card and after-add screen): pick one, choose a new date and time, check, send. Each date is its own submission and its own event.

### 4.5 Recurring events by pattern (slice I)

In the add form, "Repeats": weekly on chosen days at a time, until a date (at most 12 weeks ahead). The server stores **one event per occurrence**, linked by a `series_id`. Each occurrence counts against the monthly quota, and moderation approves the series once. Editing or cancelling one occurrence leaves the others.

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

### 5.6 Slice F UI

The after-add screen (what happens next, your impact so far, days earned), and the account card's contributor section: impact totals, level, trusted status, days earned this month, the credit toggle and your past events (for add again). Mockup first.

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
