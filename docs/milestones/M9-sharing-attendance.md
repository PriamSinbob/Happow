# Milestone 9 — Sharing and attendance: spec

Oct 30, 2026

Spec from the brief (Future features → Event links, sharing and attendance, requested 2026-10-22) and M6 §9 (co-presence). M9 comes after M12 in the build order (brief, 2026-10-26). Build it the usual way: post each slice's plan, wait for the owner's OK, build it, then replace the "Status" line with the report.

**Status:** spec approved, §9 answered by the owner on 2026-10-30; slices A–C built.

Goal: **a shared event opens in Happow itself, looks right wherever it's pasted, and shows that people are going, without anyone giving up their privacy.** Sharing is the app's growth loop, so all of M9 is free for everyone, with no account and no install for the person who receives a link. The brief's rules hold throughout: no streaks, no fake urgency, pull not push, paid never buys visibility. No new data sources.

## Build plan

One branch and one PR to `main` per slice, as in M12. Each slice PR updates its row below and the Status line, and adds a short "Built (slice X)" note under its section. UI slices follow the existing screens (no mockups since M12 slice D, owner 2026-10-28); the design studio pass comes after everything is built.

| Slice | Spec | What                                                                                             | Needs | Status  |
| ----- | ---- | ------------------------------------------------------------------------------------------------ | ----- | ------- |
| A     | §1   | Clean `/e/<id>` links: the Worker answers them with the event's preview tags; the app opens them | —     | built   |
| B     | §2   | The generated preview image (1200×630), cached at the edge per event version                     | A     | built   |
| C     | §3   | Sharing: link with a short text, share as image, QR code; the in-app route first, Maps second    | A, B  | built   |
| D     | §4   | Links that outlive the event: "Ended" plus what's on now near that place                         | A     | planned |
| E     | §5   | "I'm going" on the card, and the sharer's link-scoped count                                      | A, C  | planned |
| F     | §6   | Co-presence: looking, on the way, here; counts from 5, off for sensitive categories              | E     | planned |
| G     | §7   | Opening in the app: Android link capture, the iOS "Add to Home Screen" hint                      | A     | planned |

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post each slice's plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and Prettier on changed files. No live calls in CI.
- On the owner's Windows checkout: commit only files with real changes (`git diff --ignore-cr-at-eol`), and write commit messages to a file.
- Previews can sign in since 2026-10-30, but they use the **live database**: test attendance on a preview with that in mind (`docs/HARDENING.md`).
- Wording waits for the text pass after the app is finished.

## 1. Clean event links (slice A)

What exists: share sends `/#/e/<id>`, which opens the event card. Social apps fetch a link without running JavaScript and never see the part after `#`, so every shared event previews as "Happow".

- **`/e/<id>`.** The Worker answers `/e/*` before the static files: `"run_worker_first": ["/api/*", "/e/*"]` in `wrangler.jsonc`.
- **Preview tags.** It returns the app's own `index.html` with Open Graph and Twitter Card tags filled in for that event (rewritten as it streams, not rebuilt):
  - title; a description of start–end, venue and category, in the event's region language;
  - `og:url` and the canonical URL; `og:image` (slice B, until then the app icon);
  - `twitter:card` `summary_large_image`.
- **An unknown or hidden id** gets the generic tags and the app's normal "not found" card, with a 404 status so crawlers drop it.
- **The app reads the path.** `/e/<id>` opens the event card, as `#/e/<id>` does today; the hash form keeps working for old shares. Closing the card goes to the map at `/`.
- **Caching.** The tagged HTML is cached at the edge per event for 5 minutes; the event data comes from the same read the API uses.
- **Private events** (M11) will get the generic tags and no details: the Worker checks the event is public before filling anything in. Until M11 every event is public.
- **Tests.** The Worker route with a fake event: tags present and HTML-escaped, a hidden event, an unknown id, the hash link still working.

**Built (slice A).** `packages/api/src/eventPage.ts` answers `/e/<id>` (the Worker reads `index.html` through the new `ASSETS` binding). The tags go in by plain string insertion: `index.html` is under 1 KB, so streaming it through HTMLRewriter would add nothing and couldn't be tested in Node. The description reads day, time, venue and category in the language of the region the event is in. A database error still serves the app (uncached), so a link never breaks. In the app, `adoptEventPath` turns `/e/<id>?…` into `/?…#/e/<id>` before anything reads the URL, so the card, Back and closing work as before. Sharing still sends the hash link until slice C.

## 2. Preview image (slice B)

- **Our own card, never the source's image** (copyright rule): 1200×630, in the app's look, with:
  - a small map around the place with the pin (see §9.1 for how the map is drawn);
  - the category glyph, the title (two lines at most), the day and time, the venue;
  - the Happow mark. No prices, no counts.
- **Made in the Worker** at `/e/<id>/preview.png`: an SVG built from the event, turned into a PNG with a WebAssembly renderer. Fonts are bundled (the app's own).
- **Cached at the edge per event version** (the event's `updated` time in the URL), so an edited event gets a new image and old ones expire.
- **Cost.** Rendering runs once per event version and region of the edge; afterwards it's a cache hit.
- **Budget check.** The renderer and fonts must keep the Worker under its size limit; if they don't, the image moves to a second Worker. The PR reports the bundle size.
- **Tests.** The SVG for a fake event (text escaped, long titles cut, the glyph present) and that the PNG has the right size.

**Built (slice B).**

- **Image.** `apps/web/worker/preview.ts` draws the SVG with resvg (`@resvg/resvg-wasm`) and bundled Inter Regular and Bold (OFL, credited in `third-party-licenses.txt`). The map is the district outlines within 1.5 km, from the new `district_outlines()` (migration 22, service role only). The event's own district is tinted in the category colour, with its name and "© OpenStreetMap" in the corner. Without districts the map is plain.
- **Version.** The image URL carries `?v=`, a 12-character hash of what's drawn (title, time, venue, category, point, language), so the image is cached at the edge for a week and an edited event gets a new one. The link tags now use `summary_large_image`.
- **Budget.** The Worker is 1.65 MB gzipped (was 0.37), under the 3 MB limit, so no second Worker is needed.
- **CPU.** A render takes about 60 ms of CPU. On the Workers Free plan's 10 ms some first renders will fail; the link then previews without the picture (`docs/HARDENING.md`).
- **Migration.** Needs migration 22 on the live database; until then the map is plain.

## 3. Sharing (slice C)

- **Share** on the event card sends the clean link (`/e/<id>`) plus a short text: title · day and time · venue. Without a share sheet, it copies the link.
- **Share as image.** The preview card as a PNG through the Web Share API (for Instagram Stories and similar), with the link in the text. Shown only where the browser can share files.
- **QR code** on the card ("Show QR code"): the event's link, drawn on the device, big enough to scan from a poster. Useful for organisers' flyers; no server call.
- **In-app route first.** On the event card and in GoThere, "Going there" (the in-app walking route) is the main button; the Google Maps hand-off becomes a secondary link.
- **Tests.** Share data (link and text), the copy fallback, the QR code encoding the clean link, button order.

**Built (slice C).**

- **Share sheet.** "Share" on the card opens a small sheet (`ShareSheet.tsx`): **Send link** (the share sheet with title · day and time · venue, or a copy where there is none), **Share as image** (only where the browser can share files), **Copy link**, and the QR code below them, always visible. Three more buttons in the card's tool row didn't fit at 380 px, so they live in this sheet.
- **QR code.** Drawn on the device with `qrcode-generator` (MIT, medium error correction), white on any theme so it scans from a dark screen.
- **Clean links.** Links are now `/e/<id>`, in the calendar file too.
- **Route first.** On the event card and the list cards, "Route in Happow" is the main button and Google Maps the plain one next to it. In GoThere the Maps hand-off is no longer the main button.

## 4. Links that outlive the event (slice D)

- An ended event's link still opens its card, marked **Ended**, with what's on **now** near that place (the same reach rules as the map, a few events, nearest first). An old share always leads somewhere live.
- The preview tags of an ended event say "Ended" in the description; the image is kept.
- An event removed by moderation (hidden) opens as "not found", never with its old details.
- **Tests.** An ended event's card and its "now nearby" list; a hidden one.

## 5. "I'm going" and link-scoped counts (slice E)

- **"I'm going"** on the event card, one tap, again to undo. Anonymous, one per device and event (a salted device token, as for submissions). No account needed.
- **Counts on the card** appear only from **5 people**, in buckets (5+, 10+, 25+), and never for sensitive categories (§6). Below 5, nothing is shown: no "be the first", no fake urgency.
- **Link-scoped count for the sharer.** Each share carries a random share token in the link (`/e/<id>?s=<token>`). The sharer's device keeps its tokens; the card then says "3 people from your link are going", with no names and no threshold (it's the sharer's own link). Recipients who tap "I'm going" are counted against the token they arrived with.
- **Names** only with M11: when both people are signed in and the recipient chooses to show theirs. M9 shows counts only (see §9.3).
- **Storage.** One row per device and event (`going`), with the share token if any; removed when the event ends plus a day. The device token is hashed with `SUBMITTER_SALT`, as elsewhere.
- **Tests.** Going and undoing; counts from 5 in buckets; the sharer's count from the token; one per device; sensitive categories show nothing.

## 6. Co-presence (slice F; M6 §9)

- Per event, from app signals only:
  - **looking:** opened the card in the last 30 minutes;
  - **on the way:** started GoThere;
  - **here:** an explicit ✓, offered when GoThere arrives (40 m) or on the card within about 100 m of a live event.
- **Buckets and threshold** as for "I'm going": 5+, 10+, 25+, nothing below 5. Each signal lives until the event ends.
- **Dedup** with the same salted device token.
- **Off for sensitive categories:** religious (config) and any category later marked political-demonstration. A category flag in config (`publicAttendance: false`), so it isn't hard-coded; GDPR Art. 9 inference is the reason.
- **The flag switches off only the public counts.** It doesn't stop people marking themselves, so M11's private mode can later show friends who's going (below). M9 still stores the signals for these categories but never shows a count.
- **Friends' view (M11, owner 2026-10-30).** With M11's contacts, someone can switch to a private view that shows which of their **friends** (people they invited or who invited them) are going, looking or there, by name, so real acquaintances can check who goes without another app. Both sides opt in; it works for every category, sensitive ones included, because it shows a person to people they already know, never to strangers. Built in M11, not M9; M9 keeps the data model ready for it (one row per device, linkable to an account when signed in).
- **Separate from M12's counts.** "Your impact" totals (opens, routes, arrivals) stay as they are: daily, per event, for the adder only. Co-presence is live and public, so it is its own short-lived table.
- **Tests.** Each signal and its window; the threshold and buckets; a religious event showing nothing; dedup per device.

## 7. Opening in the app (slice G)

- **Android:** an installed Happow (WebAPK) captures links in its scope, so tapping a shared link opens the app. Check the manifest's `scope` and `start_url` cover `/e/`, and add `handle_links: "preferred"` where supported.
- **iOS:** Home Screen web apps can't capture links, so the link opens in Safari, where the whole app works without installing. Show a one-line "Add to Home Screen" hint on a shared card, once, dismissible, never again after that.
- Either way the recipient needs no account and no install.
- **Tests.** The manifest fields; the hint shown once on iOS Safari and never in the installed app.

## 8. Free and paid after M9

| Feature                                            | No account | Free account | Premium |
| -------------------------------------------------- | ---------- | ------------ | ------- |
| Clean links with previews, share as image, QR code | ✓          | ✓            | ✓       |
| "I'm going", co-presence, the sharer's link count  | ✓          | ✓            | ✓       |
| Names on link counts (with M11)                    |            | ✓            | ✓       |

Paid never changes where or how an event shows.

## 9. Questions for the owner (answered 2026-10-30)

Answers: 1 (a), the map drawn from the district outlines; 2 keep 5; 3 counts only until M11; 4 the flag only on `religious` for now, and it switches off public counts only, so M11 can add the friends' view (§6).

1. **The map on the preview image.** The app's map tiles (OpenFreeMap) are vector tiles that a Worker can't draw into a picture cheaply. Options:
   - **(a) Recommended:** draw a simple map from data we already have: the district outlines (slice A of M12), the river and main streets left out, the pin in the middle, in the app's colours. No tile requests, nothing to license beyond the OSM attribution already shown.
   - **(b)** A real map picture from a static-map service: closer to the app, but a paid or rate-limited provider and a key in config.
2. **The threshold of 5** for public counts (from M6 §9 and the brief). Keep 5, or another number?
3. **Names on link counts** wait for M11 (accounts on both sides, the recipient's choice). OK to ship M9 with counts only?
4. **Political demonstrations** have no category today. Add the `publicAttendance: false` flag only to `religious` for now, and to a protest category if one is ever added?
