# Milestone 11 — Organisers and private events: spec

Nov 4, 2026

Spec from the brief (Future features → Organiser updates on the event page, Private events with invitations, and "Organiser self-service" under More venue and event data) and the friends' view promised in M9 §6. M11 comes after M10 in the build order (brief, 2026-10-26). Build it the usual way: post each slice's plan, wait for the owner's OK, build it, then replace the "Status" line with the report.

**Status:** spec approved, §11 answered by the owner on 2026-11-04 (one point on public claims to confirm, §11.3); next: slice A's plan.

Goal: **the people who run an event can keep its page right and talk to visitors, and anyone can hold a private event that only their invitees see.** Two halves that share accounts and nothing else: organisers (claims, updates, publishing) work on public events, private events and contacts work for small groups of people who already know each other. The brief's rules hold: no streaks, no fake urgency, pull not push, paid never buys visibility, and browsing public events stays anonymous. No new data sources.

## What exists

- **Accounts** (M8): Supabase Auth over plain fetch, email code (sent by hand from the admin panel while `auth.emailDelivery` is `"manual"`) and Google; `profiles` with an optional `display_name`, `show_name` (M12 credit) and `locale`; `requireUser` in the Worker; export and delete.
- **Plans** (M8): `private.create` is already in `config/plans.json`, premium only (so everyone during early access, until `earlyAccess.until`).
- **Adding events** (M8, M12): an account's submissions, the monthly quota, moderation, trusted contributors publishing at once, series, feed import per account (`account_feeds`), "add again". There is **no editing** of an event once submitted, and **no link from an event to a person**: `submissions.user_id` ties the submission, not the event.
- **Reports** (M4): one open report per device per event, moderators hide or dismiss.
- **Attendance** (M9): one row per device, event and signal, with `user_id` kept when signed in "for M11's friends' view"; counts from 5, none for `publicAttendance: false`.
- **Agenda and views** (M10): `agenda.views` in `config/app.json` (`all`, `plans`, `saved`); `invitations.ts` is an empty source of accepted invitations, already merged into My plans and tagged "Invited".
- **Web push and reminders** (M10): reminders already send "start moved" and "cancelled" notices when an event changes.
- **Event pages** (M9): `/e/<id>` with preview tags; M9 §1 notes private events must get generic tags.
- **Reads.** The map and list read `events_public` (through `events_area`, `events_near`, `event_by_id`, `events_by_ids`) with the anon key. Everything public filters on `events_public`, so one `where` there keeps private events out of all of them.

## Build plan

One branch and one PR to `main` per slice, as in M9, M10 and M12. Each slice PR updates its row below and the Status line, and adds a short "Built (slice X)" note under its section. UI slices follow the existing screens (no mockups since M12 slice D, owner 2026-10-28); the design studio pass comes after everything is built.

| Slice | Spec | What                                                                                       | Needs | Status |
| ----- | ---- | ------------------------------------------------------------------------------------------ | ----- | ------ |
| A     | §1   | Private events: `visibility` and `owner_id`, kept out of every public read; creating one   | —     | —      |
| B     | §2   | Contacts and groups, and the contact link                                                  | —     | —      |
| C     | §3   | Invitations: by contact, group or link; accept, decline, revoke; edits reach invitees      | A, B  | —      |
| D     | §4   | Private events in the app: the Private view, the card, `/e/<id>` for private events        | C     | —      |
| E     | §5   | The friends' view of who's going (M9 §6), and names on link counts                         | B     | —      |
| F     | §6   | Organiser claims: an event or a venue, verified by a code on the site or by a moderator    | —     | —      |
| G     | §7   | Organiser updates on the event page: schedule change, important, info                      | F     | —      |
| H     | §8   | Organiser self-service: edit and cancel your events, publish at a claimed venue, your list | F     | —      |
| I     | §9   | GDPR for everything M11 stores (export, delete, retention), the consent text, the summary  | A–H   | —      |

The two halves are independent: A–E (private) and F–H (organisers) can be built in either order. Recommended order: A, B, C, D, E, then F, G, H, then I.

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post each slice's plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and Prettier on changed files. No live calls in CI: the claim check's page fetch and push get recorded fixtures.
- On the owner's Windows checkout: commit only files with real changes (`git diff --ignore-cr-at-eol`), and write commit messages to a file.
- Previews use the **live database**: private events and invitations made on a preview are real rows (`docs/HARDENING.md`).
- Row-level security is the rule for every new table (brief, Private events → Visibility), with service-role functions taking `p_user` for the Worker, as in M8.
- Wording waits for the text pass after the app is finished.

## 1. Private events (slice A)

- **Columns on `events`:** `visibility` (`public` / `private`, default `public`) and `owner_id` (the account that created or claimed it; null for most source events).
- **Kept out of every public read.** `events_public` gains `and e.visibility = 'public'`, so the map snapshot, `events_near`, `event_by_id`, `events_by_ids`, hotspots, density counts, chevrons, metrics, coverage, seasons, thanks and share previews never see a private event. A test lists every public reader and checks each one against a private row, so a reader added later can't forget it.
- **RLS on `events`** (the backstop for direct PostgREST access): a row is readable if it's public, or the caller (`auth.uid()`) is its owner or holds a non-revoked invitation to it. Anon reads only public.
- **Reading private events** goes through the Worker: `GET /api/private` (signed in) returns the private events the account owns or was invited to, with the invitation state, through `private_events_for(p_user)`. Same row shape as the public reads, plus `visibility`, `mine`, `invitation`.
- **Creating one.** The add form gets a **Private** switch for every account (owner, 2026-11-04): a free account creates **1 private event a month**, premium more. `private.create` becomes true for free accounts too, with a new `private.perMonth` (account 1, premium unlimited within `events.perMonth`). Past the free one, the switch says so and offers premium. A private event:
  - is written straight to `events` (trust `community`, verified, no moderation queue: only invitees see it);
  - counts against `events.perMonth` like any added event: one quota for all events (owner, 2026-11-04);
  - is never checked by a moderator: the organiser creates it and it's live (owner, 2026-11-04);
  - earns no contribution rewards, impact counts or "first place" (M12), since nobody else sees it;
  - can't come from autofill of a public listing and stay private by mistake: autofill works, but the event is a new private row, never merged with the public one by dedup (dedup skips private events both ways);
  - can be edited and cancelled by its owner (the edit form of §8, without moderation).
- **Location.** A private event still has a point (the invitees need the place). It's never in `density_cell` counts or `event_counts`.
- **Tests.** Every public reader excludes a private row; RLS (anon, another account, owner, invitee, revoked invitee); dedup ignoring private events; the add form's switch only with `private.create`; quota counting.

## 2. Contacts and groups (slice B)

- **What a contact is:** another account you've connected with. No address book import, no email lookup, no search for people (brief, Privacy: "no use of contacts for anything else").
- **How you get one:**
  - **Accepting an invitation** (§3) makes the organiser and the invitee contacts of each other.
  - **Your contact link** (`/c/<token>`): share it through the share sheet; whoever opens it and signs in can add you, and you both become contacts. A new link can be made at any time, which retires the old one.
  - Without an email sender, there is no "add by email" (§11.1).
- **Shown as** the contact's display name. Using contacts and invitations needs a display name: the first time, a one-field sheet asks for one ("How your friends see you").
- **Groups:** named lists of your contacts ("Family", "Running club"), only visible to you. A contact can be in several. Limits in config: `contacts.max` 500, `contacts.groupsMax` 20.
- **Removing a contact** removes them from your groups and from your side only; it doesn't uninvite them from events already sent (that's a revoke, §3). **Blocking** removes and stops them from adding you again through an old contact link or inviting you.
- **Tables:** `contacts (owner, contact_user, display_name_override, created_at, blocked)`, `contact_groups (id, owner, name)`, `contact_group_members (group_id, contact_user)`, `contact_links (token, owner, created_at, retired_at)`. RLS: own rows only.
- **Screen:** "Contacts" in the account card: the list, groups, your contact link (share, QR as in M9 §3, new link).
- **Free account** (§10).
- **Tests.** The contact link both ways, a retired link, blocking, groups, the limits, RLS.

## 3. Invitations (slice C)

- **Inviting** from a private event's card (owner only): pick contacts, whole groups, or make **invite links**.
  - A **contact or group** invite creates one `invitations` row per person (a group is expanded when sent; people added to the group later aren't invited automatically).
  - An **invite link** is single-use: "Invite by link" makes a token (`/e/<id>?i=<token>`) and opens the share sheet with the event's title and time. The first account that accepts it takes it; the organiser can label it ("for Ania") to know who used which. Unused links expire when the event ends.
  - Limit per event: `invitations.maxPerEvent` (200).
- **The invitee** sees a pending invitation in the Private view (§4) and on the event's card: **Accept** / **Decline**. Accepting puts it in My plans (M10 §6) and makes both of you contacts. Declining removes it from their views; they can still accept later until the event ends, from the card through the same link.
- **Revoke:** the organiser can revoke any invitation, pending or accepted; the event disappears from that person's app at the next read.
- **Edits and cancellation reach invitees:**
  - the card shows "Changed: start moved to 19:30" or "Cancelled", and the agenda row carries a dot until opened;
  - invitees who accepted, saved, marked going, are on the way or here get a push, on devices that already allow notifications (§7's audience, owner 2026-11-04); M10's "start moved" / "cancelled" text is reused.
- **What the organiser sees:** accepted, pending, declined, per person (by display name), and the used and unused links.
- **Table:** `invitations (id, event_id, inviter, invitee_user null, token null, label, status pending/accepted/declined/revoked, created_at, answered_at)`, one of `invitee_user` or `token` set. Email invites (`invitee_email`) wait for an email sender (§11.1).
- **API:** `POST /api/private/:id/invite` (contacts, groups, or `{ link: true, label }`), `POST /api/invitations/:id/answer`, `POST /api/invitations/accept-link` (token), `DELETE /api/invitations/:id` (revoke), `GET /api/private/:id/guests` (owner only). All signed in, `no-store`, rate-limited per account.
- **Tests.** Each path; a link used twice; a revoked invitee reading nothing; a blocked person can't be invited; the per-event limit; contacts created on accept; notices to reminder subscribers only.

## 4. Private events in the app (slice D)

- **The Private view** goes into `agenda.views` (`["all", "plans", "saved", "private"]`), shown only when signed in. It holds the private events you own or are invited to, pending ones first with Accept / Decline on the row.
- **My plans** gets accepted invitations through `invitations.set` (built in M10 §6).
- **On the map in Everything** (owner, 2026-11-04): every private event you own or are invited to, pending or accepted, shows with a lock on the pin, so none is missed; declined and revoked ones don't. They show in the Private view too, and in My plans once accepted. Only for that person: nobody else's map changes.
- **The card** of a private event: a lock and "Private · invited by Ania", the guest line (§5 rules for names), and no share button, no QR, no public counts, reports split (owner, 2026-11-04): "Something's wrong" (wrong time, wrong place, cancelled) goes to the organiser only, as a list on their card; **abuse or unlawful** content goes to moderators, who then see the event and can hide it or block its owner from private events.
- **Links.** `/e/<id>` for a private event: the Worker sends the generic tags ("Private event · Happow") and the generic preview image, never the title, time or place. In the app:
  - signed in and invited (or carrying a valid `?i=` token): the card;
  - otherwise: "Private event. Sign in if you were invited", with sign-in that comes back to the link.
- **Offline.** Private events are kept in the device cache only while signed in, and cleared on sign-out.
- **Tests.** The view shown only signed in; pins with the lock; the card for owner, invitee and stranger; the Worker's tags for a private id; sign-in returning to the link; sign-out clearing the cache.

## 5. The friends' view of who's going (slice E; M9 §6)

- **Friends** are your contacts (§2), both ways: you're their contact and they're yours.
- **Opt-in on both sides, two levels** (owner, 2026-11-04):
  - **an account switch**, "Show my friends when I'm going", off by default;
  - **per event** on the card, "Show friends I'm going to this", which overrides the account switch either way for that event (on for one event with the switch off, or hidden from one event with it on).
  - A friend sees you only where you're shown and they also show themselves (their switch or that event's override).
- **What it shows:** on any event card, public or private, sensitive categories included, a line "Ania and Tomek are going · Ola is here", from the M9 signals (going, on the way, here; not "looking", which is passive). No threshold: it's people you already know (M9 §6).
- **Only signals made while signed in** count, since only those carry the account (M9 slice E kept `user_id`).
- **Names on link counts** (M9 §5): "3 people from your link are going" becomes "Ania and 2 others…" when the recipient is signed in, is your contact and has the switch on.
- **Private events:** the guest list (§3) is visible to every accepted guest, regardless of the switch, as an invitation implies it; the switch governs public events.
- **Tests.** The switch both ways, a one-sided friend seeing nothing, a sensitive category showing friends but no public count, signals without an account not named, a removed or blocked contact disappearing.

## 6. Organiser claims (slice F)

- **What can be claimed:** an **event** (one event, or a series from the same source) or a **venue** (every current and future event at that venue, whatever its source).
- **Claiming** from the event card ("I organise this") or from a venue's card, signed in:
  - the organiser's public name ("Klub Pralnia", "Fundacja X"), shown on the event page;
  - **verification**, one of:
    - **a code on the site** (recommended path): the app shows `happow-claim-7F3K…`; the organiser puts it anywhere in the page at the event's `official_url` or the venue's `website` (a meta tag, a line of text, a comment); "Check" fetches that page once through the existing crawler fetch (robots respected, rate-limited) and approves when the code is there;
    - **a moderator**: a note and a link as evidence; it waits in a new "Claims" tab in the staff screen.
    - An email code to the listing's address waits for an email sender (§11.1, §11.3).
- **One organiser per event or venue** at a time; a second claim goes to a moderator. A moderator or admin can revoke a claim.
- **Shown** on the event page as "Organiser: Klub Pralnia ✓". Organisers are never ranked or placed differently on the map (paid never buys visibility).
- **Tables:** `claims (id, user_id, kind event/venue, event_id, venue_id, organiser_name, method site/moderator, code, evidence, status pending/approved/rejected/revoked, reviewed_by, created_at, decided_at)`. An approved claim sets `owner_id` on the claimed events (and on new ones at a claimed venue as they come in).
- **Tests.** The site check against fixtures (code present, absent, robots-blocked, page gone); moderator approve and reject; a second claim; revoking; a venue claim reaching a new event from ingest.

## 7. Organiser updates on the event page (slice G)

- **Who posts:** the verified organiser of that event (§6).
- **Post types** (brief):
  - **Schedule change:** new start, end or status (cancelled, postponed). It changes the event itself, so the map, list, calendar and reminders follow (§11.4 on how this beats the source's data).
  - **Important** (safety): pinned to the top, highlighted.
  - **Info:** normal posts ("Happy hour until 20:00").
- **Rules:** 280 characters, text only, no links except the event's own, no images (brief, PoC). Up to `organiser.postsPerEventPerDay` (10).
- **Loaded with the card**, not with the map (brief, battery and data): `GET /api/events/:id/posts`, cached at the edge for a minute and purged on a new post.
- **People who saved it** see a dot on the agenda row until they open the card (the agenda read returns `last_post_at`; the device keeps when it last opened each event).
- **Push** (owner, 2026-11-04): schedule changes and important posts go to everyone who shows interest in the event: saved it (synced accounts), set a reminder, marked going, on the way or here, or accepted an invitation, through M10's sender. Only to devices that already allowed notifications: this never asks for permission. Info posts send nothing. A bookmark kept only on a device without an account is unknown to the server, so that device gets the agenda dot, not a push. One push per post per device.
- **Reports:** each post can be reported; moderators see post reports in the queue and can hide a post. A hidden schedule change also restores the event's previous times.
- **Paid:** see §11.5.
- **Table:** `event_posts (id, event_id, user_id, kind schedule/important/info, text, change jsonb, created_at, hidden, report_count)`.
- **Tests.** Posting as organiser only; a schedule change moving the event and its reminders; the pinned order; the limits; reports and hiding; the cache purge.

## 8. Organiser self-service publishing (slice H)

- **Edit and cancel your events.** For an event you own (claimed, or private, or one you added once it's published):
  - verified organisers' edits publish at once; changes are logged (`event_edits`: who, when, before and after) for moderators;
  - a contributor's edit of their own added event goes through moderation unless they're trusted (M12 §5.3), as adding does;
  - cancel sets the status, keeps the event visible as cancelled until it ends, and notifies as a schedule change does (§7).
- **Publish at a claimed venue.** New events added by the venue's organiser publish at once, verified, at that venue, without the queue, and count against `events.perMonth` like any added event. The organiser's feed import (M12 §4.6) at a claimed venue skips the first-batch review too.
- **Your events.** The account card's "Your events" (M12) becomes one list: added, claimed and private, with edit, cancel, add again, posts and, for private ones, guests.
- **Sources keep running.** For a claimed event that ingest also reads, the organiser's fields win (§11.4); ingest still updates fields the organiser never touched.
- **Tests.** Edit by organiser, by trusted and untrusted contributor; the edit log; cancel; a claimed venue publishing at once; ingest not overwriting organiser fields.

## 9. GDPR, consent and the summary (slice I)

- **Export** (`GET /api/me/export`) adds contacts, groups, contact links, invitations sent and received, private events, claims, posts and edits.
- **Delete** (`DELETE /api/me`) cascades: contacts both ways, groups, invitations, private events the account owns (their invitees just lose them), claims (events stay public, unclaimed), posts (deleted). Public events edited by the account stay as they are.
- **Retention:** unused invite links go when the event ends; private events and their invitations a set time after they end (`private.keepAfterEndDays`, 30); declined invitations with the event.
- **Consent.** The interim terms (M8 §2) get a paragraph on contacts, invitations and organiser claims; `legal.termsVersion` moves, so signed-in users accept once more. Claude drafts it in this slice for the owner's OK.
- **M11 summary** (`M11-summary.md`) as for M9 and M10.

## 10. Free and paid after M11

| Feature                                                        | No account | Free account | Premium |
| -------------------------------------------------------------- | ---------- | ------------ | ------- |
| See organiser updates on an event                              | ✓          | ✓            | ✓       |
| Be invited to private events, accept, decline                  |            | ✓            | ✓       |
| Contacts, groups, the friends' view                            |            | ✓            | ✓       |
| Create private events and invite people                        |            | 1 a month    | ✓       |
| Claim events and venues, schedule changes, important posts     |            | ✓            | ✓       |
| Info posts on your events, edit and publish at a claimed venue |            | ✓            | ✓       |

Paid never changes where or how an event shows: a claimed event, a verified organiser and a premium account sit on the map exactly like every other event.

## 11. Questions for the owner (answered 2026-11-04)

Answers: 1 (a), email stays an option for later, links shared through messengers are the main way; 2 one private event a month on a free account, more on premium, one quota for all events; 3 private events aren't checked by a moderator, the organiser creates them and they're live; 4 (a); 5 (a); 6 push to everyone who saved, marked going, on the way or here, and so on; 7 private events show locked in Everything so they aren't missed, in Private, and in My plans when planned; 8 only abuse and unlawful content goes to moderators, the organiser handles the rest; 9 both, an account switch and per event.

**To confirm (§11.3):** the answer covers private events. For **claims on public events** (§6) the spec keeps the code on the organiser's site plus moderator review, because a claim changes a public page that other people rely on. Slice F's plan asks again.

1. **Email.** Codes still go out by hand (`auth.emailDelivery: "manual"`), so there's no way to send invitations or claim codes by email. Options:
   - **(a) Recommended:** M11 works without email: invitations by contact, group or a single-use link sent through the phone's share sheet (WhatsApp, Messenger, SMS), and contacts through a contact link. Email invites and email claim codes are built behind a config switch and turned on when the domain and a sender exist (Before public launch).
   - **(b)** Wait with M11's invitations until an email sender is set up (Resend on the app's domain, M8 §2).
2. **Who creates private events.** `config/plans.json` already says premium only (M8). Keep that (everyone has premium during early access), or let free accounts create a few too (for example 2 a month)? And should private events count against the monthly `events.perMonth` (recommended: yes, one quota for everything you add) or have their own?
3. **Claim verification.** Recommended: two ways in M11, the code on the event's or venue's own site (no email needed, checks that the person controls the site) and moderator review with evidence; email codes later. Or moderator review only?
4. **Schedule changes against the source.** When an organiser moves a crawled or API event, the next ingest run would put the source's time back. Options:
   - **(a) Recommended:** the organiser's fields win while the claim stands; if a source later reports a different time, moderators see a "source disagrees" note on the event, and nothing changes for users.
   - **(b)** The source wins; a schedule-change post only shows as text on the card.
5. **Organiser paid tier.** The brief says promos and extra posts are part of an organiser subscription, schedule changes and safety notices free. Options:
   - **(a) Recommended for now:** everything organisers do is free in M11, with the per-day post limit; entitlements `organiser.infoPosts` and `organiser.publish` go into `plans.json` set to true for all plans, so moving them to premium later is a config change. No separate organiser plan until pricing is rethought (M8 §9.15).
   - **(b)** Info posts and publishing at a claimed venue are premium from the start (schedule changes and important posts free).
6. **Who gets a push** for an organiser's schedule change or important post, and for a private event that changed. Recommended: only devices with a reminder set on that event (they asked to hear about it); everyone else sees the dot in the agenda and the notice on the card. Or also everyone who saved it, signed in or not?
7. **Private events on the map.** Recommended: accepted ones show in Everything (with a lock on the pin) for that person only; pending ones only in the Private view. Or private events only in the Private and My plans views, never in Everything?
8. **Reports on private events.** Recommended: "Something's wrong" goes to the organiser, and only an abuse report ("this invitation is spam or harmful") goes to moderators, who then see the event. Or every report to moderators, as for public events?
9. **The friends' view switch.** Recommended: one switch for the account, off by default, both sides needed. Or per event ("show my friends I'm going to this one")?
