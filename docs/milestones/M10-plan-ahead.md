# Milestone 10 — Plan ahead: spec

Nov 4, 2026

Spec from the brief (Future features → Plan ahead, requested 2026-10-21) and the M10 line in the milestones list. M10 comes after M9 in the build order (brief, 2026-10-26). Build it the usual way: post each slice's plan, wait for the owner's OK, build it, then replace the "Status" line with the report.

**Status:** draft, waiting for the owner's answers to §8.

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
| A     | §1   | The agenda: saved and "going" events in one list by day, with past ones folded away    | —     | —      |
| B     | §2   | Saved events follow the account across devices (`saved.sync`)                          | A     | —      |
| C     | §3   | The evening queue: events in a row, walking times between them, overlap and "too late" | A     | —      |
| D     | §4   | Web push: subscription, keys, the sender in the Worker (no reminders yet)              | —     | —      |
| E     | §5   | Reminders before a start, on the agenda's events                                       | A, D  | —      |
| F     | §6   | Room for M11's accepted invitations in the agenda, and the M10 summary                 | A–E   | —      |

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post each slice's plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and Prettier on changed files. No live calls in CI: the push service and openrouteservice get recorded fixtures.
- On the owner's Windows checkout: commit only files with real changes (`git diff --ignore-cr-at-eol`), and write commit messages to a file.
- Previews use the **live database**: test sync and reminders on a preview with that in mind (`docs/HARDENING.md`).
- Wording waits for the text pass after the app is finished.

## 1. The agenda (slice A)

- **One list of your plans:** every event you saved or marked "I'm going", once each. Both marks stay separate on the card (saving is private and local; "going" is counted); the agenda shows a small "going" tag on the ones you marked. See §8.2 on whether "I'm going" should also save.
- **Grouped by day** in the region's time zone, with the list's day headers (M6 §13.5): "Today", "Tomorrow", then "Sat 7.11". Within a day, by start time. An event already on sits at the top of Today with its live ring.
- **Past events** fold into "Past" at the bottom, newest first, kept for 30 days (`agenda.keepPastDays`) and then dropped from the device list. Cancelled or "possibly cancelled" events stay in place, marked as on their cards, so a change of plan is visible rather than silent. Hidden events read as "no longer listed" (as M9 §4).
- **Beyond the snapshot.** The map's snapshot reaches 14 days; saved events can be further out (crawled events go up to 60 days). The agenda reads its events by id: a new `POST /api/events` taking up to 200 ids and returning the public events among them (one query on `events_public`), cached on the device like the snapshot.
- **Where it opens.** From the bookmark in the top-left row that M7 §4 places for "My plans" (see §8.1). M10 builds that button; tapping it opens the agenda as an overlay list (list style B, as the list view). M7's map filter later becomes a toggle inside the agenda ("show on map"), so there is one entry point, not two.
- **Empty.** "Nothing saved yet: tap the bookmark on an event" (the wording M7 §4 already set).
- **Each row** is the list card: glyph, title, time, venue, walk estimate from where you are now, and the bookmark to remove it. Tapping opens the event card.
- **Calendar.** "Add all to calendar" on a day downloads one `.ics` with that day's events (the existing `ics.ts`, several `VEVENT`s).
- **Free**, no account.
- **Tests.** Merging saved and going without duplicates; day grouping across midnight and the DST change; past folding and the 30-day drop; ids beyond 14 days read through `/api/events`; hidden and cancelled events.

## 2. Saved events across devices (slice B)

- **Who.** Signed in with `saved.sync` (free account and premium, per `config/plans.json`). Without an account, saved stays on the device, as today.
- **What syncs:** the saved event ids with the time each was saved or removed, and reminder choices (§5). Nothing else: no settings sync (M8, owner 2026-10-24).
- **Storage.** A `saved_events` table (account, event id, saved at, removed at), row-level security so only the account reads its rows, service role for the API. Removal keeps a tombstone for 30 days so a phone that was offline doesn't bring an event back. See §8.3 on whether this should be end-to-end encrypted like the lit map.
- **Merging.** On sign-in, the device's list and the account's list are merged (union; the latest save or removal per event wins). After that, every toggle is written through, and the agenda pulls on open and every `refresh.dataMinutes`.
- **The 200 cap** stays per account, oldest past events dropped first.
- **Signing out** keeps the device's list as it is; deleting the account deletes the rows (and M13's GDPR export includes them).
- **Tests.** The merge rules (union, latest wins, tombstones), the cap, RLS (another account reads nothing), the plan check, sign-out and delete.

## 3. The evening queue (slice C)

- **What it is.** For any day in the agenda with two or more events, a "Plan the evening" view: the events in start order, with the walk between each pair and a verdict.
- **Walk between two events** from the first one's venue to the next one's, leaving at the first one's end (or its start + `defaultDurationMin` when it has no end). By default the M6 §4.2 estimate (straight line × 1.3 ÷ 80 m/min), no API call. "Show route" on a leg asks openrouteservice once and replaces the estimate with the routed time; it counts against the same per-client limit as "Going there". See §8.4.
- **Verdicts,** from the entry model the pins already use:
  - **Overlap:** the next one starts before this one ends. Shown as "Overlaps by 40 min".
  - **Too late:** arrival (leave + walk) is after the next one's start + `graceMin` for a **fixed** event, or within 5 minutes of the end for an **open** one. Shown as "You'd arrive 15 min late" or "Closes before you'd get there".
  - **Fine:** otherwise, with the slack shown ("25 min to spare").
  - Open events (markets, exhibitions) are flexible: when an overlap involves one, the view says so ("Open until 20:00, you can leave early") rather than warning.
- **Leaving early.** Each event in the queue can take a "leave at" time (a stepper in 15-minute steps, on the device only); the walk and the next verdict use it. This is the only editing; the order is always by start time.
- **Over 45 minutes on foot** (`navigation.maxMinutes`) a leg says "Long walk" and offers the Google Maps hand-off for transit, as "Going there" does.
- **Nothing is moved or dropped for you:** the view only shows the warnings; the person decides.
- **Free**, no account.
- **Tests.** Overlap, late for fixed, closed for open, the open-event exception, leave-at changing the next verdict, no end time, a leg over the walking limit, the routed time replacing the estimate.

## 4. Web push (slice D)

Plumbing only; reminders use it in slice E and M7's new-date alerts after that.

- **Where it works.** The installed PWA on Android (and Chrome or Firefox in a browser tab); on iPhone only from the Home Screen (iOS 16.4 and later). In iOS Safari the option says "Add Happow to your Home Screen to get reminders" and links to the M9 hint.
- **Permission** is asked only when someone sets their first reminder, never on start.
- **Keys.** A VAPID key pair: the public key in config (`push.vapidPublicKey`), the private key as a secret (`VAPID_PRIVATE_KEY` in GitHub Secrets and `.env.example`), the contact as `push.contact` in config (until M13 sets the final address).
- **Subscriptions.** A `push_subscriptions` table: the endpoint and keys, the salted device hash, the account when signed in, created and last-used times. Endpoints that answer 404 or 410 are deleted; a device that turns permission off removes its row.
- **Sender.** In the Worker: RFC 8291 payload encryption and RFC 8292 VAPID with WebCrypto (no Node library), so it runs in the cron. Payloads are small: a title, a body, the event's `/e/<id>` link.
- **The service worker** shows the notification and opens the link on tap (the app turns it into the card, as for shared links).
- **Tests.** Encryption against the RFC 8291 test vectors; the VAPID header; 410 removal; the service worker's click handler opening `/e/<id>`. No live push in CI.

## 5. Reminders (slice E)

- **On any agenda event:** a bell on the card with the lead times in `reminders.leadMinutes` (config, proposed 15, 30, 60, 120 minutes and "the day before at 18:00"). One reminder per event, chosen per event; a default lead in settings (proposed 30). See §8.5.
- **What it says:** "Starting in 30 min: Title · Venue · 12 min on foot from your last location", with the walk only if location is on, from the last position the app saw. Cancelled events get "Cancelled: Title" instead, if we learn of it before the reminder time, and no reminder fires for a hidden event.
- **Scheduling.** The device sends `(event, lead)` with its push subscription to `POST /api/reminders`; the server stores `reminders` (subscription, event, fire at) and recomputes `fire at` when an event's start changes in ingest. The 15-minute cron sends what's due; see §8.6 on timing precision.
- **A start that moves** (the source changes it) moves the reminder; a start moved earlier past the reminder fires it at once with "Time changed: now 19:30".
- **Limits.** At most 50 pending reminders per device (`reminders.maxPerDevice`), rate-limited like the other device endpoints. Rows go after firing or when the event ends.
- **With an account,** reminders follow the person to their other subscribed devices (one notification per device); without one, they live on the device that set them. See §8.5 on whether reminders need an account.
- **Removing** the event from the agenda removes its reminder.
- **Tests.** Fire-at from lead and start; the cron picking due rows once; a start change moving it; earlier past the time firing with "Time changed"; cancelled and hidden; the per-device cap.

## 6. Accepted invitations and the summary (slice F)

- **Room for M11.** The agenda's source list becomes "saved ∪ going ∪ accepted invitations", with the third empty until M11. The `/api/events` read already respects visibility, so M11 only adds private events the person may see. Accepted invitations are always in the agenda and can't be un-bookmarked; declining removes them.
- **M10 summary** (`M10-summary.md`), as for M9 and M12: every feature from the user's side, and what's left for the owner (migrations, the VAPID secret, phone tests).
- **Tests.** The agenda merging a fake invitation source; nothing else changes until M11.

## 7. Free and paid after M10

| Feature                                          | No account | Free account | Premium |
| ------------------------------------------------ | ---------- | ------------ | ------- |
| Agenda, evening queue, routed legs               | ✓          | ✓            | ✓       |
| Reminders on the device that set them            | ✓          | ✓            | ✓       |
| Saved events and reminders across devices (sync) |            | ✓            | ✓       |

`saved.sync` is already set this way in `config/plans.json`. Paid never changes where or how an event shows.

## 8. Questions for the owner

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
