# M10 Plan ahead: what it does

Nov 4, 2026

M10 has one goal: **the events you mean to go to are in one place, an evening of several fits together, and the phone reminds you before they start.** All of it is free and works without an account; an account only carries your list and reminders to your other devices. This page describes every feature from the user's side, then what's left for the owner. The details, tests and open points of each slice are in its "Built" note in [M10-plan-ahead.md](M10-plan-ahead.md).

## Your plans

| Feature                 | What the user sees                                                                                                                                                                                                                                          | Slice |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Views**               | A round button in the top-left row switches between **Everything** (the map as usual), **My plans** and **Saved**. Tap swaps between Everything and the last view; hold opens the picker. The choice is remembered on the phone.                            | A     |
| **The map in a view**   | Only your events show, wherever they are, still following the time line and the filters. With none at that time, a card says so and offers the list.                                                                                                        | A     |
| **The agenda**          | In a view, the list shows your events by day ("today", "tomorrow", "Sat 7.11"), a running one first, whatever the time line shows. A "Going" tag on the ones you're going to; cancelled ones marked; ended ones folded under "Past" and gone after 30 days. | A     |
| **I'm going saves**     | Marking "I'm going" also bookmarks the event, so it's in your plans.                                                                                                                                                                                        | A     |
| **Far-off events**      | Plans beyond the map's 14 days or outside the area still show: the agenda reads them by id. Events the source no longer lists show as one line with "Remove".                                                                                               | A     |
| **Day in the calendar** | A calendar button on each day puts all of that day's events into the phone's calendar in one file.                                                                                                                                                          | A     |
| **On every device**     | Signed in, your list follows you: the phone's and the account's lists merge (the latest change per event wins), and a removal on one phone removes it everywhere.                                                                                           | B     |
| **Invitations (M11)**   | The agenda has room for accepted invitations: they'll be in My plans, tagged "Invited", with no bookmark to remove them. Nothing shows until M11 adds invitations.                                                                                          | F     |

## Planning the evening

| Feature        | What the user sees                                                                                                                                                                                                               | Slice |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **The queue**  | "Plan the evening" on any day with two or more events: the events in start order, with "about 15 min on foot" between each pair (a rounded estimate, no routing calls).                                                          | C     |
| **Verdicts**   | Each step says "25 min to spare", "Just in time", "You'd arrive 15 min late", "Overlaps by 40 min" or "Closes before you'd get there". For open-entry events: "Open entry: leave by 19:20 to make it". Nothing is moved for you. | C     |
| **Leave at**   | − and + on each event, in 15-minute steps, change when you leave; the next walk and verdict follow. Kept on the phone.                                                                                                           | C     |
| **Long walks** | Over 45 minutes on foot: "Long walk" and "Transit in Google Maps".                                                                                                                                                               | C     |

## Reminders

| Feature               | What the user sees                                                                                                                                                                                                                              | Slice |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **The bell**          | On the page of a saved event that hasn't started: 15 or 30 minutes, 1 or 2 hours before, or the evening before at 18:00. 1 hour is offered first; after that, the last one you chose. No account needed.                                        | E     |
| **Permission**        | Asked only when you set your first reminder, never on start.                                                                                                                                                                                    | D     |
| **The notification**  | Says the real time left ("Za 72 min · Klub"), since the 15-minute check can send it a bit early. A moved start sends "Zmiana godziny: teraz 19:30"; a cancelled event sends "Odwołane: …"; a hidden one sends nothing. Tapping opens the event. | D, E  |
| **Follows the event** | If the source moves the start, the reminder moves with it. Removing the event from your plans removes its reminder.                                                                                                                             | E     |
| **On every device**   | Signed in, one reminder reaches all your phones and browsers that allowed notifications, in each one's language.                                                                                                                                | E     |
| **Without push**      | On iPhone in Safari, the bell says to add Happow to the Home Screen first; where notifications are blocked or push doesn't exist, it says so. Either way it offers "Add to calendar", so the phone's calendar reminds you. No email.            | E     |

## What's left for the owner

1. **Apply migration 25** to the live database (Actions → Database migrate + seed). 24 is applied. Until 25 is in, the bell's "Remind me" fails with an error and nothing is sent.
2. **Set the push key.** Run `pnpm push:keys` and add the printed line as the Worker secret `VAPID_PRIVATE_KEY`, for production and Previews. Keep it: a new key silently cancels every existing reminder subscription.
3. **Merge the PR**, then check the preview deploy picked up slices D–F (the branch preview was still on the A–C build when last checked).
4. **Test on phones** when convenient: a reminder on Android (installed app) and on iPhone from the Home Screen. Deferred by the owner, since notifications may be rebuilt for the native apps.
5. **Workers plan.** On Free, at most 6 reminders go out per 15-minute check (10 ms of CPU); more due at once arrive up to 15 minutes later. On Workers Paid, raise `reminders.maxPerTick` (`docs/HARDENING.md`).

## Not built, on purpose

- **The walk in the notification**: it would mean storing people's location on the server. The event page it opens shows the walk.
- **A settings row for the default lead**: the last lead chosen comes first instead (owner OK, 2026-11-04).
- **Email reminders** (owner, 2026-11-04): important events go into the phone's calendar.
- **The Private view and invitations** themselves are M11; the agenda is ready for them.
