# Milestone 6 — Design system and map UX: spec

Oct 22, 2026

Spec agreed with the owner in the design session of 2026-10-22 (interactive prototypes v1–v3 in that session). Build it in the usual way: plan, show the plan, build, then replace the "Status" line below with the report (built, skipped, open issues) like M1–M4.

**Status:** in progress: §14 built (slice A); the rest not built. List style B (§5) is provisional until the owner reviews it on the working app. Also includes the Week and Later windows (§13) and the default-venue fix for single-venue sources (§14), both added 2026-10-22.

## Supersedes in the brief

Where this spec and `docs/BRIEF.md` → Core features differ, this spec wins:

- Time-window chips (Now / 2 h / 6 h / Today) → a time scrubber with Today / Week / Later range icons (§5, §13). `defaultTimeWindow` becomes "now".
- Radius slider 100 m–25 km in the bottom panel → vertical rail capped at 5 km, city scale via pinch (§5).
- Map/List segmented control → one list button and an overlay list (§5).
- Category colours and emoji pins → one live hue, time-encoded pins, monochrome glyphs (§3, §4).
- Edge chevron pills with text → edge dots (§5).
- Bottom summary sentence, brand pill and language chip leave the map screen (§5).

## 1. Principles

- The map is the interface. Colour means "on now". Numbers are the language.
- Wordless chrome, worded content. Numerals and SI units (16:30, 6 min, 2 km) carry information; event titles and venues stay as text. `aria-label`s stay translated (PL/EN).
- Teach by motion, not text: on first launch the rail nudges up and back once.
- Pull, not push. Optimise for opens per week, time to first pin tap (< 3 s), GoThere starts and arrivals; not session length. No streaks.
- Nothing animates at idle.

## 2. Baseline being replaced (repo at 6e3cbbb)

- Palette is the Tailwind defaults: slate 50/500/900, orange-500 accent, green-600 for "now", blue-600 for locate.
  - Orange carries about seven unrelated jobs.
  - "Now" is green on pills and category-coloured on pins.
  - White on `#f97316` is 2.8:1, below the 3:1 non-text minimum.
- Pins use 14 category colours plus OS emoji on a grey Positron basemap.
- Chrome takes about a third of an 844 px viewport: ~116 px at the top plus ~185 px in the bottom panel.
- `defaultTimeWindow: "today"` contradicts the product name.

## 3. Colour

### 3.1 Themes

Auto by real sunrise/sunset at the user's coordinates (`suncalc`, local maths, no API); manual override in settings.

| Token               | Day                    | Night                                        |
| ------------------- | ---------------------- | -------------------------------------------- |
| Land / background   | `#F1ECE2` (under veil) | `#000000`, absolute black (OLED pixels off)  |
| Major roads         | `#FFFFFF`              | `#2E3647` lit, dimmed by the veil when unlit |
| Minor roads         | `#E3DACA`              | `#1C2230` lit                                |
| Water               | `#A8CBDF`              | black when unlit, `#123049` lit              |
| Parks               | `#CDE2B4`              | black when unlit, `#173622` lit              |
| Veil                | `#E6E6E4` at 0.74      | `#000000` at ~0.75                           |
| Ink (text, glyphs)  | `#17171A`              | `#ECE9E3` (not pure white: halation)         |
| Muted               | `#86807A`              | `#80838B`                                    |
| Paper (cards, pins) | `#FBFAF7`              | `#1A1D23`                                    |

Night intent: streets on a switched-off OLED phone. Outside lit areas only street geometry is visible. If panning shows OLED black smear on test devices, raise the background to ~`#050505`; the power cost is negligible.

### 3.2 Live hue: one hue, one meaning

- The live hue is reserved for "on now"; errors never use it.
- Tokens: `--live` and `--on-live` (the glyph colour on a live pin).
- On the map, pins use SDF sprites so the hue is a paint property (`icon-color`), not a sprite rebuild.
- Live is also encoded by shape (filled vs outline), so colour is never the only carrier.

| Preset                      | Day       | Night     | White glyph D / N | vs day land | vs black | Δhue to water (202°) | Who gets it              |
| --------------------------- | --------- | --------- | ----------------- | ----------- | -------- | -------------------- | ------------------------ |
| Violet (default)            | `#6A4CF5` | `#8C74FF` | 5.30 / 3.47       | 4.50        | 6.06     | 49°                  | everyone                 |
| Tally red                   | `#EE2E4E` | `#FF4766` | 4.09 / 3.31       | 3.47        | 6.35     | 148°                 | logged-in users          |
| Magenta                     | `#C8177A` | `#FF4FA8` | 5.44 / 3.03       | 4.62        | 6.94     | 125°                 | premium                  |
| Mono (e-ink, high contrast) | ink fill  | ink fill  | ≥ 15              | —           | —        | —                    | everyone (accessibility) |

- Any new preset must meet all of these in both themes:
  - white (or declared `--on-live`) glyph ≥ 3:1 (WCAG 1.4.11)
  - ≥ 3:1 against day land
  - ≥ 40° hue distance from park green (87°) and water blue (202°)
- Rejected candidates:
  - blue: 21° from water
  - teal: 29° from water
  - orange and amber: white glyph below 3:1
- Greyscale e-ink reduces colour to luminance, so violet (L 0.148) renders darker than red (L 0.207): 4.5:1 vs 3.5:1 against the day land. Mono is the proper e-ink preset.
- Mono is set manually: `@media (update: slow)` and `monochrome` are not reliable on Android e-ink devices.

## 4. Pins

### 4.1 Encoding

| State                | Size  | Look                                              |
| -------------------- | ----- | ------------------------------------------------- |
| On now               | 34 px | filled live hue, white glyph, remaining-time ring |
| Starts within 60 min | 26 px | paper fill, ink glyph, live-hue outline           |
| Later                | 10 px | muted dot, no glyph                               |
| Outside reach        | ×0.85 | opacity × 0.5                                     |
| Selected             | ×1.2  | full opacity, on top                              |

- **Ring = absolute time left.** Full at ≥ 120 min, linear below, with an 8 % minimum stub until the event ends.
- **Dotted full ring = no fixed end** (`end_estimated`, "till late").
- **Updates** run on the existing minute clock.

### 4.2 Entry model

Add `entry: 'fixed' | 'open'` and `graceMin` to the event model. Category defaults go in `config/categories.json`, next to `defaultDurationMin`.

| Entry | Default categories                                         | Dashed when                                           |
| ----- | ---------------------------------------------------------- | ----------------------------------------------------- |
| fixed | theatre, cinema, talk, sport, seated concert               | arrival > start + grace; the card shows "+N min"      |
| open  | club, garage sale, market, exhibition, festival, happening | arrival ≥ end − 5 min (closed before you'd get there) |

- **Open events** are never dimmed while open.
- **Arrival** = now + walk minutes. In the PoC: straight-line distance × 1.3 ÷ 80 m/min; routed later.
- **Per-event override** comes from:
  - extraction: schema.org `doorTime` vs `startDate`, plus one extra field in the Claude extractor schema
  - a toggle in the add-event form
- **Music needs the per-event value**: a concert is fixed, a club night is open.

### 4.3 Rendering

- Replace the per-event DOM `maplibregl.Marker`s with one GeoJSON symbol layer.
- **Sprite.** An SDF glyph set (one consistent line-icon set, no emoji) plus 12 ring states (10-min steps on the 2 h scale).
- **Collision priority.** `symbol-sort-key` ranks live above soon above later, so live pins win collisions.
- **Why this is required.** The rail↔zoom coupling makes every rail drag a continuous zoom, and area snapshots allow up to 1,000 events.

### 4.4 Age limits and family mode

Added 2026-10-22: age restrictions visible on events, and a child-friendly filter for families.

- **Data.** Replace the free-text `rules.age` with two fields:
  - `ageMin: number | null`: 0 means explicitly all ages, 18 means 18+.
  - `family: boolean | null`: explicitly meant for children or families.
- **Where the values come from:**
  - Ticketmaster: `ageRestrictions.legalAgeEnforced` → `ageMin: 18` (today it becomes the text "18+").
  - schema.org: `typicalAgeRange` ("18-", "7-12") and `audience.suggestedMinAge` → `ageMin`; an upper bound of 12 or less → `family: true`.
  - Claude extractor: two more fields in its schema, prompted with Polish cues such as "od 18 lat", "18+", "wstęp od 16 lat", "dla dzieci", "rodzinny", "0+".
  - Category `kids` → `family: true`.
  - Add-event form: an age choice (none / 0+ / 12+ / 16+ / 18+) and a family toggle.
- **Markings** (always shown, not only in family mode):
  - Pins with `ageMin ≥ 16` carry a small numeral badge ("18+") at the upper right. Numerals only, so it needs no translation.
  - The card shows the age badge next to the time, and a family glyph for family events.
- **Family mode** (a filter, remembered per device):
  - **Shows:** `family: true`, the kids category, and `ageMin ≤ 12` (including 0+).
  - **Also shows, marked "not confirmed":** events with no age information in categories marked `family: "likely"` (today: market, garage sale, festival, exhibition, food, sport) that end by 21:00 local time.
  - **Hides:** `ageMin ≥ 13`, events starting after 21:00, and categories marked `family: "no"` (none today; a club or nightlife category when one is added).
  - **Config:** the rules live in `config/categories.json` (`family: "yes" | "likely" | "no"`) and `config/app.json` (`family.latestEnd`), so they change without code.
  - The live counter, dice, hotspot and edge dots all respect it.
- **Privacy.** Family mode is a setting on the device; nothing about the user's children is sent or stored.
- **Tier.** Free for everyone, no account needed.

## 5. Layout and controls (portrait)

- **Top-left: live counter `● N`.** It counts live, reachable, non-dashed events. Tapping it toggles live-only; the counter fills while the filter is on.
- **Top-right:** dice, filters.
- **Family mode chip.** Switched on in filters; while on, a small family glyph sits beside the live counter, and tapping it turns family mode off (§4.4).
- **Right rail (radius):**
  - Placement:
    - inset ~20 px from the screen edge (Android's back gesture fires from both edges, and the web has no gesture-exclusion API)
    - lower-middle, in the thumb zone
  - Look: 2 px track, no background, 28 px thumb, value pill beside it.
  - Detents 100 / 250 / 500 / 1000 / 2000 / 5000 m on a log scale. The label shows walking minutes up to 2 km, then km.
  - Haptics: `navigator.vibrate(6)` per detent on Android. iOS Safari has no Vibration API, so the snap is visual there.
  - Radius↔zoom coupling: the reach stays the same size on screen and the map scales.
  - The rail caps at 5 km; beyond that is city mode via pinch.
- **Below the rail:**
  - Locate: resets reach to 500 m and time to now.
  - List button (style B, provisional): a single icon showing the other mode. The list opens as an overlay panel over the map, and tapping a row returns to the map with that pin selected.
- **Bottom: time scrubber.**
  - Range: now → end of the selected range. The Today / Week / Later icons sit at its left end (§13).
  - Marks: hour ticks (numerals only) and a 30-min density histogram in the track.
  - Snapping: to now within 10 min; otherwise 5-min steps.
- **Default state = now.** Live events plus those starting within 60 min; later ones as 10 px dots.
- **Long-press the map = plan from here.** It sets a virtual centre; reach and walking minutes recompute from there, and ⌖ returns to you.
- **Off-screen events:** 10 px dots clamped to the screen edge, in the live hue when live.
- **Removed from the map screen:**
  - the brand pill (moves to About)
  - the language chip (auto from `navigator.language`, switch in settings)
  - the summary sentence
  - the radius label and scale
  - the Map/List segmented control
  - the time-window chips

## 6. Lit map (explored areas)

- **Mechanism.** A full-colour basemap with a veil on top that has soft holes. MapLibre cannot desaturate part of a vector map (`raster-saturation` is raster-only).
- **The veil is a MapLibre `canvas` source** covering the area snapshot.
  - It is redrawn only when something changes (a new arrival, a rail detent released); the GPU handles pan and zoom.
  - Low canvas resolution plus upscaling gives the diffused edge.
  - Each lit spot is several jittered blobs seeded by its H3 cell id, so the clouds are organic and stable between redraws.
- **Zoom fade.** `raster-opacity` is interpolated on zoom: the veil fades as you zoom out and is gone at city scale, so remote areas stay fully visible.
- **What lights up:**
  - the current reach: always
  - confirmed arrivals: strong
  - cells where the app was opened: faint
  - repeat visits brighten
  - nothing decays
- **Storage.** Local only by default: IndexedDB records `{h3 res 9 cell, count, lastSeen}`, roughly tens of KB per year of heavy use. Free JSON export and import.

## 7. Dice

- Respects active filters and live-only.
- No repeats within a session.
- Each re-roll down-weights that category locally; opens and arrivals up-weight it. All on the device.
- Long-press opens a fan of the user's top categories for a narrowed roll.

## 8. Accounts and premium (design now, build later)

Consistent with the brief's monetization rules: every event is always shown to everyone, and map, filters and details stay free.

| Tier             | Gets                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Anonymous        | the full app, family mode and age markings, local atlas, Violet and Mono presets                                          |
| Logged in (free) | settings page, Tally red preset, atlas export and import                                                                  |
| Premium          | end-to-end-encrypted atlas sync and backup across devices and phone upgrades, extended hue presets (Magenta, future ones) |

Atlas sync design:

- **Accounts.** Supabase Auth: the magic-link flow in `apps/web/src/auth.ts` exists for moderators. Extend it to users, with user sessions in `localStorage`.
- **End-to-end encryption.**
  - A random 256-bit data key encrypts the atlas (AES-GCM, WebCrypto).
  - The key is wrapped once per passkey with the WebAuthn PRF extension output, and once with a printable recovery code.
  - The server stores ciphertext only, so location history never sits in plaintext in the database.
- **PRF support** (Corbado matrix, Aug 2026):
  - Android: Google Password Manager passkeys.
  - iOS/iPadOS: 18.4+ (18.0–18.3 had data-loss bugs).
  - macOS: Safari 18+, Chrome 132+.
  - Windows 11: after the Feb 2026 update.
  - The recovery code covers platform switches (iPhone → Android).
- **Merge.**
  - Each device uploads its own encrypted blob of per-cell counts.
  - Clients download all blobs and merge locally (per-device grow-only counters, summed), so there are no conflicts.
  - Row-level security per user.
- **Deferred:** pricing and the payment provider.

## 9. Co-presence (after the core)

- Per event, from app signals only:
  - **looking:** opened the card in the last 30 min
  - **on the way:** started GoThere
  - **here:** an explicit ✓, offered on GoThere arrival (40 m) or in the card within ~100 m of a live event
- Counts appear in buckets (5+, 10+, 25+) and only from 5. TTL = event end. A per-device salted token (`SUBMITTER_SALT`) deduplicates.
- Disabled for the religious category and any political-demonstration category (GDPR Art. 9 special-category inference).
- Google's Popular Times is not an option: it is venue-level and not exposed by the official Places API.

## 10. Performance budget

- **API: zero additional requests.**
  - The rail, scrubber, filters and live-only all run on the existing 5-min area snapshot (`AreaEventRepository`).
  - Presence counts piggyback on the snapshot.
- **Battery:**
  - GPS policy unchanged (5 min / 100 m).
  - No infinite animations: the "new since last open" bloom plays once, and springs run only while a finger is down.
  - `prefers-reduced-motion` is respected.
  - At night on OLED, true black pixels are off.

## 11. Acceptance

- 5-second test: someone who has never seen the app says what's on nearby without reading.
- The §3.2 contrast table holds for every shipped preset.
- 60 fps rail drag with 500 events in the snapshot on a mid-range Android phone.
- Time to first pin tap < 3 s from a cold open.
- Week and Later: switching costs at most one request per 30 minutes, and in the week of the DST change (25 Oct 2026) every day still starts and ends at local midnight.
- NFM: a crawl no longer rejects events for "no location" when the page simply omits the hall's address.

## 12. Open

- List style B: owner review on the working app.
- Premium pricing and payment provider.
- Co-presence timing (after the core).
- Later window length (14 days) to confirm in use.

## 13. Week and Later windows

Added 2026-10-22, so the map is useful for planning and fills up while few events are on right now. The database already holds crawled events up to 60 days ahead; the app only asks for 24 hours.

### 13.1 Windows

- **Today** is now → end of today. **Week** is today plus the next 6 days. **Later** is today plus the next 13 days.
- They count calendar days in the region's time zone, and each includes everything sooner (as Today includes now).
- Lengths live in config: `timeWindows` gains `{ "id": "week", "days": 7 }` and `{ "id": "later", "days": 14 }`, so "later" changes without code.
- Days are stepped by the calendar, not in 24-hour blocks: daylight saving ends on 25 Oct 2026, and tests cover that week.

### 13.2 Icons

- Calendar line icons, 24 px, same stroke as the glyph set:
  - **Today:** one filled day square.
  - **Week:** one filled row.
  - **Later:** two filled rows.
- Three icon buttons (36 px touch area) at the left end of the time scrubber; the active one is ink-filled. Translated `aria-label`s: "Dziś / Today", "7 dni / 7 days", "14 dni / 14 days".

### 13.3 The scrubber per range

- **Today:** hours, as in §5.
- **Week and Later:** day ticks (date numerals only) and a per-day density histogram in the track.
  - By default the map shows the whole range.
  - Dragging selects one day: that day's events get the 26 px glyph pins and the other days are hidden.
  - Snapping is per day; tapping the "now" anchor returns to now.

### 13.4 Data

- **Ingest.** API sources (Ticketmaster, Meetup) fetch 15 days ahead: `ingest.lookaheadHours` 48 → 360. M7 raises it to 60 days.
- **Area endpoint.** `/api/area` takes a range parameter limited to the configured windows: 24 h by default, 7 or 14 days.
  - The longer snapshot is fetched only when Week or Later is selected.
  - It is cached for 30 minutes (`refresh.longCacheMinutes`), since future events change slowly.
  - The 24-hour snapshot stays as it is, so everyday use costs nothing extra.
- **Cap.** The 1,000-nearest-events cap per snapshot stays. Target payload < 100 KB gzipped.

### 13.5 Display

- **Dates.** Cards and the list show the date for future days ("sob 25.10, 19:00" / "Sat 25.10, 19:00"), and the list gets day headers.
- **Pins.** Future-day pins use the "later" style from §4.1 (10 px dots) until a day is selected.
- **What follows the range:** the hotspot, edge dots and dice use the selected range. The live counter always counts what is on right now.

## 14. Default venue for single-venue sources

Found on 2026-10-22: the NFM crawl found 50 events and added 20, sent 1 to moderation and rejected 29 for "no location". NFM's event pages assume their own building and print no address, so the extractor returns none.

- **Config.** A per-source `defaultVenue` in `config/sources.json`, with the address in the geocoder's fields so its postcode check applies. For NFM: `{ "name": "Narodowe Forum Muzyki", "street": "plac Wolności 1", "postalCode": "50-071", "city": "Wrocław", "aliases": ["NFM"] }`.
- **When it applies.**
  - Extraction yields no venue, address or coordinates. A city alone counts as no location: it is the region itself.
  - Or the page names only one of the building's own halls, recognised by the name or an alias as a whole word ("NFM, Sala Czerwona"). The hall keeps its name, which people in the city know, and gets the building's address. (Owner decision, 2026-10-22.)
  - A page that names another venue, or gives a street, postcode or coordinates, keeps it.
- **Geocoding.** The default venue is geocoded once through the existing geocoder and cached. No coordinates are hard-coded.
- **Reuse.** Any single-venue source (a theatre, club or cinema) can set it.
- **Tests.**
  - A fixture page without an address lands at the default venue.
  - A page naming one of the building's halls keeps the hall's name at the building's address.
  - A page naming another venue keeps that venue.
- **Expected gain.** About 30 more NFM events per crawl.
- **Built** (2026-10-22): `packages/ingest/src/run.ts` (`atDefaultVenue`, applied before geocoding for any adapter), schema in `packages/core/src/schemas.ts`, contract test in `packages/ingest/test/crawler.contract.test.ts`. Open: NFM also runs concerts in other buildings (Oratorium Marianum, Aula Leopoldina). Those pages name the other venue and keep it, unless the extractor writes them as "NFM, …"; check this on the next live crawl.
