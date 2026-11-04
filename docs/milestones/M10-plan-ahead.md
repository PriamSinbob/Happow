# Milestone 10 — Plan ahead: spec

Nov 4, 2026

Spec from the brief (Future features → Plan ahead, requested 2026-10-21) and the M10 line in the milestones list. M10 comes after M9 in the build order (brief, 2026-10-26). Build it the usual way: post each slice's plan, wait for the owner's OK, build it, then replace the "Status" line with the report.

**Status:** spec approved, §8 answered by the owner on 2026-11-04. All slices built on 2026-11-04: A, B and C together (owner: one step), then D and E, then F; the owner approved the deviations in the Built notes (the bell icon, no settings row for the default lead, no walk in the notification, 6 reminders per cron tick) the same day. What it does: [M10-summary.md](M10-summary.md).

Goal: **what you've decided to go to sits in one place, an evening of several events works out on foot, and the phone reminds you before something starts.** The PoC is about now and today; M10 makes the same app useful for this evening, the weekend and the next two weeks. The brief's rules hold: no streaks, no fake urgency, pull not push (a reminder is something the person set, never something we choose to send), paid never buys visibility. No new data sources.

## What exists

- **Saved events.** The bookmark on the event card (`useSaved`): up to 200 event ids on the device, no account, no server copy.
- **"I'm going"** (M9 slice E): one anonymous row per device and event on the server (`attendance`), linkable to an account when signed in.
- **Week and Later windows** (M6 §13): the map and list already reach 7 and 14 days ahead, with day selection on the scrubber. The brief's "Later filter with a date picker for a chosen evening" is covered by these; M10 adds nothing to the time filter.
- **Walking.** Arrival estimates from straight-line distance × 1.3 ÷ `walkingSpeedMPerMin` (M6 §4.2), and routed walks through openrouteservice in "Going there" (`navigation.routing`, 30 routes per hour per client).
- **Entry model** (M6 §4.2): `entry: fixed | open` with `graceMin`, which already decides "late" and "closed before you'd arrive".
- **Calendar file.** "Add to calendar" downloads an `.ics` per event.
- **Scheduler.** The Worker's cron runs every 15 minutes (`wrangler.jsonc`).
- **Plans.** `saved.sync` is in `config/plans.json` (free account and premium, not anonymous), reserved for M10 by M8.
- **No web push** anywhere yet. M7 slice G (new-date alerts) will reuse what M10 builds.

## Build plan

One branch and one PR to `main` per slice, as in M9 and M12. Each slice PR updates its row below and the Status line, and adds a short "Built (slice X)" note under its section. UI slices follow the existing screens (no mockups since M12 slice D, owner 2026-10-28); the design studio pass comes after everything is built.

| Slice | Spec | What                                                                                   | Needs | Status |
| ----- | ---- | -------------------------------------------------------------------------------------- | ----- | ------ |
| A     | §1   | Views (everything, plans, saved) and the agenda: your events by day, past ones folded  | —     | built  |
| B     | §2   | Saved events follow the account across devices (`saved.sync`)                          | A     | built  |
| C     | §3   | The evening queue: events in a row, walking times between them, overlap and "too late" | A     | built  |
| D     | §4   | Web push: subscription, keys, the sender in the Worker (no reminders yet)              | —     | built  |
| E     | §5   | Reminders before a start, on the agenda's events                                       | A, D  | built  |
| F     | §6   | Room for M11's accepted invitations in the agenda, and the M10 summary                 | A–E   | built  |

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post each slice's plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and Prettier on changed files. No live calls in CI: the push service and openrouteservice get recorded fixtures.
- On the owner's Windows checkout: commit only files with real changes (`git diff --ignore-cr-at-eol`), and write commit messages to a file.
- Previews use the **live database**: test sync and reminders on a preview with that in mind (`docs/HARDENING.md`).
- Wording waits for the text pass after the app is finished.

## 1. The agenda (slice A)

- **One list of your plans:** every event you saved or marked "I'm going", once each. **"I'm going" also saves** the event (owner, 2026-11-04); un-saving doesn't take back "going". The agenda shows a small "going" tag on the ones you marked.
- **Grouped by day** in the region's time zone, with the list's day headers (M6 §13.5): "Today", "Tomorrow", then "Sat 7.11". Within a day, by start time. An event already on sits at the top of Today with its live ring.
- **Past events** fold into "Past" at the bottom, newest first, kept for 30 days (`agenda.keepPastDays`) and then dropped from the device list. Cancelled or "possibly cancelled" events stay in place, marked as on their cards, so a change of plan is visible rather than silent. Hidden events read as "no longer listed" (as M9 §4).
- **Beyond the snapshot.** The map's snapshot reaches 14 days; saved events can be further out (crawled events go up to 60 days). The agenda reads its events by id: a new database function `events_by_ids` (the app reads events from the database directly, so not a Worker endpoint) taking up to 200 ids and returning the listed events among them (one query on `events_public`).
- **Views** (owner, 2026-11-04). The bookmark button in the top-left row that M7 §4 places for "My plans" becomes a view switcher, built in M10. One entry point; M7 adds no button of its own.
  - **Everything:** the map and list as today (the default).
  - **My plans:** saved, going and (from M11) accepted invitations.
  - **Saved:** bookmarked events only.
  - **Private:** private events you're invited to, added by M11 (the switcher is built so a view is one config entry).
  - Tap switches between Everything and the last other view; hold opens the picker (as the map shortcut chip does). The chosen view is remembered on the device.
  - Map and list both follow the view, on top of the time, category, price and family filters (M7 §4's behaviour). Your events outside the reach still show (they're yours). In any view but Everything, the list is the agenda layout described here: by day, past folded.
- **Empty.** A view with nothing in it says so instead of showing an empty map: "Nothing saved yet: tap the bookmark on an event" (the wording M7 §4 already set).
- **Each row** is the list card: glyph, title, time, venue, walk estimate from where you are now, and the bookmark to remove it. Tapping opens the event card.
- **Calendar.** "Add all to calendar" on a day downloads one `.ics` with that day's events (the existing `ics.ts`, several `VEVENT`s).
- **Free**, no account.
- **Tests.** The view switcher (tap, hold, remembered); "going" also saving; merging saved and going without duplicates; day grouping across midnight and the DST change; past folding and the 30-day drop; ids beyond 14 days read through `events_by_ids`; hidden and cancelled events.

**Built (slice A).**

- **Views.** A third round button in the top-left row (`useView`): tap switches between Everything and the last view, hold opens the picker (the map shortcut's grid, with the calendar for My plans and the bookmark for Saved). The views come from `agenda.views` in `config/app.json`, so M11 adds `private` there. The choice is remembered on the device.
- **Map.** In a view, the map shows only your events that fit the time line and the filters, wherever they are; the hotspot hides. With none, a card says "Nothing saved yet…" or "None of your plans at this time" with "Open the list".
- **The list is the agenda** (`Agenda.tsx`) and shows all your events whatever the time line says: the time line is the map's control, and a plan next week shouldn't vanish from your plans because the map shows today. Days use the list's headers, rows the list card with a bookmark to remove and a "Going" tag; cancelled events are marked; "Past (n)" folds; ended ones leave the list after `agenda.keepPastDays`; ids no longer listed show as one line with "Remove". Tapping a row opens the event's page.
- **Calendar.** A calendar button per day downloads one `.ics` with that day's events. Fixed on the way: `;` in calendar text was never escaped (RFC 5545 wants `\;`).
- **Store.** `plans.ts` keeps the list on the device (`happow:plans`), taking over the old saved list. "I'm going" saves; un-saving clears the local "going" tag but not the server's "I'm going". An event marked going before M10 joins the list the next time its card opens, unless it was removed since.
- **Reading by id.** `events_by_ids` in migration **24**, granted to anon. Until it's applied, the agenda shows the events the map has loaded (the next 14 days in the area).

## 2. Saved events across devices (slice B)

- **Who.** Signed in with `saved.sync` (free account and premium, per `config/plans.json`). Without an account, saved stays on the device, as today.
- **What syncs:** the saved event ids with the time each was saved or removed, and reminder choices (§5). Nothing else: no settings sync (M8, owner 2026-10-24).
- **Storage.** A `saved_events` table (account, event id, saved at, removed at), row-level security so only the account reads its rows, service role for the API. Removal keeps a tombstone for 30 days so a phone that was offline doesn't bring an event back. See §8.3 on whether this should be end-to-end encrypted like the lit map.
- **Merging.** On sign-in, the device's list and the account's list are merged (union; the latest save or removal per event wins). After that, every toggle is written through, and the agenda pulls on open and every `refresh.dataMinutes`.
- **The 200 cap** stays per account, oldest past events dropped first.
- **Signing out** keeps the device's list as it is; deleting the account deletes the rows (and M13's GDPR export includes them).
- **Tests.** The merge rules (union, latest wins, tombstones), the cap, RLS (another account reads nothing), the plan check, sign-out and delete.

**Built (slice B).**

- **Server.** Migration **24** adds `saved_events` (account, event, saved, going, changed at; RLS on, no policies: only the service role reads it, through the API) and `saved_sync`, which merges and returns the account's list. A time from the future counts as now, so a wrong phone clock can't pin an event forever. The account export includes the list; deleting the account deletes it.
- **API.** `POST /api/me/saved {items}` → `{items}` (`packages/api/src/saved.ts`): needs a sign-in and `saved.sync`, rate-limited per account (`agenda.syncPerHour`). An empty list is a pull.
- **App.** `usePlanSync` syncs on sign-in, 1.5 s after a change, and every `refresh.dataMinutes`, then keeps the merge of both lists. Signing out leaves the device's list as it is.
- **The cap** drops the oldest saved first, not the oldest past events: the server doesn't know when events are on, and past ones leave after 30 days anyway.

## 3. The evening queue (slice C)

- **What it is.** For any day in the agenda with two or more events, a "Plan the evening" view: the events in start order, with the walk between each pair and a verdict.
- **Walk between two events** from the first one's venue to the next one's, leaving at the first one's end (or its start + `defaultDurationMin` when it has no end). The M6 §4.2 estimate only (straight line × 1.3 ÷ 80 m/min), rounded up to 5 minutes and shown as "about 15 min on foot" (owner, 2026-11-04: a rounded number is enough). No openrouteservice calls; the event card's "Route in Happow" is there for the actual walk.
- **Verdicts,** from the entry model the pins already use:
  - **Overlap:** the next one starts before this one ends. Shown as "Overlaps by 40 min".
  - **Too late:** arrival (leave + walk) is after the next one's start + `graceMin` for a **fixed** event, or within 5 minutes of the end for an **open** one. Shown as "You'd arrive 15 min late" or "Closes before you'd get there".
  - **Fine:** otherwise, with the slack shown ("25 min to spare").
  - Open events (markets, exhibitions) are flexible: when an overlap involves one, the view says so ("Open until 20:00, you can leave early") rather than warning.
- **Leaving early.** Each event in the queue can take a "leave at" time (a stepper in 15-minute steps, on the device only); the walk and the next verdict use it. This is the only editing; the order is always by start time.
- **Over 45 minutes on foot** (`navigation.maxMinutes`) a leg says "Long walk" and offers the Google Maps hand-off for transit, as "Going there" does.
- **Nothing is moved or dropped for you:** the view only shows the warnings; the person decides.
- **Free**, no account.
- **Tests.** Overlap, late for fixed, closed for open, the open-event exception, leave-at changing the next verdict, no end time, a leg over the walking limit, rounding up to 5 minutes.

**Built (slice C).**

- **Where.** "Plan the evening" on any agenda day with two or more events opens the queue (`EveningQueue.tsx`, a full screen over the map). The core is `eveningQueue` in `packages/core/src/agenda.ts`.
- **Verdicts** as specified, plus "Just in time" for an arrival within the grace. An open-entry event that overlaps the next fixed one says "Open entry: leave by 19:20 to make it" instead of a warning. Warnings use the warning colour.
- **Leave at.** − and + in 15-minute steps (`agenda.leaveStepMin`) between the start and the end, kept on the device (`happow:leaveAt`), not synced.
- **Long walks** (over 45 min) show "Long walk" and "Transit in Google Maps".
- **No routing calls**: rounded estimates only (`agenda.walkRoundMin`, 5).

## 4. Web push (slice D)

Plumbing only; reminders use it in slice E and M7's new-date alerts after that.

- **Where it works.** The installed PWA on Android (and Chrome or Firefox in a browser tab); on iPhone only from the Home Screen (iOS 16.4 and later). In iOS Safari the option says "Add Happow to your Home Screen to get reminders" and links to the M9 hint.
- **Permission** is asked only when someone sets their first reminder, never on start.
- **Keys.** A VAPID key pair: the public key in config (`push.vapidPublicKey`), the private key as a secret (`VAPID_PRIVATE_KEY` in GitHub Secrets and `.env.example`), the contact as `push.contact` in config (until M13 sets the final address).
- **Subscriptions.** A `push_subscriptions` table: the endpoint and keys, the salted device hash, the account when signed in, created and last-used times. Endpoints that answer 404 or 410 are deleted; a device that turns permission off removes its row.
- **Sender.** In the Worker: RFC 8291 payload encryption and RFC 8292 VAPID with WebCrypto (no Node library), so it runs in the cron. Payloads are small: a title, a body, the event's `/e/<id>` link.
- **The service worker** shows the notification and opens the link on tap (the app turns it into the card, as for shared links).
- **Tests.** Encryption against the RFC 8291 test vectors; the VAPID header; 410 removal; the service worker's click handler opening `/e/<id>`. No live push in CI.

**Built (slice D).**

- **Sender.** `packages/api/src/webpush.ts`: RFC 8291 encryption and RFC 8292 VAPID with WebCrypto. Tested against the RFC 8291 example (same salt, record size, key and ciphertext), by decrypting with Node's own crypto, and by verifying the VAPID signature. About 1.5 ms of CPU per push.
- **Key.** One secret, `VAPID_PRIVATE_KEY`: a P-256 private key as one line of JSON, made with `pnpm push:keys`. The public key is worked out from it and served at `GET /api/push/key`, so nothing goes into config (the spec had `push.vapidPublicKey`; one secret is simpler to set and can't get out of step). The contact in the signature is `legal.contactEmail`.
- **Subscriptions.** Migration **25** adds `push_subscriptions` (endpoint, keys, device hash, account, language). `POST /api/push/subscribe` and `/api/push/unsubscribe`. A 404 or 410 from the push service deletes the row.
- **Service worker.** `public/push-sw.js`, loaded by the generated worker (`importScripts`), shows the notification and opens `/e/<id>` on tap, in an open Happow window if there is one.
- **Permission** is asked only when someone sets their first reminder. On iPhone in Safari the bell says to add Happow to the Home Screen first; where notifications are blocked or push doesn't exist, it says so. Either way it offers the phone's calendar.

## 5. Reminders (slice E)

- **On any agenda event:** a bell on the card with the lead times in `reminders.leadMinutes` (config: 15, 30, 60, 120 minutes and "the day before at 18:00"). One reminder per event, chosen per event; a default lead in settings, **60 minutes** (`reminders.defaultLeadMinutes`, owner 2026-11-04).
- **What it says:** the real time left when it's sent, not the lead chosen: "Starting in 72 min: Title · Venue · 12 min on foot from your last location", with the walk only if location is on, from the last position the app saw. Cancelled events get "Cancelled: Title" instead, if we learn of it before the reminder time, and no reminder fires for a hidden event.
- **Scheduling.** The device sends `(event, lead)` with its push subscription to `POST /api/reminders`; the server stores `reminders` (subscription, event, fire at) and recomputes `fire at` when an event's start changes in ingest. The 15-minute cron sends each reminder at the last run before its time, so it arrives up to 15 minutes early (60 or 75 minutes ahead for a 60-minute lead, owner 2026-11-04); the text says the real minutes.
- **A start that moves** (the source changes it) moves the reminder; a start moved earlier past the reminder fires it at once with "Time changed: now 19:30".
- **Limits.** At most 50 pending reminders per device (`reminders.maxPerDevice`), rate-limited like the other device endpoints. Rows go after firing or when the event ends.
- **With an account,** reminders follow the person to their other subscribed devices (one notification per device); without one, they live on the device that set them. **No account needed** (owner, 2026-11-04): a push subscription belongs to a device.
- **Removing** the event from the agenda removes its reminder.
- **Push only, no email** (owner, 2026-11-04). Without push (an iPhone without the Home Screen install), the bell offers "Add to calendar" instead, so the phone's calendar reminds them.
- **Tests.** Fire-at from lead and start; the cron picking due rows once; a start change moving it; earlier past the time firing with "Time changed"; cancelled and hidden; the per-device cap.

**Built (slice E).**

- **Bell.** On the event page, next to the bookmark, for saved events that haven't started (`ReminderSheet.tsx`). The leads come from `reminders.leads`. The icon is Tabler's `bell` as published (the set had no bell; owner OK, 2026-11-04).
- **Default lead.** 60 minutes until the person picks another; after that the last one chosen comes first. There is no settings row for it: the settings sheet's rows are an approved design (M6 §15), so a new row waits for the owner.
- **Server.** Migration **25** adds `reminders`, one per device and event. With an account it's one per account and event, reaching every subscribed device of that account. The fire time is worked out from the event's current start whenever the cron asks, so a moved event moves its reminder with no ingest hook. A start moved past the reminder time sends it at once with "Time changed: now 19:30".
- **Cron.** `sendDueReminders` runs on every tick with the ingest check and the metrics. It sends what's due before the next tick (`reminders.cronMinutes`, 15), so a reminder can come up to 15 minutes early and says the real time left ("Za 72 min · Klub"). Cancelled events get "Odwołane: …". Hidden ones send nothing. A push that failed for every device is tried again next tick. At most `reminders.maxPerTick` (6) per tick for the Free plan's CPU (`docs/HARDENING.md`).
- **Not built: the walk in the text.** "12 min on foot from your last location" would mean storing people's last location on the server. Leaving that out keeps the server free of locations, and the link opens the event card, which shows the walk.
- **Following your plans.** Removing an event from your plans removes its reminder. The bell's copy on the device refreshes from the server at start and on sign-in, when the subscription is also tied to the account.
- **Language.** Polish or English, from the app's language when the browser subscribed (sent again when it changes).

## 6. Accepted invitations and the summary (slice F)

- **Room for M11.** The agenda's source list becomes "saved ∪ going ∪ accepted invitations", with the third empty until M11. The `events_by_ids` read already respects visibility, so M11 only adds private events the person may see. Accepted invitations are always in the agenda and can't be un-bookmarked; declining removes them.
- **M10 summary** (`M10-summary.md`), as for M9 and M12: every feature from the user's side, and what's left for the owner (migrations, the VAPID secret, phone tests).
- **Tests.** The agenda merging a fake invitation source; nothing else changes until M11.

**Built (slice F).**

- **Core.** `viewIds(list, view, invited)` takes the accepted invitations (`AcceptedInvitation {id, private}`): My plans is saved ∪ going ∪ invited, Saved the bookmarks only, Private the private invitations. Without invitations nothing changes.
- **App.** `invitations.ts` is the source, empty until M11 calls `invitations.set` with what the server returns. The agenda tags an invited event "Invited" and shows no bookmark to remove it; declining (M11) takes it off the source.
- **M11 still adds:** the `private` view in `agenda.views`, the server read of accepted invitations, and private events in `events_by_ids` for people who may see them.
- **Summary:** [M10-summary.md](M10-summary.md).

## 7. Free and paid after M10

| Feature                                          | No account | Free account | Premium |
| ------------------------------------------------ | ---------- | ------------ | ------- |
| Views, agenda, evening queue                     | ✓          | ✓            | ✓       |
| Reminders on the device that set them            | ✓          | ✓            | ✓       |
| Saved events and reminders across devices (sync) |            | ✓            | ✓       |

`saved.sync` is already set this way in `config/plans.json`. Paid never changes where or how an event shows.

## 8. Questions for the owner (answered 2026-11-04)

Answers: 1 (a), and the button switches views: everything, my plans, saved, private (§1); 2 (a), "I'm going" also saves; 3 (a), plain rows with RLS; 4 the estimate only, a rounded number is enough (§3); 5 the lead times as proposed, default 60 minutes, no account needed; 6 (a), the notification says the real time left, so 60 or 75 minutes ahead is fine; 7 no email: important events go into the phone's calendar.

1. **Where the agenda opens.** M7 §4 puts a "My plans" bookmark in the top-left row (after the live counter and the family shortcut) as a map filter. Options:
   - **(a) Recommended:** M10 builds that button and it opens the agenda list; M7's "only my plans on the map" becomes a toggle inside it. One entry point.
   - **(b)** The agenda lives in the settings sheet or About, and the top-left button stays M7's map filter only.
2. **Does "I'm going" also save?**
   - **(a) Recommended:** yes, marking going also bookmarks the event (and the agenda shows a "going" tag), but un-saving doesn't un-mark going. People who say they're going expect to find it in their plans.
   - **(b)** No, they stay independent; the agenda still lists both.
3. **Sync: plain or encrypted?** Saved events can reveal religion (services at places of worship, M12), which is why M9 hides counts for them.
   - **(a) Recommended:** plain rows with row-level security, as accounts and "I'm going" already are; included in M13's export and deletion. Simple, works with reminders following the account.
   - **(b)** End-to-end encrypted like the planned lit-map sync (M6 §8): the server holds only ciphertext, so it can't move reminders when a start changes for synced devices. Waits for the passkey and recovery-code work, which M8 postponed.
4. **Walking times in the queue.** Estimate by default and route on tap (recommended, no quota cost), or route every leg automatically when the queue opens (closer to the truth, about 2–4 openrouteservice calls per evening viewed)?
5. **Reminders: lead times and accounts.** Are 15, 30, 60, 120 minutes and "the day before at 18:00", default 30, the right set? And should reminders work without an account (recommended: yes, a push subscription belongs to a device and needs no identity)?
6. **Timing precision.** The cron runs every 15 minutes, so a reminder can come up to 15 minutes early (we send at the run before it's due). Options:
   - **(a) Recommended:** keep the 15-minute cron and send at the last run before the time; the text says the real minutes ("Starting in 38 min").
   - **(b)** Run the cron every 5 minutes (three times the scheduled runs), or use a Durable Object alarm per reminder for exact times (a new binding and its cost to check).
7. **Email reminders.** M7 §5 offers email for new-date alerts. Should reminders also go by email for people without push (iPhone without Home Screen install), or push only?
