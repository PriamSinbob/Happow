# Milestone 8 — Saved agenda, add page, accounts and private events: spec

Oct 23, 2026

Spec from the owner's requests of 2026-10-23; Q1–Q4 decided by the owner the same day (see §9). Builds on M6 (merged through slice H, #19) and on "Private events with invitations" in `docs/BRIEF.md` → Future features, which this spec turns into a build plan. M7 (search and follow) can run before or after it; nothing here depends on M7.

**Status:** spec agreed (decisions of 2026-10-23), not built. Build it in the usual way: plan per slice, show the plan, build.

## Owner requests (2026-10-23)

1. The dashed reach circle goes: the lit reach and the faded outside pins already show where the reach ends, and the exact border means nothing to the user.
2. Saving an event works, but there is nowhere to see what was saved.
3. A separate page, with its own URL, for adding events, to make feeding the app as easy as possible.
4. The screen under ⓘ (About) must match the settings sheet design (M6 §15).
5. Login matters: a big part of the use will be private events visible only to invited people.

## Build plan

One branch and one PR to `main` per slice, as in M6. Slices A–C need no accounts and can ship in any order; D unlocks E and F.

| Slice | Spec   | What                                                                   | Needs | Status |
| ----- | ------ | ---------------------------------------------------------------------- | ----- | ------ |
| A     | §1, §4 | Reach circle removed; About screen in the §15 row style (mockup first) | —     |        |
| B     | §2     | Saved agenda on the device                                             | —     |        |
| C     | §3     | Add page at `/add`, PWA shortcut and share target                      | —     |        |
| D     | §5     | User accounts: sign-in, profile, consent, export, delete; saved sync   | —     |        |
| E     | §6     | Private events: data, enforcement, `/api/private`, leak tests          | D     |        |
| F     | §7     | Invitations, RSVP, private UI in the add page, map and agenda          | E     |        |

## 1. Reach circle removed

- Remove the `radius` GeoJSON source and its `radius-fill` / `radius-line` layers from `MapView`, and the `RADIUS_PAINT` entry from the theme wiring. `circleBounds` stays: fitting the view to the reach still uses it.
- What carries the boundary instead: the lit reach in the veil (M6 §6), the faded outside pins and the edge dots.
- Accepted consequences (owner, 2026-10-23): at city zoom, where the veil fades out, and in city mode, nothing marks the reach. During a rail drag the reach keeps its size on screen anyway.
- The "Going there" and add-event pin maps never drew the reach; no change there.

## 2. Saved agenda

- **Entry point.** A bookmark toggle in the list overlay's header (icon only, `aria-pressed`, label "Zapisane / Saved"). On, the list shows the saved agenda instead of the reach.
- **What it lists.** Every saved event, whatever the reach, range, filters, family mode or live-only: they were chosen on purpose.
  - Grouped by day with the M6 day headers and dated times; upcoming first.
  - Ended events fold into a collapsed "Minione / Past" group and are pruned 30 days after their end.
  - Cancelled and "possibly cancelled" flags show as on the card.
  - Tapping a row returns to the map with the pin selected; an event outside the loaded snapshot is fetched and the map flies there.
- **On the map.** Saved events carry a small bookmark mark on the pin (position to settle in the mockup; the age badge keeps the upper right).
- **Data on the device.** `useSaved` keeps ids only today. It becomes `{ id, savedAt, title, startAt, endAt, venueName, lat, lng }` per event, so the agenda renders offline and survives an event that leaves the database. Ids saved before the change are filled in on first load.
- **Events outside the snapshot.** New `POST /api/events/batch` with up to 100 ids, `no-store` (the set of saved ids says something about the person, so it goes in a body, not a cached URL). SQL: `events_by_ids`, public events only until §6.
- **Export.** One .ics with all upcoming saved events (the per-event .ics exists).
- **After sign-in (slice D).** A `saved_events (user_id, event_id, saved_at)` table with row-level security per user. The first sign-in merges the device set into the account (union); signed out, it stays device-only. Accepted private invitations and one's own private events join the agenda in slice F (the brief's "saved and accepted events in one agenda").

## 3. Add page

- **URL.** `/add`, a real path (the Worker's SPA fallback already serves it). The old `#/add` redirects there; the settings-sheet row links to it.
- **Layout.** A page of its own, not an overlay: the existing form on a phone; from 900 px wide, two columns (form | live preview of the card and pin). Keyboard-first: Enter moves to the next field, the date and time fields accept typed values.
- **Feeding faster.**
  - After a submit, "Dodaj kolejne / Add another" keeps venue, date and category, for a series at one place.
  - Before submit, a duplicate check against stored events (same place within ~150 m and start within 30 min, title similarity) warns "already listed" with a link; the user can still submit.
- **Ways in.**
  - PWA manifest `shortcuts`: long-press the installed app icon → Add event.
  - PWA `share_target`: share a link from the browser or the Facebook app straight into `/add?url=…`. Android installed PWA only; iOS has no share target, so pasting stays the path there.
- **Autofill** (owner, 2026-10-23, Q4): on for signed-in users with a monthly quota per account (`submissions.autofillPerAccountMonth` in config, usage shown on the add page); anonymous users keep the manual form. This replaces the 2026-10-21 decision to wait for the organiser subscription: slice C updates `docs/BRIEF.md` accordingly. Until slice D lands, a shared link only fills the official-link field.
- **Signed in (slice D):** submissions are tied to the account, and a "Moje / Mine" view on the add page lists them with their state (pending, published, rejected) and lets the submitter edit or cancel their own events. Anonymous submissions keep working as today.

## 4. About screen in the §15 style

A mockup `docs/design/about-rows.html` comes first, for the owner's OK (CLAUDE.md: deviations from `docs/design/` need it). The direction:

- **Same visual language as the settings sheet (§15):** `paper` sheet, `sunken` tracks, `raised` tiles, icons instead of words, black and white, no segmented text controls, no hover.
- **Theme.** One sunken track with three tiles: auto (sun-moon), day (sun), night (moon). `role="radio"`, translated names.
- **Colour.** Tiles with a 22 px disc of each preset's live hue (Mono: an ink disc). The disc is the one place colour appears in the screen, because the colour is the setting's value. Presets for accounts or premium stay hidden until those tiers exist (Tally red appears with slice D).
- **Atlas.** The atlas bar becomes a row: cell count as a numeral, export and import as download / upload icons.
- **Account row** (slice D): signed out, a circled person glyph opens sign-in; signed in, an initial in a circle and the email, with sign out, export my data and delete account behind it.
- **Moderator row:** the shield glyph. Today it opens the moderator sign-in; from slice D, moderators are ordinary accounts with a role, and the row shows only for them.
- **Worded content stays worded** (principle §1 of M6): sources, terms, privacy, contact and licences move into collapsed disclosure rows below the settings, so the screen opens on settings, not prose.

## 5. Accounts

- **Supabase Auth**, extending `apps/web/src/auth.ts` from moderators to everyone: public sign-up on (`create_user: true`), sessions in `localStorage` with refresh rotation; moderators become users with `app_metadata.role = 'moderator'`, checked by the Worker.
- **Sign-in methods.**
  - Email with a 6-digit code as the default, and the magic link in the same email. The code matters for installed PWAs: on iOS a home-screen web app keeps its storage apart from Safari, so a magic link opened from Mail signs the user in to Safari, not to the installed app.
  - Google as the second method (owner, Q1). Apple later: it needs a paid Apple Developer Program membership. Test the Google redirect inside an installed iOS app; the email code is the fallback there.
  - Passkeys come later with the atlas sync (M6 §8).
- **Email delivery.** Supabase's built-in SMTP is rate-limited and meant for testing; sign-in and invitation emails need a custom SMTP provider (Cloudflare Email Service, Resend or Postmark) before anyone else uses it.
- **Profile.** `profiles (user_id, display_name, created_at)`; the display name is optional and shown only to people one invites or is invited by.
- **GDPR.** Consent to terms and privacy at sign-up; export (JSON of profile, saved, contacts, groups, invitations, own events); delete account cascades to all of those. Public events one submitted stay published but lose the link to the account.
- **Nothing public needs an account.** Browsing, filters, saving on the device, adding public events and reporting stay anonymous.

## 6. Private events: data and enforcement

Data model from the brief: on `events`, `visibility` ('public' / 'private', default public) and `owner_id`; tables `contacts`, `groups`, `group_members`, `invitations`.

- **The API bypasses row-level security.** The Worker reads Supabase with the service key, so RLS alone protects nothing on the API path. Three layers:
  1. Every public SQL function (`events_area`, `events_near`, `event_by_id`, `events_by_ids`, density and hotspot, `events_public`, M7 `search_events`) filters `visibility = 'public'` explicitly.
  2. RLS on `events` changes from `using (true)` to "public, or the viewer is the owner or an invitee", as a backstop for direct PostgREST access with the anon key.
  3. Private reads go through `events_private(p_user, …)`, called only after the Worker has verified the user's JWT with GoTrue (as the moderation endpoints do today).
- **Caching.** `/api/area` is `public, max-age` and cached at the edge per grid cell, so a private event in it would reach every visitor of that cell. Private events never enter it. A separate `GET /api/private?range=` with the bearer token returns the user's own and invited events, `cache-control: private, no-store`; the client merges them into the snapshot by id on the same 5-minute clock. Signed-out users never call it.
- **Excluded everywhere public:** density counts, hotspots, other people's live counter and edge dots, share previews and Open Graph tags (they stay generic: "Prywatne wydarzenie / Private event"), duplicate merging with public listings, ingest, M7 search and follow matching, Plausible event names.
- **Location** (owner, Q3). A private event may be someone's home. Invitees who have not accepted, and link holders, see the area (the H3 cell) and the time; the exact address and pin appear on accepting. `events_private` returns the cell, not the coordinates, until then.
- **Abuse limits.** Per account: private events per day and invitations per event capped in `config/app.json`; email invitations rate-limited per account.
- **Retention.** Private events are deleted 30 days after their end; unaccepted email invitations with them.
- **Tests (required before merge).** Database tests that a private event is invisible to anon and to a signed-in non-invitee in every public function, density and hotspot included; a Worker test that `/api/area` never contains a private id and that `/api/private` answers `no-store` and 401 without a valid token.

## 7. Invitations and private UI

- **Creating.** The add page gets a Public / Private toggle once signed in. Private events skip public moderation (only invitees see them) but keep the abuse limits.
- **Inviting** from the event, in one sheet:
  - **Link:** a capability token (128-bit, stored hashed, revocable, optional expiry). Without an account, the link shows the event (title, time, area; owner, Q2); answering needs sign-in, and accepting reveals the address. `GET /api/invite/:token` is `no-store` and rate-limited per IP.
  - **Email:** sends an invitation; the recipient signs up or in to accept.
  - **Contacts and groups:** people one has invited before become contacts; groups are named lists of contacts ("Rodzina", "Klub planszówek").
- **RSVP:** going / maybe / declined. The organiser sees counts and the names of those going; invitees see the count only.
- **Changes reach invitees:** edits and cancellations appear on the next refresh; a cancellation also sends an email to those going.
- **On the map:** private pins keep the time encoding (live, soon, later, ring) and carry a small lock mark, so they read as "mine" without a new colour (the live hue keeps its one meaning). Settled in the mockup.
- **In the agenda (§2):** own private events and accepted invitations appear with the saved ones; pending invitations sit on top until answered.

## 8. Acceptance

- The map shows no reach outline; the reach still reads from the lit area at street zoom.
- The saved agenda lists every saved event offline, including ones outside today's snapshot, after a reload.
- `/add` opens directly, from the app-icon shortcut, and (on Android) from the share sheet with the link filled.
- The About screen passes the design review against the approved mockup.
- Sign-in by code works in an installed iOS home-screen app.
- No private event or detail reaches an anonymous user or a non-invitee through any endpoint, cache or preview (the §6 tests).

## 9. Decisions and open questions

Decided by the owner on 2026-10-23:

- **Q1 sign-in:** email code (with the magic link in the same email) plus Google.
- **Q2 invitation link:** shows the event without an account; signing in is needed only to answer.
- **Q3 address:** area and time until the invitee accepts.
- **Q4 autofill:** on for signed-in users with a monthly per-account quota.

Open:

- Private events are assumed free for every signed-in user (nothing in `docs/ADVANTAGES.md` puts them behind premium); confirm before slice E.
- SMTP provider for sign-in and invitation emails (§5).
- The autofill quota number (100 links a month in the brief's example).
