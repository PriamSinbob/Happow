# Milestone 13 — Launch readiness: spec

Nov 5, 2026

Spec from the brief (Milestones → M13, and "Before public launch") and the open items in [docs/HARDENING.md](../HARDENING.md). M13 comes after M7 in the build order. The owner asked for M7 and M13 to be planned and built in one go, with all slices, without stopping for confirmation (2026-11-05): this spec records the plan and each slice's "Built" note.

**Status:** spec written and built on 2026-11-05, on one branch with M7. The legal texts are drafts for the owner's (and ideally a lawyer's) review; nothing goes public until the owner switches the launch flags. What only the owner can do (register the domain, Supabase and Cloudflare settings, consents from sites, the operator's name and address) is in §7 and in `pnpm launch:check`.

Goal: **everything the code can do for a public launch is done, and what's left is a short, checkable list of the owner's decisions and settings.** The brief's rules hold: no new data sources, no paid visibility, every provider in config, no secrets in code, contract tests with fixtures and no live calls in CI.

## What exists

- **Legal text in the app:** four bullets each for terms and privacy on the About page, marked "Draft text for the pilot" (`about.draft`). The terms sheet after sign-in asks to accept `legal.termsVersion` (`2026-10-24-interim`). M11 and M7 left consent paragraphs for the owner (contacts and private events; follows and alerts).
- **Contact and domain:** `legal.contactEmail` is the owner's personal address (interim, 2026-10-22); the crawler's User-Agent links to `happow.krasnoroda.workers.dev/crawler`; three push senders fall back to a hard-coded `https://happow.app`.
- **Crawler:** robots.txt honoured, one request every few seconds per site, LLM results cached by content hash. It re-downloads every page on each run, has no conditional requests, and doesn't look for TDM reservations.
- **GDPR:** `account_export` and `account_forget` grew milestone by milestone (M8–M11, M7). Some account data (push subscriptions, reminders, attendance, feeds, organiser reports) is deleted with the user but missing from the export.
- **Email:** none. Sign-in codes are mailed by hand from the admin panel (`auth.emailDelivery: "manual"`).
- **HARDENING.md:** seven security items and seven optimisation items, each marked "Before launch", "Soon", "When…" or "Check".

## Build plan

One branch with M7 (owner, 2026-11-05). Each slice adds a "Built" note under its section.

| Slice | Spec | What                                                                                                    | Status |
| ----- | ---- | ------------------------------------------------------------------------------------------------------- | ------ |
| A     | §1   | Legal texts as pages (terms, privacy with the art. 13/14 notice, takedown, storage), PL and EN; consent | built  |
| B     | §2   | One place for the site's address, contact and operator; no domain in code                               | built  |
| C     | §3   | Crawler politeness: conditional requests, unchanged pages skipped, TDM reservations, contact in the UA  | built  |
| D     | §4   | GDPR across every account feature: export completeness test, retention                                  | built  |
| E     | §5   | An email sender behind a provider interface: sign-in codes, and follow alerts by email                  | built  |
| F     | §6   | HARDENING items the code can close                                                                      | built  |
| G     | §7   | `pnpm launch:check` and the owner's launch list                                                         | built  |

## 1. Legal texts

- **Pages, not bullets.** Markdown in `docs/legal/` (`terms`, `privacy`, `takedown`, `storage`, each `.pl.md` and `.en.md`) rendered at build time to static pages at `/legal/<name>` (Polish) and `/legal/<name>.en` (English), like `/crawler`. No JavaScript on them, so they can be linked from store listings and emails later.
- **Placeholders from config:** `{{operator}}`, `{{address}}`, `{{contactEmail}}`, `{{siteUrl}}`, `{{termsVersion}}`, `{{retention…}}` values. A missing operator shows "[to be completed before launch]" on the page and fails `launch:check`.
- **Content** (drafts for review):
  - _Terms:_ what Happow is, accounts and plans (free, premium, early access), adding events and the licence to show them, private events, organisers' claims and posts, prohibited content, moderation (hide, remove, block), no guarantee of event details, liability under Polish law, changes to the terms (a new version is accepted in the app).
  - _Privacy:_ controller and contact; what is processed without an account (nothing stored with an identifier; salted hashes of device and IP for limits; the atlas, saved events and follows stay on the device), with an account (email, profile, plans, submissions, contributions, saved events, contacts and private events, follows and alerts, push subscriptions), legal bases (contract, legitimate interest, consent for notifications), processors (Supabase, Cloudflare, Anthropic for page and poster reading, Plausible if on, the email provider, OpenStreetMap tiles, openrouteservice), retention, rights (access, export in the app, deletion in the app, objection, complaint to the UODO), and the **art. 14 notice** for people named in public event listings (performers, organisers): source, purpose, legitimate interest, objection by email.
  - _Takedown (DSA notice and action):_ report button on every event, or email; what a notice needs; moderators decide within 48 h for unlawful content; the reporter and the uploader are told; appeal by email; crawled sites' opt-out (the crawler page).
  - _Storage note:_ no cookies; local storage keys by purpose (preferences, atlas, saved, follows, the sign-in session, push endpoint); the service worker's offline cache; Plausible is cookie-free.
- **In the app:** About keeps a one-line summary per section with a link to the page in the current language; the draft line goes. The terms sheet links the terms and privacy pages.
- **Consent:** `legal.termsVersion` moves to a new version, so every account accepts once more (M11's and M7's paragraphs are folded into the privacy policy).

**Built (slice A).** Eight drafts in `docs/legal/` (terms, privacy with the art. 13 and art. 14 notices, takedown, storage; Polish and English), rendered by the same build step as `/crawler` (`apps/web/build/crawlerPage.ts`) at `/legal/<name>` and `/legal/<name>.en`, with `{{…}}` values from config; an unknown placeholder fails the build. About keeps its short bullets and links the four pages; the terms sheet after sign-in links them too. `legal.termsVersion` is now `2026-11-05-draft`, so every account accepts once more; M11's and M7's consent paragraphs are folded into the privacy policy. Two claims were checked against the code and corrected in the drafts: one report already shows the warning (`flagThreshold` 1), and repeat offenders lose trusted status (there is no general "blocked from adding"). Open: the operator's name and address, and a lawyer's read.

## 2. Domain, contact and operator

- **`site` in `config/app.json`:** `url` (the public origin), `name`. `legal` gains `operator` and `address` (null until the owner fills them). `legal.contactEmail` stays the one contact.
- **Built from config:** the crawler's User-Agent becomes a template (`Happow/{version} (+{siteUrl}/crawler; {contactEmail})`), the push senders' VAPID subject uses the contact email or the site URL, the legal pages and the crawler page read the same values.
- **A test fails** when a domain or email address appears in code outside config, docs and fixtures.
- Changing domain is then: register it, point it at the Worker, set `site.url` and `legal.contactEmail`, update Supabase's redirect URLs (§6).

**Built (slice B).** `site` (`url`, `name`) and `legal.operator`, `legal.address` in `config/app.json`. The User-Agent is the template `Happow/0.5 (+{siteUrl}/crawler; {contactEmail})`, filled by `siteTemplate` in core (and a copy in the build step, which Vite can't load core for; a test checks they agree). The push senders' fallback subject is `site.url`. A core test fails when a domain or a personal mailbox appears in code.

## 3. Crawler politeness

- **Conditional requests.** A `page_cache` table per URL keeps `ETag`, `Last-Modified`, the content hash and the last extraction. The next request sends `If-None-Match` / `If-Modified-Since`; a 304, or an unchanged body, reuses the stored extraction without parsing or calling Claude.
- **Unchanged detail pages skipped.** A followed event page fetched less than `crawler.revisitHours` ago whose listing link is unchanged is not fetched again; its stored extraction is used.
- **TDM reservations** (EU DSM Directive art. 4, TDMRep): `/.well-known/tdmrep.json` once per origin and run, the `tdm-reservation` response header and `<meta name="tdm-reservation" content="1">`. A reserved page is never sent to the LLM; published structured data (JSON-LD facts: title, time, place) is still read, as for any visitor. Counted in the run's stats.
- **Contact in the User-Agent** (§2).
- Contract tests with recorded responses: a 304 path, an unchanged body, a tdmrep.json reservation, a meta reservation.

**Built (slice C).** Migration 28 adds `page_cache`; `HttpClient.page()` sends the validators and returns 304s. The crawler reuses a page's last extraction on 304 or an identical body, skips event pages read within `ingest.politeness.revisitHours` (72) whose events are all more than `revisitFarDays` (7) ahead, and checks TDM reservations (header, meta, `tdmrep.json` once per origin) only when a page would go to the LLM, so JSON-LD sources make no extra request. Counters go to the run's stats as `polite`. Contract tests cover the 304, the unchanged body, the revisit skip and the three reservation forms; `docs/CRAWLER.md` says what the crawler now does.

## 4. GDPR across every account feature

- **Export completeness.** A DB test lists every column that references `auth.users` and fails unless its table is in `account_export` (or listed as derived, with a reason). Gaps found get added: push subscriptions (as devices and dates, no keys), reminders, attendance with an account, account feeds, organiser report answers, follow alerts.
- **Deletion.** The same test deletes a user with data in every such table and checks nothing personal is left (rows gone, or the user reference nulled where the row is someone else's, such as a report).
- **Retention** stays as built (code requests 7 days, private events 30 days after they end, follow alerts 30 days); the privacy page lists each.

**Built (slice D).** Five gaps were found and added to `account_export` (migration 28): account feeds, reminders, push devices (dates and language, no keys), attendance and reports made with the account. `scripts/m13.db.test.ts` lists every foreign key to `auth.users`, fails on a table missing from its export map, checks every export key exists, and deletes a user with data to check nothing refers to it afterwards.

## 5. Email sender

- **Provider interface** in `packages/api/src/email.ts`, provider in config (`email.provider`: `none` or `resend`; `email.from`; the key's secret name). Resend first (an HTTP API that works from a Worker); Cloudflare Email Sending can be added as another provider later.
- **Sign-in codes:** `auth.emailDelivery` gains `"app"`: the Worker creates the code and emails it at once. `"manual"` stays the default until the owner has the domain and a verified sender.
- **Follow alerts by email** (M7 §5): an "Also by email" switch beside the alerts when a sender is configured. Same queue; an alert goes by email when the account asked for it.
- **Contract tests** against Resend's documented request and response, faked.

**Built (slice E).** `packages/api/src/email.ts` (Resend; `email` in config, secret `RESEND_API_KEY`). `auth.emailDelivery: "app"` makes the code and emails it at once from `/api/auth/code-request` (503 without a sender, 502 when sending fails); `"manual"` stays the default. Follow alerts gain `follow_settings.email` and "Also by email" (shown only when a provider is set); the cron sends the email in the account's language with the link and how to stop, and an alert counts as delivered when either channel worked. Contract tests on Resend's documented request and error.

## 6. HARDENING items

Closed in code:

- **Account feed addresses** are checked again before each fetch (private addresses refused), and a feed's download is capped (`feeds.maxBytes`).
- **Feed import** works out each event's key and skips known ones before geocoding.
- **Coverage** counts per district once and splits by category from that.
- **District goal** is cached at the edge per district and weekend.
- **Previews never run the cron:** a test checks `wrangler.jsonc` has no `triggers` under `previews`.
- **Sign-in code limits:** kept at 5 per hour per network and 3 per day per address; staff get no bypass (an admin can still generate a code from the panel). Documented as decided, pending the owner's word.
- **Preview image fonts:** subset to Latin and Polish, which cuts about half a megabyte from the Worker.

Left to the owner (in §7): previews' own database, Supabase redirect URLs, Workers Paid (reminders per tick, preview images), Biletyna's full terms, measuring the daily ingest run.

**Built (slice F).** Feeds: `fetchPublicText` checks every fetch and redirect and caps at 2 MB (`account-feeds` option `maxBytes`); known keys are read once per feed and skipped before geocoding. Coverage: one pass per district (migration 28); it also stopped counting private events, which it did before. District goal: kept in the app per ~100 m and weekend for one data step, instead of an edge cache (the app reads it straight from PostgREST, so an edge cache would need a new Worker route; revisit if the database shows load). Previews: a test fails if `wrangler.jsonc` gives previews triggers. Fonts: Inter subset to Latin, Latin Extended-A and punctuation, 680 KB → 127 KB (OFL, no reserved name). `docs/HARDENING.md` is updated item by item.

## 7. Launch check and the owner's list

- **`pnpm launch:check`** reads config and prints what blocks a public launch: operator and address missing, contact on a personal domain, `site.url` on `workers.dev`, `auth.emailDelivery` manual, email provider none, sources marked private-testing-only still on (Meetup pages, eBilet), `earlyAccess` running, `legal.termsVersion` still interim. Exit code 1 while anything blocks; CI runs it in report-only mode.
- **[docs/LAUNCH.md](../LAUNCH.md):** the owner's steps in order, each with where to click: register the domain and email routing, verify the sender with the email provider, Supabase redirect URLs and previews' database, Cloudflare plan, the consents (eBilet, ARAW, NFM courtesy), Biletyna's terms, Meetup off, the lawyer's read of the legal texts, the trademark search.

**Built (slice G).** `launchItems` in core and `pnpm launch:check` (exit 1 while anything blocks; `--report` in CI). Sources carry an optional `beforeLaunch` note (eBilet, wroclaw.pl/go, Biletyna, Meetup pages). Today it lists 11 blockers, all config or owner steps, and two checks (early access, analytics). [docs/LAUNCH.md](../LAUNCH.md) is the owner's list.

## Working notes

- Read `CLAUDE.md`, `docs/BRIEF.md` and this spec first.
- Before pushing: `pnpm typecheck`, `pnpm test`, `pnpm test:db` (local Postgres) and `npx prettier --check` on changed files.
