# Happow design rules

How the UI looks and behaves today. Any deviation, and every new icon or glyph, needs the owner's OK.

## Principles

- The map is the interface. Colour means "on now". Numbers are the language: numerals and SI units (16:30, 6 min, 2 km), no words in the chrome. Every icon-only control has a translated `aria-label` (PL/EN).
- Nothing animates at idle. Sheets and cards rise with `--ease-out` over 0.3–0.4 s; `prefers-reduced-motion` turns motion off.
- Touch-first: **no `:hover`** (a test checks `styles.css`). A pressed control shrinks (`:active`, scale 0.92); focus-visible rings stay for keyboards.

## Colour

- Tokens live in `config/theme.json` (day and night), applied by `src/theme.tsx`. Day or night follows real sunrise and sunset, with a manual override. Night is graphite: near-black surfaces and land, grey roads, and parks and water in clear deep green and blue so the map reads at a glance.
- Derived tokens (`--hair`, `--fill`, `--glass`, `--rim`, shadows, radii 12 / 18 / 26 px) are `color-mix` of ink or paper in `styles.css` `:root`.
- **No hex colours in `styles.css`** and **no category colours** (`--cat` is banned; the `color` field in `config/categories.json` is not rendered). Both are enforced by tests.
- Contrast (`checkTokens` / `checkPreset` in `packages/core`): ink ≥ 4.5:1 and muted ≥ 3:1 on paper and land; veil opacity 0.5–0.85.
- **One live colour** (`--live`, `--on-live`) means "on now" and nothing else; errors never use it. Presets: Violet (default), Tally red (signed in), Magenta (premium), Mono (ink). A new preset needs ≥ 3:1 glyph contrast, ≥ 3:1 against day land, and ≥ 40° hue from park green and water blue. Live is also shown by shape, never by colour alone.

## Pins

| State                | Size  | Look                                          |
| -------------------- | ----- | --------------------------------------------- |
| On now               | 34 px | live fill, `on-live` glyph, ring of time left |
| Starts within 60 min | 26 px | paper fill, ink glyph, live outline           |
| Later                | 10 px | muted dot                                     |
| Outside reach        | ×0.85 | half opacity                                  |
| Selected             | ×1.2  | full opacity, on top                          |

The ring is full at 2 h or more and shrinks in 10-minute steps (minimum 8 %); dotted means no fixed end. A dashed outline means you would arrive late or after closing. Age badges sit top right. Live draws over soon over later.

## Layout (portrait)

- **Top left:** live counter `● N` (tap = live only, filled while on), then the shortcut chip.
- **Top right:** add pill (circled plus with category glyphs, more of them from 380 and 410 px), dice, settings.
- **Right edge:** reach rail (inset ~20 px, stops 100 m–5 km on a log scale, walking minutes up to 2 km), then locate and one list-and-search button; opening the list focuses search.
- **Bottom:** the time line, range icons at its left end.
- The list is a window like the settings sheet (paper, no border, 26 px corners, at most 520 px wide) over the map dimmed and blurred by the same scrim; the scrim stays under the time line and map buttons, and tapping it returns to the map. Tapping a row returns to the map with that pin selected. Off-screen events are 10 px dots on the screen edge.
- The map's cards (event, place, hotspot) are the same paper with no border, but with no scrim: the map stays usable around them, so another pin opens with one tap.
- The list is a timetable. Today splits into Now (nearest first), Next hour and Later (soonest first); 7 / 14 days split by day. The start time leads each row (17 px tabular, AM/PM small, "in 26 min" under it up to 90 min); an event on now shows the pin's ring of time left and its end instead. Events at one venue share a tinted block: glyph, venue, distance and walk once, then a line per event. Today a venue shows once, in the section of its next event: three lines, then one line of the remaining times ("+N more", or "later" when they are all in later sections) that unfolds in place. A lone event shows its glyph, venue and walk under the title. A place's card is the same lines under the venue's name; My plans uses the same rows by day, with the tag and the bookmark.
- The event detail is the same window: a bottom sheet on a phone, centred from 720 px; tapping the scrim closes it.
- **Empty reach:** no card on the map; only the list shows an empty state.
- Floating chrome is glass (`--glass`, 24 px blur, `--hair` border, `--rim`, `--shadow-sm`). Map buttons are 40 px circles, buttons are pills, sheets have 28 px top corners.

## Veil

A grey veil over the full-colour basemap, with soft cloud-like holes for the reach and for places you have been (H3 res 9 cells: opened faint, arrived strong, repeat visits brighter; nothing fades). Blobs are seeded by cell id so shapes stay stable. It fades out between z12.8 and z10.5 and redraws only on change. The reach is fully clear to its edge and fades back to the veil by 1.6 r, with no line: a place a minute past the reach is still visible, a little darker. A soft lift (`reachLight` at `reachLightOpacity`, same falloff) makes the reach a lighter, see-through area, at night too. The vector map draws no reach circle; only the raster fallback keeps a dashed circle.

## Range icons and time line

24 × 24, 1.6 stroke, round caps, `currentColor`: Today a filled square, 7 days one bar, 14 days two bars (geometry in `Icons.tsx`). 36 px touch area; the active one is ink-filled, tapping it again shows the whole range. Today steps by hour with a 30-min histogram; 7 / 14 days step by day.

## Glyphs and chips

- One glyph set (`glyphs.ts`) for pins, cards, chips, the add form and pill; Tabler-based plus Happow-drawn glyphs. No emoji. Food glyphs come from `glyphRules` in `config/categories.json`, never random.
- Category chip: tap = only this category; hold 500 ms = hide it (40 % opacity, struck through). An event hides only when all its categories are hidden.
- Shortcut chip: 40 px, ink when on. Tap toggles; hold opens a grid (family mode first, then categories).

## Settings sheet

Black and white only. Top to bottom: category chips; free / paid ticket toggles and the family tile (88 × 44, the last ticket toggle can't go off); language (globe, PL / EN); About row (circled "i"; theme, colour and atlas live in About); footer with clear (`filter-off`) and show (✓ + count). Adding lives on the map, not here.

## Type

Geist (bundled, precached). Headings weight 650, tight tracking; uppercase labels 11 px; times, counts and prices in tabular numerals.
