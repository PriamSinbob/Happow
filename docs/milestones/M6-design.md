# Milestone 6 — Design system and map UX: spec

Oct 22, 2026

Spec agreed with the owner in the design session of 2026-10-22 (interactive prototypes v1–v3 in that session). Build it in the usual way: plan, show the plan, build, then replace the "Status" line below with the report (built, skipped, open issues) like M1–M4.

**Status:** in progress: §14 built (slice A), §13 data built (slice B), §4.2 and §4.4 data built (slice C), §3 built (slice D), §4.1 and §4.3 built (slice E); the rest not built. List style B (§5) is provisional until the owner reviews it on the working app. Also includes the Week and Later windows (§13) and the default-venue fix for single-venue sources (§14), both added 2026-10-22.

**Visual reference:** `docs/design/` (interactive prototype, exact range icons, README listing what is normative). Slices E to H match it; where this spec's words and the prototype differ, ask the owner.

## Build plan

Agreed with the owner on 2026-10-22. M6 ships as slices, one branch and one PR to `main` each. The data-only slices come first, so the live app keeps working between PRs; the visuals build on them. Each slice PR updates its row below, the Status line above, and adds a short "Built (slice X)" note under its spec section (built, skipped, open), like §13.4 and §14.

| Slice | Spec                    | What                                                     | Needs | Status                                   |
| ----- | ----------------------- | -------------------------------------------------------- | ----- | ---------------------------------------- |
| A     | §14                     | Default venue for single-venue sources                   | —     | merged (#9)                              |
| B     | §13.1, §13.4            | Week/Later windows, `/api/area?range`, 15-day ingest     | —     | merged (#10)                             |
| C     | §4.2, §4.4 data         | Entry and grace, `ageMin` and `family` in the event data | —     | merged (#12)                             |
| D     | §3                      | Colour tokens, day/night themes, presets, contrast test  | —     | merged (#13)                             |
| E     | §4.1, §4.3              | Pins on one symbol layer: SDF glyphs, rings, age badge   | C, D  | merged (#14)                             |
| F     | §5, §13.2, §13.3, §13.5 | Map-screen layout: counter, rail, scrubber, list overlay | B, E  | in progress (`m6-layout`)                |
| G     | §4.4 UI, §7             | Family-mode filter and chip; dice                        | C, F  |                                          |
| H     | §6                      | Lit map and the local atlas                              | F     |                                          |
| —     | §8, §9                  | Accounts and premium; co-presence                        | —     | out of M6 (build later / after the core) |

### Slice C: entry and age data

Data, ingest, API and the add-event form only. No pin or map visuals: those are E and F.

- **Event model.**
  - Add `entry: 'fixed' | 'open'` and `graceMin` (§4.2).
  - Replace the free-text `rules.age` with `ageMin: number | null` (0 = explicitly all ages, 18 = 18+) and `family: boolean | null` (§4.4).
  - `rules.age` is used today in:
    - the schemas in `packages/core/src/schemas.ts` and `packages/ingest/src/types.ts`
    - the Ticketmaster adapter (`legalAgeEnforced` becomes the text "18+")
    - `packages/ingest/test/dedup.test.ts`
    - `RuleList` in `apps/web/src/components/EventCard.tsx` and `EventDetail.tsx`
  - The card and detail views keep showing age, now rendered from `ageMin` ("18+") and `family`, translated (PL/EN).
- **Category defaults** in `config/categories.json`, next to `defaultDurationMin`, validated in `packages/core/src/config.ts`:
  - `entry` and `graceMin`.
    - fixed: theatre, cinema, talk, sport
    - open: garage-sale, market, exhibition, festival, happening
    - Music needs the per-event value: a concert is fixed, a club night is open.
  - `family: "yes" | "likely" | "no"`.
    - yes: kids
    - likely: market, garage-sale, festival, exhibition, food, sport
    - no: none today
  - `config/app.json` gets `family.latestEnd` (21:00, in the region's time zone).
- **Sources of the values** (each change gets a contract test on recorded fixtures):
  - Ticketmaster: `legalAgeEnforced` gives `ageMin: 18`. Its fixture `packages/ingest/test/fixtures/ticketmaster/page-0.json` has the field.
  - schema.org (`packages/extract/src/schemaorg.ts`):
    - `typicalAgeRange` ("18-", "7-12") and `audience.suggestedMinAge` give `ageMin`.
    - An upper bound of 12 or less gives `family: true`.
    - `doorTime` vs `startDate` gives the entry type.
  - Claude extractor (`packages/extract/src/llm.ts`, `types.ts`):
    - `ageMin`, `family` and entry fields in its tool schema.
    - The prompt uses Polish cues: "od 18 lat", "18+", "wstęp od 16 lat", "dla dzieci", "rodzinny", "0+".
  - Category `kids` gives `family: true`.
- **Add-event form** (`apps/web/src/components/AddEvent.tsx`, the `submit` handler in `packages/api/src/handler.ts`, and the `submit_event` SQL function):
  - an age choice: none / 0+ / 12+ / 16+ / 18+
  - a family toggle
  - a fixed/open entry toggle
- **Database.** A new migration in `supabase/migrations/`.
  - Columns or `rules` jsonb: decide in the plan. Family mode filters client-side on the area snapshot, so `events_area` must return the fields.
  - Existing `rules.age` text ("16+", "18+") moves into `ageMin`.
  - Update every SQL function that returns or writes events: `events_area`, `events_near`, the ingest upsert, `submit_event`.
  - The PR notes that the migration must be applied to Supabase on deploy.
- **Core helpers** for slices E and G, unit-tested, with no UI:
  - Arrival time: now plus walking minutes (straight line × 1.3 ÷ 80 m/min).
  - Late:
    - fixed: arrival > start + grace
    - open: arrival ≥ end − 5 min
  - Family match: shows, "not confirmed" or hides, as in §4.4.

### Slice D: colour and themes

Plan agreed with the owner on 2026-10-22 (pure black night land; settings on the About screen for now). Branch `m6-colour`, pushed after each step so a later session (cloud or local) can pick it up from the last commit.

- **Scope.** §3: colour tokens, day/night themes, hue presets, contrast test. The app chrome and the basemap change colour; pins keep their current look until slice E, the veil and lit/unlit areas wait for slice H.
- **Config, no colours in code** (new `config/theme.json`, validated in `packages/core/src/config.ts`):
  - `themes.day` / `themes.night`: the §3.1 tokens (land, majorRoad, minorRoad, water, park, ink, muted, paper, veil), plus the few chrome tokens the app needs (line, error, error-ink, focus).
  - `presets`: violet, red (tally), magenta, mono, each with `day`, `night`, `onLive` and `tier` (`anonymous` / `account` / `premium`). Only `anonymous` presets (violet, mono) are selectable until accounts exist (§8).
  - `config/map.json` gets `themeLayers`: basemap layer id → token (`background` → land, `water`/`waterway` → water, `park`/`landcover_wood` → park, `highway_major_*`/`highway_motorway_*` → majorRoad, `highway_minor`/`highway_path` → minorRoad, labels → ink/muted with a land-coloured halo). Layers not listed keep the Positron colours.
- **Until slice H the whole map counts as "lit"**: night uses the lit values (land black, roads `#2E3647` / `#1C2230`, water `#123049`, parks `#173622`). The veil and the black unlit areas come with the lit map.
- **Core** (`packages/core/src/colour.ts`, unit-tested, no DOM):
  - WCAG contrast ratio, relative luminance, hue in degrees, hue distance.
  - `checkPreset(preset, themes)`: the §3.2 rules (glyph ≥ 3:1 in both themes, ≥ 3:1 against day land, ≥ 40° from park green and water blue), returning the failures.
  - `themeAt(now, point, setting)`: 'day' or 'night' from sunrise/sunset at the user's position (`suncalc`, local maths, no API), or the manual override. No position yet → the region centre.
- **Contrast test.** A core test runs `checkPreset` on every preset in `config/theme.json`, and fails CI when a preset breaks a rule. It also checks text tokens: ink and muted on paper and on land, both themes (ink ≥ 4.5:1, muted ≥ 3:1).
- **Web.**
  - `apps/web/src/theme.ts`: writes the active theme and preset to CSS custom properties on `:root` (`--land`, `--paper`, `--ink`, `--muted`, `--live`, `--on-live`, …), sets `color-scheme` and the `theme-color` meta, and re-checks day/night on the existing minute clock.
  - `styles.css`: the Tailwind slate/orange values are replaced by the tokens. "Now" pills and running highlights use `--live`; buttons, focus rings, the radius circle and the locate control use ink (orange's seven jobs go away); errors keep a red that is not the live hue. About 60 hard-coded colours to move onto tokens.
  - `MapView`: recolours the Positron style through `themeLayers` with `setPaintProperty` on load and on every theme change (no style reload, no flash). The radius circle uses ink instead of orange.
  - Settings: an "Wygląd / Appearance" section on the About screen (the settings page comes with accounts, §8): theme Auto / Dzień / Noc (Auto / Day / Night) and colour Fiolet / Mono (Violet / Mono). Remembered per device. PL and EN strings.
  - The night theme gets the black land (`#000000`); `#050505` stays a config change if OLED smear shows on test devices.
- **Out of scope:** pin glyphs, rings and sizes (E), the map-screen layout (F), the veil and lit areas (H), account-gated presets (§8).
- **Steps and pushes:** (1) this plan; (2) config + core helpers + contrast test; (3) CSS tokens and day theme in the chrome; (4) night theme, auto switching and settings; (5) basemap recolour; (6) spec Status and "Built (slice D)" note under §3.

### Slice E: pins on one symbol layer

Plan agreed with the owner on 2026-10-22 (glyphs drawn in code for now; a designed set may replace them). Branch `m6-pins`, pushed after each step.

- **Scope.** §4.1 and §4.3, plus the age badge from §4.4. Event pins only: edge dots, rail, scrubber and list overlay are slice F; hotspot and outside-radius bubbles stay DOM markers until F.
- **One GeoJSON source + symbol layers** replace the per-event DOM `maplibregl.Marker`s in `MapView`:
  - a `pins` GeoJSON source rebuilt from the events on data change and on the minute clock (no per-frame work);
  - layers: ring (live only), pin body, glyph, count badge, age badge, all `symbol` layers with `symbol-sort-key` live > soon > later, so live pins win collisions;
  - taps via `queryRenderedFeatures` on the pin layers; selection by a feature-state / property, ×1.2 and on top.
- **Pin states** (core helper `pinState(event, now, arrival)`, unit-tested): `live` (34 px, filled live hue, `--on-live` glyph, ring), `soon` (starts within 60 min: 26 px, paper fill, ink glyph, live-hue outline), `later` (10 px muted dot, no glyph), `outside` (beyond the radius: ×0.85, opacity ×0.5), `late` (`isLate` from slice C: dashed outline). Multi-day ranges show future days as `later` dots.
- **Ring = time left.** 12 ring states in 10-minute steps on the 2 h scale (full at ≥ 120 min, 8 % minimum stub); a dotted full ring for `endEstimated` ("till late"). Core helper `ringStep(event, now)`.
- **Sprites, generated at runtime** (no binary assets in the repo): a small canvas builder in `apps/web/src/pinSprites.ts` draws SDF-style images and adds them with `map.addImage(id, img, { sdf: true })`, so colour stays a paint property (`icon-color` from the theme tokens; no rebuild on theme change):
  - pin body (filled disc, outlined disc, dashed outline), 12 ring arcs + dotted ring, small dot;
  - one consistent monochrome line glyph per category (14 glyphs, simple strokes drawn in code from config `icon` ids: the emoji icons in `config/categories.json` get a `glyph` id alongside; emoji stay for the list until F).
- **Age badge.** `ageMin ≥ 16` gets a small numeral badge ("18+") at the upper right: a text-field symbol on the pin, no translation needed.
- **Grouping.** Today's same-place grouping and zoom clustering move to a pure function feeding the GeoJSON (count badge kept); MapLibre's own collision then thins the rest by priority.
- **Tests.** Core: `pinState`, `ringStep`, sort keys. Web: the GeoJSON builder (features, properties, sort keys) on fixtures; sprite ids complete for every category.
- **Out of scope:** colours of the list and cards (F), family-mode filtering (G).
- **Steps and pushes:** (1) this plan; (2) core helpers + tests; (3) GeoJSON builder + tests; (4) sprites; (5) MapView switch to symbol layers, taps and selection; (6) spec report and PR.

### Slice F: map-screen layout

Plan agreed with the owner on 2026-10-23. Branch `m6-layout`. The top bar, window chips and bottom panel give way to the prototype's layout (`docs/design/prototype.html`).

- **Top-left: live counter `● N`** (§5). Live, inside the reach, not dashed. Tap toggles live-only; the counter fills while it is on. It always counts what is on now, whatever the range (§13.5).
- **Top-right: settings.** One icon button, no text (owner's call: tidy chrome). It opens the former filter sheet, renamed Ustawienia / Settings: a Filters segment first (categories, price), then rows below it for "Dodaj wydarzenie / Add event", the language switch and "O aplikacji / About" (theme and colour stay in About). The dice joins it in slice G.
- **Removed from the map screen:** brand pill, language chip, add button in the top bar, summary sentence, Now / 2 h / 6 h / Today chips, radius slider and scale, Map/List switch.
- **Right rail (reach).** 2 px track, 28 px thumb, value pill beside it; ~20 px from the edge, lower-middle. Detents 100 / 250 / 500 / 1000 / 2000 / 5000 m on a log scale; the pill shows walking minutes up to 2 km, then km; `vibrate(6)` per detent; snaps to the nearest detent on release. `role="slider"`, arrow keys step detents.
  - **Radius↔zoom coupling.** While dragging, the map zooms so the reach keeps its size on screen; events are re-filtered only when the detent changes.
  - **City mode via pinch** (owner: OK). Pinching out past the 5 km view sets a city reach (`radius.maxM`, the 25 km snapshot) and the pill shows "miasto / city"; dragging the rail returns to ≤ 5 km.
- **Below the rail:** locate (reach 500 m, time now, drops the "from here" point) and the list button (list icon on the map, map icon in the list).
- **Bottom: time line** (§5, §13.2, §13.3). Range icons from `docs/design/icons/range-*.svg` at its left end, 36 px touch area, active one ink-filled, tapping it again shows the whole range.
  - Today: now → midnight, hour ticks (numerals), 30-min histogram, snap to now within 10 min, else 5-min steps. Pins use `pinState(event, t)`.
  - 7 / 14 days: day ticks (date numerals), per-day histogram; whole range by default as 10 px dots; dragging selects a day, whose events get 26 px glyph pins and the other days hide.
  - Config: `timeWindows` becomes today / week / later; `defaultTimeWindow` "now" means Today at the current time. A saved now / 2h / 6h falls back to it. No extra requests: scrubbing filters the loaded snapshot.
- **List overlay (style B).** A panel over the map, rows as in the prototype; tapping a row returns to the map with that pin selected. Day headers and dated times for 7 / 14 days (§13.5).
- **Map.** Long-press = plan from here (a plain tap closes a card or picks a pin). Taps on pins get a hit tolerance, so 10 px dots are tappable.
- **Edge dots** replace chevrons: 10 px dots for off-screen events clamped to the screen edge, live hue when live; the 24 nearest only (owner: no need for every event beyond the circle; zoom out for that). Tap pans to the event.
- **Hotspot** stays a DOM marker; the outside-radius count bubbles go (faded outside pins and edge dots show what lies beyond the reach) (owner: OK).
- **Core helpers, unit-tested:** rail position ↔ metres and nearest detent, reach label, time-line snapping, histogram bins (30 min and per day, across the 25 Oct DST change), edge-dot clamping.
- **Out of scope:** family chip and dice (G), veil and lit areas (H).
- **Steps:** (1) this plan; (2) core helpers + tests; (3) config, filter state and the time line; (4) rail with zoom coupling, locate; (5) counter, settings sheet, list overlay; (6) long-press, pin hit tolerance and edge dots; (7) spec report and PR.

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post the slice plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and `npx prettier --check` on changed files. No live API calls in tests.
- On the owner's Windows checkout, many files show as modified with line-ending-only changes. Commit only files with real changes (`git diff --ignore-cr-at-eol`).

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

### 3.3 Built (slice D, 2026-10-22)

- **Config.** `config/theme.json`: the §3.1 tokens for day and night (plus chrome tokens paper2, line, scrim, warn/warnInk, error/errorInk) and the §3.2 presets with their tiers; `config/map.json` `themeLayers` maps Positron layers to tokens. Night land is pure black (owner's call).
- **Core** (`packages/core/src/colour.ts`): WCAG contrast, hue and hue distance, `checkPreset` (the §3.2 rules in both themes), `checkTokens` (ink ≥ 4.5:1 and muted ≥ 3:1 on paper and land; notice inks on their fills), `themeAt` (sunrise/sunset via `suncalc`, polar fallback by sun altitude), `themeLayerPaint`.
- **Contrast test** (`packages/core/test/colour.test.ts`): every preset and both themes; the spec's rejected candidates (blue, orange) fail; every `themeLayers` pattern matches the recorded Positron layer list (`test/fixtures/positron-layers.json`).
- **Web.**
  - `src/theme.tsx`: applies the theme before the first render (no flash), re-checks auto day/night on the minute clock at the user's position (region centre until located), remembers theme and preset per device. Sets `color-scheme`, `data-theme` and the `theme-color` meta; the PWA manifest colours come from the config.
  - `styles.css` holds no colour values any more (a test checks it): "on now" pills use `--live` / `--on-live`; buttons, focus, the radius circle, locate, chevrons and the user dot use ink; notices and flags use warn/error. MapLibre controls follow the theme.
  - `src/mapTheme.ts`: recolours the basemap and our own layers (radius, route) in place on style load and on every theme change, for the main map, "Going there" and the add-event pin map.
  - About → "Wygląd / Appearance": Auto / Dzień / Noc and Fiolet / Mono (Violet / Mono).
- Skipped: the veil and black unlit areas (slice H: until then the whole map uses the lit colours); account and premium presets are in the config and the contrast test but not selectable (§8); pins keep their category colours until slice E.
- Open: the raster fallback map (when OpenFreeMap is down) is not recoloured, so it stays light at night. Category tints on the list icons and chips are mixed onto the theme paper; they go with the glyph set in slice E. Check OLED smear on a real phone at night.

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
- **Built** (slice E, 2026-10-23): §4.1, §4.3 and the §4.4 age badge.
  - **Core** (`packages/core/src/pins.ts`): `pinState` (live / soon / later, outside, late from slice C, ring step, dotted for `endEstimated`, sort key) and `ringStep` (full at ≥ 120 min, 10-minute steps, a stub to the end).
  - **Sprites** (`apps/web/src/pinSprites.ts`): drawn in code as SDF images (TinySDF method), so colours are paint properties and day/night or presets never rebuild them: disc, outline, dashed outline, 12 ring steps, dotted ring, and 14 line glyphs (`glyph` per category in `config/categories.json`; owner's call to draw them for now).
  - **Layers** (`apps/web/src/pinLayers.ts`): one `pins` GeoJSON source and symbol layers for ring, disc, outline, glyph, count, flag mark and age badge. Sizes 34 / 26 / 10 px, outside ×0.85 at half opacity, selected ×1.2 on top. Only live pins use the live hue.
  - **Data** (`apps/web/src/pins.ts`): `pinFeatures` turns places and zoom clusters into features; a place shows its most urgent event, the count, the highest 16+/18+ badge and a "!" when a single event is flagged. Taps use `queryRenderedFeatures`.
  - Skipped: collision thinning. Pins overlap freely and the draw order (`symbol-sort-key`) puts live over soon over later; the existing 48 px zoom clustering keeps them apart. Hotspot, outside-radius bubbles, the pinned point and "Going there" keep DOM markers until slice F.
  - Open: pins are no longer focusable buttons, so screen-reader users reach events through the list (the list button stays on the map screen); a keyboard path on the map is for slice F. Glyphs may be replaced by a designed set. A "number but found null" console warning comes from the Positron style itself, not from these layers.

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
- **Built** (slice C, 2026-10-22): §4.2 and §4.4 data. No pin, badge or family-mode UI yet (slices E and G).
  - **Database.** Migration `20261022000008_entry_age.sql` adds four nullable columns: `entry` ('fixed' / 'open'), `grace_min`, `age_min` (0–21), `family`. Typed columns rather than `rules` jsonb, so Postgres checks the values (owner's call). `rules.age` moves into `age_min` ("16+" → 16, "all …" → 0; other text is dropped) and the key is removed. `events_public`, `events_near`, `event_by_id`, `events_area` and `publish_event` (used by `submit_event`) carry the fields. **Apply the migration to Supabase on deploy.**
  - **Defaults are applied when read, not stored** (owner's call): events keep only what their source said; `entryOf` in `packages/core/src/entry.ts` fills in the category's `entry` / `graceMin`. Category `kids` counts as family through its `family: "yes"`, not a stored flag.
  - **Config.** `config/categories.json`: `entry`, `graceMin` and `family` per category. Grace minutes set by the owner: cinema 25 (adverts), religious 15, music 15, sport 15, talk 10, theatre 5, kids 5 (strict about late entry); open categories 0. `config/app.json`: `family.latestEnd` "21:00" and `arrival` (`detourFactor` 1.3, `openLastEntryMin` 5).
  - **Sources.** Ticketmaster `legalAgeEnforced` → `ageMin: 18`. schema.org `typicalAgeRange` / `audience` → `ageMin`, an upper bound ≤ 12 → `family: true`, `doorTime` before `startDate` → fixed. The Claude extractor's schema gains `age_min`, `family` and `entry`, prompted with the Polish cues and "a concert is fixed, a club night is open". Duplicate merges fill missing values from the other listing.
  - **Add-event form.** Fixed / come-and-go toggle (preselected from the category; stored only when it differs), age choice (not stated / 0+ / 12+ / 16+ / 18+, plus a prefilled page value such as 6+) and a family checkbox; URL autofill prefills all three. Cards and details show "Wiek 18+" / "Ages 18+", "Bez ograniczeń wieku" / "All ages" and "Dla dzieci i rodzin" / "For children and families".
  - **Core helpers** (unit-tested, no UI): `entryOf`, `arrivalAt`, `isLate`, `minutesAfterStart` ("+N min"), `familyMatch` ('show' / 'unconfirmed' / 'hide', with `latestEnd` across the 25 Oct DST change).
  - **Tests.** Contract tests on fixtures: Ticketmaster (the recorded fixture only had `legalAgeEnforced: false`, so the Mayday listing in `page-0.json` was given `true` by hand), crawler LLM path, schema.org inputs, extractor reply parsing; API submit and autofill; database tests for the columns. The `rules.age` move was checked by hand on a local PostGIS database with old-style rows.
  - Skipped: no per-event `graceMin` source yet (the column is there for overrides; no source or form field sets it).
  - Open: schema.org `doorTime` equal to the start says nothing, so such events keep the category default; check on live crawls whether the extractor tells concerts from club nights reliably.

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

- Calendar line icons, 24 px, exactly as in `docs/design/icons/range-*.svg` (1.6 stroke, round caps; use the files, don't redraw):
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
- **Built** (slice B, 2026-10-22): §13.1 and §13.4.
  - `days` time windows, with `daysBounds` in `packages/core/src/time.ts` and tests for both DST weeks.
  - `/api/area?range=week|later`: other values get a 400. The range ends at the region's local midnight, on a 30-minute step.
  - The web client keeps one snapshot per range.
  - Config check: no window reaches past `ingest.lookaheadHours`.
  - Interim UI until the scrubber (§13.2, §13.3, slice F): Week and Later appear as "7 dni" / "14 dni" chips next to Today, and cards already name the day of later starts.
  - Open: the payload size of a real 14-day snapshot is not yet measured against the 100 KB target.

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
