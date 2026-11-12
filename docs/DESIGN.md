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
| Later                | 10 px | ink dot                                       |
| Outside reach        | ×0.85 | full opacity: pins read through the veil      |
| Selected             | ×1.3  | ink ring on a paper disc, on top              |
| Open place           | 22 px | paper fill, ink glyph, muted outline          |

An event with an update not seen yet (the organiser's post, a new time, a cancellation) carries a "!" at the upper right: an 18 px disc in the pin colour of the preset (`live` with the "!" in `onLive`, so white or ink in Mono; never red, it is news and not an error), on any pin, a dot or a count bubble included; it takes the age badge's corner while it shows. The same "!" stands before the event's title in every list. Only events that are saved or marked "I'm going" (and private events whose invitation was accepted) carry it: any other event shows its updates as soon as its card is opened. It goes once the event's card has shown the update.

The ring is full at 2 h or more and shrinks in 10-minute steps (minimum 8 %); dotted means no fixed end. A dashed outline means you would arrive late or after closing. Age badges sit top right. Live draws over soon over later. Every loaded event is a pin, in the reach or beyond it. The selected pin never merges into a count bubble, and a selected later dot grows into a 26 px glyph pin.

## Open places

Restaurants, cafés, pubs, bars, clubs, cinemas, theatres, galleries, museums and markets (`places.kinds` in `config/app.json`) show on Today's map while they are open at the time looked at, under the event pins and never in the live colour. A place whose hours are unknown or unreadable is not shown. From zoom 14 in, one place per 34 px square (the nearest to you); none in "my plans", with live-only on, or on a day or month of the line. Each kind follows its category's filter. An event at a place takes its pin over for as long as it lasts. Selected: ×1.3 with an ink outline. The card is an event card without the live pill: an ink "Open" pill, "until 23:00", the time left (bold within 60 min), address, distance and walk, Google Maps, the website and "Edit". With a private party on, an ink notice with the lock replaces the "Open" line: "Private party · until 23:00" and that guests from outside are not let in; the place's pin carries the lock at the lower left and wins its 34 px square over other places. An event held at that place (its pin took the place's over) says the same on its card and in its details, with the place's name. "Private event here" on the card opens the add form with the place's name, address and pin filled in and Private on.

**Adding and editing.** The plus asks first: an event or a place (a sheet with two rows). A place needs an account and is on the map at once: name, kind (the configured kinds, one), opening hours (required), address with "Find on map", the pin, website. Hours are lines of seven day toggles (ink when on) with from and to, or "around the clock"; "Other hours on other days" adds a line with the days no line has yet. "Edit" on the card opens a sheet: different hours (the editor, filled in), a private party (until the place closes), closed for good (asked once more). Each shows at once for the one who did it and within `places.cacheMinutes` for everyone else.

## Layout (portrait)

- **Top left:** live counter `● N` (tap = live only, filled while on), then the shortcut chip.
- **Top right:** add pill (circled plus with category glyphs, more of them from 380 and 410 px), settings, dice (two small dice mid-throw). A roll that finds nothing close and soon widens to the loaded area, then to anything still to come; only then a toast says so, in words.
- **Right edge:** reach rail (inset ~20 px, glass thumb with an ink dot of half its width, stops 100 m–5 km on a log scale, walking minutes up to 2 km), then locate and one list-and-search button; opening the list focuses search.
- **Bottom:** the time line, range icons at its left end.
- The list is a window like the settings sheet (paper, no border, 26 px corners, at most 520 px wide) over the map dimmed and blurred by the same scrim; the scrim stays under the time line and map buttons, and tapping it returns to the map. The window shows no scroll bar. Tapping a row returns to the map with that pin selected and in view (the map zooms out when the pin is outside it); the card then carries a back arrow to the list, which kept its scroll position and search text. Off-screen events are 10 px dots on the screen edge (the nearest 24).
- The map's cards (event, place, hotspot) are the same paper with no border, but with no scrim: the map stays usable around them, so another pin opens with one tap.
- The list is a timetable. Today splits into Now (nearest first), Next hour and Later (soonest first); 14 days and the future split by day (with the year when it is not this year's). Titles take up to two lines. The start time leads each row (17 px tabular, AM/PM small, "in 26 min" under it up to 90 min); an event on now shows the pin's ring of time left and its end instead. Events at one venue share a tinted block: glyph, venue, distance and walk once, then a line per event. Today a venue shows once, in the section of its next event: three lines, then one line of the remaining times ("+N more", or "later" when they are all in later sections) that unfolds in place. A lone event shows its glyph, venue and walk under the title. A place's card is the same lines under the venue's name; My plans uses the same rows by day, with the tag and the bookmark.
- The event detail is the same window: a bottom sheet on a phone, centred from 720 px; tapping the scrim closes it.
- **Updates on the card:** tapping a pin shows the organiser's newest updates at the top of its card (`organiser.cardPosts`, three: kind, text cut to three lines, how long ago), then "N more in Details"; the details list them all, important ones pinned first. Links in an update are tappable (http and https only, opened in a new tab). An update not seen yet is also announced once over the map, under the top row: an ink notice with the "!", the event's title and the text; a tap opens the event. On an event that is yours, "Notify me about changes" asks for notifications once.
- **Empty reach:** no card on the map; only the list shows an empty state.
- **Getting there:** on the event card and the detail, Google Maps is the main (ink) button; the route inside Happow is a small icon-only button (the walker) before it, for people who do not use Google Maps or would rather keep the trip to themselves; then Details. The trip map shows the whole route first; once the walker moves it follows them facing along the route (`navigation.heading`). It also turns by hand, which is all there is without a position or while standing still; after a hand moves it, following waits a few seconds.
- Floating chrome is glass (`--glass`, 24 px blur, `--hair` border, `--rim`, `--shadow-sm`). Map buttons are 40 px circles, buttons are pills, sheets have 28 px top corners.

## Veil

A grey veil over the full-colour basemap, with soft cloud-like holes for the reach and for places you have been (H3 res 9 cells: opened faint, arrived strong, repeat visits brighter; nothing fades). Blobs are seeded by cell id so shapes stay stable. It fades out between z12.8 and z10.5 and redraws only on change. The reach is fully clear to its edge and fades back to the veil by 1.6 r, with no line: a place a minute past the reach is still visible, a little darker. A soft lift (`reachLight` at `reachLightOpacity`, same falloff) makes the reach a lighter, see-through area, at night too. The vector map draws no reach circle; only the raster fallback keeps a dashed circle.

## Range icons and time line

24 × 24, 1.6 stroke, round caps, `currentColor`: Today a filled square, 14 days two bars, the future fast-forward on the calendar (geometry in `Icons.tsx`). 36 px touch area; the active one is ink-filled, tapping it again shows the whole range. Today steps by hour with a 30-min histogram; 14 days step by day. The hour numbers on the line follow the language's clock, like every other time on screen: 19, 20, 21 in Polish, 7, 8, 9 in English (bare numerals; the thumb's label carries AM/PM).

The future has no end: it starts where the 14 days end and shows only events starting from then on, never today's or the 14 days'. Its line has 13 steps: 12 calendar months (numbered; the first is the rest of the month the 14 days end in), then fast-forward alone for everything later. Today's map never shows events further than the 14 days.

## Glyphs and chips

- One glyph set (`glyphs.ts`) for pins, cards, chips, the add form and pill; Tabler-based plus Happow-drawn glyphs. No emoji. Food glyphs come from `glyphRules` in `config/categories.json`, never random.
- Category chip: tap = only this category; hold 500 ms = hide it (40 % opacity, struck through). An event hides only when all its categories are hidden.
- Shortcut chip: 40 px, ink when on. Tap toggles; hold opens a grid (family mode first, then categories).

## Settings sheet

Black and white only. Top to bottom: category chips; free / paid ticket toggles and the family tile (88 × 44, the last ticket toggle can't go off); language (globe, PL / EN); About row (circled "i"; theme, colour and atlas live in About); footer with clear (`filter-off`) and show (✓ + count). Adding lives on the map, not here.

## About screen

Every group is an 11 px uppercase label over one paper card (26 px corners, hairlines between rows). Top to bottom: Account; Appearance (theme, colour); Your places (the atlas bar); Information (the intro, then sources, terms, privacy and contact folded, and the legal links); Moderation for staff. Sheets close with the X or the scrim only: no "not now" links. Sign-in asks for the email and signs in at once: the sheet then waits for the code (any length from 6 to 10 digits) and says that invitations and saved events work already; the Account card shows the email, "Waiting for activation" and "Enter the code". An owner hands a private event over from its card: "Hand over", pick an accepted guest, confirm. The name friends see is a field with Save on the Account card's Contacts part; an action that shows it to others (accepting an invite link, adding a contact, inviting) asks for it in place, above its own button, and that one tap saves the name and does the action. Never a separate window.

## Type

Geist (bundled, precached). Headings weight 650, tight tracking; uppercase labels 11 px; times, counts and prices in tabular numerals.
