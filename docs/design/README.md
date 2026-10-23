# Design references

Visual source of truth for the M6 and M7 UI. Where the milestone specs describe a screen in words, these files show it. When building UI, match them; any deviation needs the owner's OK first.

| File                    | What                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prototype.html`        | Interactive prototype of the map screen, agreed with the owner on 2026-10-22. It is self-contained: open it in a browser (no build, no network), or read its source. |
| `icons/range-today.svg` | Time range icon: Today (calendar with one filled day).                                                                                                               |
| `icons/range-week.svg`  | Time range icon: 7 days (one filled row).                                                                                                                            |
| `icons/range-later.svg` | Time range icon: 14 days (two filled rows).                                                                                                                          |
| `settings-rows.html`    | The settings sheet's wordless rows (price, add, language, about, footer), approved by the owner on 2026-10-23. Self-contained; toggle day and night.                 |

## Normative: match exactly

- **Range icons.** Use the SVG files as they are: 24 × 24 viewBox, 1.6 stroke, round caps and joins, `currentColor`. The marks are a filled 3.8 px square (Today), one 3 px bar (7 days) and two 3 px bars (14 days). Don't redraw them with another icon set.
- **Where they go.** At the left end of the time line (M6 §13.2), 36 px touch area, the active one ink-filled. Tapping the active icon again shows the whole range.
- **Time line.** Today steps by hour, from now to the end of the day. 7 and 14 days step by day, with date numerals and a per-day histogram (§13.3).
- **Pins** (§4.1).
  - Sizes: 34 px on now, 26 px within the hour, 10 px dots later.
  - The ring shows absolute time left, full at 2 h or more with an 8 % minimum; a dotted ring means no fixed end.
  - Outlined in the live colour when starting within the hour; dashed for "late" or "closed before you'd arrive".
- **Colour** (§3). One live colour, used only for "on now". Violet is the default; Red and Mono are presets. Night land is pure black. The day and night palettes in the prototype script (`DAY`, `NIGHT`) are the §3.1 tokens.
- **Chrome positions** (§5):
  - top-left: live counter
  - top-right: dice and filters
  - right edge: reach rail, with locate and list below it
  - list style B: an overlay over the map
- **Lit map** (§6). A grey veil with soft, cloud-like holes for your reach and the places you've been. It fades out as you zoom out.

- **Category glyphs** (owner's choice, 2026-10-23): one set in `apps/web/src/glyphs.ts` for pins, cards, detail, filter chips and the add form. No emoji.
  - From Tabler Icons: music, theatre (masks), cinema (film), exhibition (photo), festival (confetti), happening (sparkles), sport (runner), market (basket), kids (rocking horse), food (utensils).
  - Drawn for Happow: garage sale (tag), talk (microphone), religious (candle), café (cup), bar (beer mug), other (dot).
  - Food picks its glyph per event from words in the title or venue (`glyphRules` in `config/categories.json`): cup for cafés, beer mug for pubs, bars and breweries, utensils otherwise. Never chosen at random: the glyph must say what the place is.
  - Change a glyph only with the owner's OK.

- **Settings sheet rows** (M6 §15, `settings-rows.html`): black and white only, two ticket toggles (both on by default, last one can't be switched off), circled plus with fanned glyphs, globe with small PL / EN fields, symmetric circled "i" with gear and shield, icon-only footer. Category colour tints go everywhere.
- **Touch-first: no hover styles** (owner, 2026-10-23).

## Illustrative: don't copy

- The street grid, river, parks and sample events. The app draws the MapLibre basemap and real data.
- The demo clock (Friday 23 October, 16:10) and the hard-coded walking speed.
- Category glyphs in the prototype are older placeholders. The reference is the app's set in `apps/web/src/glyphs.ts` (see below).
- Control icons in the prototype (dice, filters, locate, list) are also Tabler placeholders; if the app adopts Tabler, keep its MIT notice.

## Where the owner sees it

The same page is published as a private claude.ai artifact ("Happow Map Prototype") for viewing on a phone. The copy in this folder is the one to build from.
