# Happow — redesign: social, innovative and design updates

Nov 14, 2026

Read this before any redesign work. It holds the owner's decisions and the picked features from the design sessions of 13–14 Nov 2026. The features are not built yet. Their designs are being polished first, and they get built in the web app only after that, one slice at a time with the owner's OK.

Mockups: design canvas "Happow redesign" (https://claude.ai/artifact/Pp5etXJ1hqJSU84uMJqFtT), 12 screens built on the Happow design system. Where this file and the canvas differ, this file wins; where either differs from [DESIGN.md](DESIGN.md), ask the owner.

## 1. Decisions

### Platforms and order of work

1. Happow is an Android app first, then iOS ([NATIVE.md](NATIVE.md)). The apps are the product and the base place for users.
2. Everything connected to accounts lives in the apps.
3. Adding happens in the apps, where the camera, photos and location are. The public website shows no add form. The web app in this repository keeps all its functions as the reference client.
   - **Places: no account, but only from a photo.** Any photo, gallery included, with its location taken from the photo or the phone; without either, the user drops a pin. Typing a place in by hand without an account is not offered.
   - **Events** are treated separately and keep today's rules.
4. The web is the overview: map and lists, shared event links, embeds, promotion and cooperation.
5. **Order of work:**
   1. Polish the designs of the picked features.
   2. Build them in the web app, the reference client.
   3. Build the native apps (widgets, notifications, permissions).
   4. Build the public website last, after the apps.
6. The time left shows as a countdown ("in 26 min") in the event detail only, not on the map, and is not marketed as a feature (it is already how the detail leads, see DESIGN.md).
7. Public website (later): an animated, feature-by-feature scroll, then the map with real data. No slogan or motto on it without the owner's confirmation.

### Standing rules (unchanged)

Every public event shown equally, nothing paid changes visibility or order. One live colour, black-and-white chrome, wordless controls, minimal text, no-obstacle onboarding. No streaks, no fake urgency, no points for volume, no public leaderboards. Private by design: coarse location, no counts under 5.

## 2. Picked features

| Feature                  | What the user sees                                                                                                                                                                                                                                                                                                             | Builds on                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Flares                   | One gesture drops a glyph-only mark (spark) for something informal happening here now. It fades after about 45 min unless someone within about 100 m relights it. A report button removes false ones.                                                                                                                          | quick-pin idea; device rate limits                             |
| Yesterday                | The time line also runs back 24 h: ended events as hollow marks, the ones you went to solid; a weekly rhythm grid for the street.                                                                                                                                                                                              | needs ended events kept as history                             |
| Mystery walk             | A dice variant that keeps its pick secret: an arrow, the walk in minutes, length, price, indoors or not. It reveals itself at the arrival distance (`navigation.arriveM`, 40 m).                                                                                                                                               | `dice.ts`, arrival detection                                   |
| Overlap with a friend    | Send your reach as a link; the map lights only where both of you can walk; rows show both walking times. The link carries a rounded centre and expires; no account.                                                                                                                                                            | reach, share links                                             |
| Place from a photo       | The existing add-place form, filled in from one photo of a door: name, kind, opening hours, house number. Numbered marks tie each field to the part of the photo it came from. No account (see 1.3). A place already listed within about 30 m turns "add" into "update hours".                                                 | `AddPlace.tsx`, `photo.ts`, the poster autofill                |
| Your additions (receipt) | A first-add welcome; after each event a receipt: opened, saved, on the way, came, and how many said thanks; totals that never reset. In the About screen's style.                                                                                                                                                              | `Contributor.tsx`, `/api/me/contributions`, `/api/thanks`      |
| Chains                   | Events and places of one festival or cooperation, joined on the map. A chip next to the counter (diamond, `3/8`) isolates them; stamps per visited stop (on arrival); the next open stop with its walk; the remaining stops go into the evening queue. Organisers may attach a perk to stamps for attending, never for adding. | `EveningQueue.tsx`, arrival; new `series` and `series_members` |
| Last seats               | A venue releases unsold seats for tonight with a door price; a row in the event detail next to tickets and a numeral badge on the pin. Free for every organiser; a fact, not placement.                                                                                                                                        | claimed events, organiser panel                                |
| Lab and unlock goals     | New features start as opt-in experiments (a switch each, at most three at a time, each labelled "stays if used"). Others open when a real condition is met, shown with a meter or date: weeks of history, venues on board, people in the district, or a committed release date.                                                | district goals (`seasons.ts`)                                  |
| Embeds and collections   | Single event, list and place widgets for media and venue sites. Every row links to the source; editors arrange, pin, hide and annotate, while time, place, price and status stay live. No cookies, no reader tracking.                                                                                                         | public reads already allow any origin (FUTURE.md)              |
| Rhythm for organisers    | Free slots per district and category from history ("Thu 19:00 was free in 7 of 8 weeks"), with "add here". Paid organiser tooling.                                                                                                                                                                                             | same history as Yesterday                                      |

**Future, after launch:** rain on the time line (needs the weather source in FUTURE.md).

**Not picked:** habits (ghost pins), street radar, poster wall, door screens.

**Built in the web app:** place from a photo (14 Nov 2026): `POST /api/places/photo`, the photo pass, `AddPlace.tsx`.

**Already built, to polish rather than rebuild:** the evening queue (it covers the "thread" idea), contributor impact and levels, thanks, district goals and seasons, "I'm going", friends' line, atlas, dice, nearby-now on ended links.

## 3. Design notes from the polished screens

- Pins as in DESIGN.md: later events are ink dots; outside the reach, pins keep full opacity at ×0.85; selected ×1.3 with an ink ring; open places 22 px with a muted outline. The flare is a new pin state: a small live-hue disc with the spark and a dotted ring.
- The event detail keeps the DESIGN.md order. Last seats is a row next to tickets and website; embed joins calendar, share and save.
- New glyphs used in the mockups (spark, ticket, roof, lock, diamond, camera, cup variants) are proposals and need the owner's OK.

## 4. Grounding in the engagement research

The research of 2026-11-09 ("Happow — what makes people open it and add events", https://claude.ai/artifact/Ecu8f5FyN47iY5tQGPheTv) is a foundation for this work. Its five bets, in order:

1. Win one district before the city.
2. Make adding take seconds.
3. Close the loop to the contributor (receipt, thanks, first-add welcome).
4. Make organisers want to be on Happow.
5. Let invitations carry the app.

Gamify the city, not the act of contributing. North star: weekly useful opens. First experiment: impact receipts for a random half of adders, comparing second-add rates at 30 days.

## 5. Open

- Which picked features sit in the Lab, which wait on a goal, and which are simply on.
- How events are added without flooding the map.
- Embed rows still to be matched to the list's timetable rows.
- Redistribution rights for embeds: crawled listings on commercial sites need a legal check; until then embeds carry submitted, claimed or licensed events only.
