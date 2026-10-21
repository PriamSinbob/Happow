# Milestone 4 — Crawler and submissions: report

Oct 20, 2026

## Built

- **Extraction package** (`packages/extract`):
  - **JSON-LD reader.** Handles `@graph`, `ItemList` wrappers, `mainEntity`, and `EventSeries` whose dated `subEvent`s inherit the parent's title, place, offers and URL. It is tolerant of broken JSON (control characters, trailing commas) and HTML entities.
  - **Page-to-text** stripping, page metadata and link discovery.
  - **robots.txt** parser with RFC 9309 matching (longest match, `*` and `$`, per product token).
  - **SSRF-safe fetch.** http(s) only, no private, loopback or link-local addresses, and every redirect hop is re-checked. Size and time limits apply.
  - **Nominatim geocoder.** 1 request/s, region bounding box, and a street → venue → postcode fallback that lowers confidence for coarse matches. A cache sits in front of it.
  - **`Extractor` interface with a Claude implementation.** Claude Haiku 5.5 with structured output (zod schema), low effort, a cached system prompt, and refusal and `max_tokens` handling. Category ids come back as plain strings and are filtered against the taxonomy in code.
- **Crawler adapter** (`packages/ingest/src/adapters/crawler.ts`). Targets are in `config/sources.json`:
  - **eBilet** Wrocław listing (JSON-LD).
  - **wroclaw.pl GO** city portal: listing plus up to 120 detail pages.
  - **NFM** concert hall: no structured data, so LLM fallback over up to 25 detail pages.

  For each page the adapter:
  1. Checks robots.txt once per origin.
  2. Reads JSON-LD first and calls the LLM only when it is missing and the source allows it.
  3. Caches LLM results by content hash in `extraction_cache`, so unchanged pages cost nothing.
  4. Drops events in other cities (region `localities`) and beyond a 60-day horizon.
  5. Maps categories from schema.org types and URL path words.

  Crawled sources keep facts and link back: descriptions and images are not republished. Run timed series (end more than 24 h after start) lose their bogus end, and the category default applies.

- **Pipeline.** Step 4 (geocoding) now runs for events without coordinates, with cached results in `geocode_cache`. Confidence is the extractor's confidence multiplied by the geocode precision. Below `extraction.minConfidence` (0.7) an event goes to the moderation queue instead of the map, and re-crawls update the queued item while it is pending. Run stats report `geocoded` and `queued`.
- **Server API** (`packages/api`, served by a Cloudflare Pages Function at `/api/*` on the app's own origin):
  - `POST /api/autofill`: up to 5 prefills from a pasted link, JSON-LD first, then LLM. The description is never copied.
  - `POST /api/geocode`: address to a point inside the region.
  - `POST /api/submissions`: validated, normalized like any source, and stored. It is shown at once as **Community · Unverified** while `submissions.publishBeforeModeration` is on.
  - `POST /api/reports`: one open report per device per event.
  - `GET /api/moderation`, plus `POST /api/moderation/submissions/:id` (approve or reject) and `POST /api/moderation/reports/:eventId` (dismiss, mark cancelled or hide). Moderators are checked against Supabase Auth and the `moderators` table.

  Business rules live in `security definer` Postgres functions that only the service role can run. Devices and IPs are stored only as salted SHA-256 hashes. Rate limits per device and IP come from config. `pnpm dev` serves the same handler through Vite.

- **Database (migration 4).**
  - `events.verified` and `events.hidden` columns. The public view hides hidden events and returns `verified`.
  - Submissions gain kind (user or crawl), source, confidence and the linked event.
  - New tables: `reports`, `moderators`, `rate_limits`, `geocode_cache`, `extraction_cache`.
  - Functions: `submit_event`, `report_event`, `moderation_queue`, `moderate_submission` (approve publishes or verifies; reject hides), `resolve_reports`, `rate_limit_hit`.
- **Web.**
  - **Add an event** (`#/add`, the **+** button):
    - Paste a link and pick from the events found, or fill the form by hand.
    - Fields: title, up to 3 categories, start and end, place and address with **Find on map**, a mini map where you tap or drag the pin, free or paid with an amount in the region's currency, link and short description.
    - Inline terms, validation messages, and a success screen with **Show event**.
  - **Report a problem** sheet on the event detail screen.
  - **Unverified** badge on cards, detail and list rows.
  - **Moderation** (`#/moderate`): magic-link sign-in, the submission queue (user and low-confidence crawls, with confidence and source), and reports grouped per event with reasons and notes.
  - **About** (brand pill): what Happow is, sources, terms of use, privacy, takedown contact (`config/app.json` → `legal.contactEmail`) and attribution.

  Everything is in Polish and English.

- **Ops.**
  - The Ingest workflow gets `ANTHROPIC_API_KEY`.
  - The deploy workflow runs wrangler from `apps/web`, so the function is deployed with the app.
  - `.env.example` and the README document the server secrets, Supabase Auth redirect URLs and moderator setup.
  - The brief's architecture table records the Pages Function choice.
- **Tests (all passing).** Unit tests: core 28, extract 32, ingest 45, api 15, web 22. The PostGIS suite has 25 tests:
  - Extract and crawler tests are contract tests against pages recorded from eBilet, wroclaw.pl GO and NFM (trimmed, in `test/fixtures`), with the LLM stubbed. No live calls in CI.
  - API tests cover validation, rate limits, auth (401/403), conflicts and encoded event ids.
  - The DB suite now covers the submission, report and moderation functions and low-confidence queueing.

  The Pages Function bundle was built with wrangler and run under `wrangler pages dev` against a mock Supabase. The UI was checked in headless Chromium at 380 px (English) and 320 px (Polish): add flow with autofill, report, About and moderation. No horizontal scroll and no console errors.

## Skipped / deferred

- **Photo upload** on submissions (needs storage and image moderation). Submissions carry a link instead.
- **Batch API** for crawl extraction. With the content-hash cache only new or changed pages reach the model, and the volume is a few dozen pages a day, so synchronous calls are simpler for now.
- **Prompt cache.** The system prompt is marked for caching, but it may be shorter than the model's minimum cacheable prefix, in which case caching silently does nothing (cost impact is negligible at this volume).
- **Cross-source venue merging** and **dedup on approval** of crawl items. Approved items go through `publish_event`, not the dedup pass. Low-confidence items are rare, so duplicates are left for moderators.
- **Social sources** (Threads, Instagram) are milestone 5 territory, as are "possibly cancelled" flags.
- **Editing a submission** before approving it. Moderators approve or reject; fixing details means reject and re-add.

## Open issues

- **Secrets to add.**
  - GitHub: `ANTHROPIC_API_KEY`.
  - Cloudflare Pages project: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUBMITTER_SALT`, `ANTHROPIC_API_KEY`.
  - Apply migration 4 (**Database migrate + seed** workflow).
  - Supabase Auth: Site URL and Redirect URLs, then invite moderators and add them to `moderators`.
- **Takedown contact.** `legal.contactEmail` is `null`, so the About page tells people to use "Report a problem". Set a real address before the public launch.
- **Legal text is a draft.** The terms and privacy bullets are marked as draft in the app and need a review, especially GDPR wording on hashed device ids.
- **Crawl permissions.**
  - robots.txt allows all three targets today.
  - eBilet's terms may still restrict automated use, so ask them or switch to a partner feed if one exists.
  - wroclaw.pl GO content is municipal; check its reuse licence.
- **Selectors drift.** The GO `followPattern` and NFM's event URL pattern are in config. Watch `source_runs.stats` (`fetched` dropping to 0) after site redesigns.
- **Nominatim usage policy.** 1 request/s with an identifying User-Agent and caching is within policy for this volume. Self-hosted Photon is the path if submissions grow.
- **Abuse.** Device ids are client-generated. Rate limits per IP hash back them up, but a determined spammer can still post a handful a day before moderation. Switch `publishBeforeModeration` off if that happens.

## Follow-up (Oct 21)

- After a legal review of the three targets, **eBilet is paused** (`enabled: false`): its terms limit use to personal use without written consent. wroclaw.pl GO and NFM now run once a day with 5 s between requests (`12/m`), and crawled events stay visible for 72 h without a re-check. The crawler's policy and opt-out are public in `docs/CRAWLER.md`, and the User-Agent links to it.
- URL autofill has a global daily cap on LLM calls (`extraction.autofillLlmPerDay`, 300), and falls back to the manual form if the call fails or the cap is reached.
- `docs/SETUP.md` walks through every account and secret.

## Follow-up 2 (Oct 21)

- **Hosting moved to Cloudflare Workers** (static assets + `/api` Worker, `wrangler.jsonc`), deployed by Cloudflare's GitHub integration. This replaces the Pages Function and the `deploy-web` workflow, because new Cloudflare projects are Workers.
- **URL autofill is off** for the PoC (`submissions.autofill: false`); it is planned as a paid add-on (see the brief's Future features).
- **eBilet is back on** for evaluation. Its listing holds one summary per show or tour, so the crawler now follows each show's page (`summaryListing`). There it finds the Wrocław dates, venue, street address, price and ticket link. The live run on Oct 21 gave 17 Wrocław performances from 35 requests. Placeholder 0 prices on ticket offers no longer show as "Free".
- **Community status flags (migration 5).** Anyone can report an event as cancelled, venue closed, stopped by weather, or moved. Open status reports are summed on the event, and the map, list, card and detail show a warning ("Venue reported closed · 2 people · 10 min ago, not confirmed yet"). The threshold is `submissions.flagThreshold` (1 in the PoC). Other users see it on their next refresh, within 60 s; the reporter sees it at once. A device can change its report. Moderators confirm (mark cancelled or hide) or dismiss, and dismissing clears the warning.

## Follow-up 3 (Oct 21): battery and calm UI

- **Location:** no continuous GPS watch. One precise fix when the app opens and on the locate button, then a cheap network-based fix every 5 minutes while the app is on screen and when it returns after a while. Nothing runs in the background. A coarse fix that still contains a better earlier one is ignored, and the search centre moves only after 100 m (`refresh.locationMinutes`, `refresh.moveThresholdM`).
- **One cached download per area (migration 6, `GET /api/area`):**
  - The phone downloads one compact snapshot: everything within a radius bucket of a 0.05° grid point for the next 24 h, without long fields.
  - The list, radius, time windows, filters and hotspot counts are all computed locally, so changing them costs no request.
  - Snapshots refresh on 5-minute step boundaries that are shared by everyone. Cloudflare's edge cache serves the same snapshot to everyone in the area, and an unchanged snapshot comes back as a tiny 304 (ETag).
  - The event list and the hotspot counts now come from one request instead of two.
  - Event detail always reads that one event fresh, so warnings and cancellations are current where people decide whether to go.
  - Older servers fall back to direct queries.
- **Clock:** a minute clock on the minute, paused while the app is hidden, drives labels and local filtering only. The old 60-second download timer is gone. Measured in a 12-minute browser run: 3 area downloads, 3 location requests, 0 GPS watches and 0 running animations.
- **Map:** expired tiles are not re-downloaded (they are cached for a week), and there are no tile fade-ins.
- **Calm UI:** the endless animations are gone (pulsing pins for running events, blinking "Now" dots, the pulsing hotspot) and replaced by a static halo and dot. Only short one-time transitions remain, plus the spinner during the one precise location fix.
- **Pin fix:** MapLibre overwrote the pin's rotation, which tilted category icons 45° and disabled the "selected" enlargement. The shape now lives on an inner element.
