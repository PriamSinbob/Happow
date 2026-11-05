# M13 Launch readiness: what it does

Nov 5, 2026

M13 has one goal: **everything the code can do for a public launch is done, and what's left is a short, checkable list for the owner.** Nothing changes for people using the app today except the legal pages, one more "accept the terms", and the option of alerts by email once a sender is set. The details are in the "Built" notes of [M13-launch-readiness.md](M13-launch-readiness.md).

## What people see

| Feature             | What the user sees                                                                                                                                  | Slice |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Legal pages**     | Terms, privacy policy, reports and takedown, device storage: full pages in Polish and English at `/legal/…`, linked from About and the terms sheet. | A     |
| **Accept again**    | Signed-in people accept the new terms version once (the texts are drafts until the owner sets the final version).                                   | A     |
| **Codes by email**  | Once the owner turns it on: the sign-in code arrives by itself, in the person's language, instead of being mailed by hand.                          | E     |
| **Alerts by email** | Beside new-date alerts (premium): "Also by email", once the app has a sender.                                                                       | E     |
| **Export**          | "Download my data" now also includes calendar feeds, reminders, notification devices, "I'm going" marks made with the account, and reports.         | D     |

## What sites see

| Feature              | What changes                                                                                                     | Slice |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| **Fewer requests**   | The crawler asks "changed since?" and skips event pages it read recently whose events are more than a week away. | C     |
| **TDM reservations** | A page reserved for text and data mining (tdmrep.json, header or meta tag) is never sent to the AI model.        | C     |
| **A contact**        | The User-Agent names the crawler page and the contact address.                                                   | B, C  |

## Behind the scenes

- The site's address, contact and operator are written once, in config; a test fails if code names a domain or a personal mailbox (B).
- Every account table is in the export, enforced by a test that also checks deletion (D).
- Feed addresses are checked on every fetch, feeds are capped at 2 MB, known feed events skip the geocoder, coverage counts each event once (and no longer counts private events), the district goal is asked once per spot and weekend, and the Worker is about half a megabyte lighter (F).
- `pnpm launch:check` lists what still blocks a launch; CI prints it on every run (G).

## What's left for the owner

1. **Apply migration 28** (Actions → Database migrate + seed), with migration 27 from M7.
2. **Work through [docs/LAUNCH.md](../LAUNCH.md)**: the domain and contact address, the email sender, Supabase redirect URLs, the operator's name and address, a review of the legal drafts, the four sources with a `beforeLaunch` note, previews' own database, and Workers Paid when traffic needs it. `pnpm launch:check` shows what's left; today it lists 11 blockers, all of them settings or decisions.
3. **Confirm** the sign-in code limits stay at 5 per hour per network and 3 per day per address, with no staff bypass.

## Not built, on purpose

- **An edge cache for the district goal**: the app caches it instead; a Worker route only if the database shows load.
- **Running totals for the account card** (HARDENING, "when accounts grow"): not needed at today's size.
- **Measuring the daily ingest run**: after a week of runs with the new politeness, as HARDENING says.
