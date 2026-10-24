# Milestone 8 — Accounts and premium: spec

Oct 24, 2026

Spec from the brief's M8 entry (owner, 2026-10-24), M6 §8 and the brief's "Automation add-on (paid): URL autofill", with the owner's answers of 2026-10-24 (§9). M8 comes next after M6; M7 is built after M12 and then uses these accounts (M7 slice G). Build it in the usual way: plan per slice, show the plan, build, then replace the "Status" line with the report.

**Status:** in progress. Spec agreed 2026-10-24; slices A (accounts on the server), B (plans, the promotion through 30 Nov 2026, grants, the premium provider interface), C (monthly quotas for events and autofills) and D (the reach circle off the vector map) built, E–G planned. Only the payment provider is open, and it is not needed in M8.

The PWA is built feature-complete before the native rewrite (brief, 2026-10-24), so every slice is built in full, UI included. The server side (tables, SQL functions, `/api/me`, the premium provider interface) is shaped so a native client uses it unchanged. No speed testing on the web build.

An earlier draft (branch `m8-spec`, 2026-10-23, never merged) covered accounts together with a saved agenda, an add page and private events. The brief has since moved those to M10 and M11. This spec keeps that draft's sign-in methods and its entitlements-in-config design; its quotas and cohort-based early access are replaced by the owner's answers below.

## Build plan

One branch and one PR to `main` per slice, as in M6. The data and API slices come first, so the live app keeps working between PRs; the UI slices build on them. Each slice PR updates its row below and the Status line, and adds a short "Built (slice X)" note under its spec section (built, skipped, open).

| Slice | Spec     | What                                                                                                   | Needs | Status  |
| ----- | -------- | ------------------------------------------------------------------------------------------------------ | ----- | ------- |
| A     | §2       | Accounts on the server: sign-up, profiles, roles, manual code delivery, `/api/me`, export, delete      | —     | built   |
| B     | §3, §4   | Plans and entitlements in config, the early-access promotion, grants, `PremiumProvider` with `none`    | A     | built   |
| C     | §5 API   | Monthly quotas per account: events added and autofills                                                 | B     | built   |
| D     | §1       | Reach circle off the vector map; the raster fallback keeps it                                          | —     | built   |
| E     | §2–§4 UI | Mockup first. Sign-in sheet, account row in About, plan mark, premium sheet, presets and atlas by tier | A, B  | planned |
| F     | §2 admin | Admin: sign-in code requests with a ready email to send by hand                                        | A, E  | planned |
| G     | §5 UI    | The add form with sign-in, quotas and autofill usage                                                   | C, E  | planned |

D is independent and small; it can ship at any point. A payment provider (§4) is a slice of its own once the owner picks one; it is not in M8 unless added here.

### Working notes

- Read `CLAUDE.md` and `docs/BRIEF.md` first. Post each slice's detailed plan and wait for the owner's OK before building.
- Before a PR: `pnpm typecheck`, `pnpm test` and `npx prettier --check` on changed files. No live API calls in tests: Supabase Auth and the payment provider are faked; a real provider gets a contract test on recorded webhook fixtures.
- UI slices (D–G): mockup in `docs/design/` approved by the owner first, then the `design-review` subagent before the PR, with its verdict in the PR description. Slice D needs no mockup: a before/after screenshot on the Cloudflare preview (owner, 2026-10-24).
- On the owner's Windows checkout, commit only files with real changes (`git diff --ignore-cr-at-eol`).

## 1. Reach circle removed (vector map)

Owner, 2026-10-24: the dashed reach circle (outline and fill) goes. The lit veil (M6 §6) shows the reach: the current reach is always a soft lit disc with a cloudy rim, and pins outside it are faded.

- **Vector style.** `MapView` stops adding the `radius` source and the `radius-fill` / `radius-line` layers. `circleBounds` stays: fitting the view to the reach still uses it, and the veil already redraws when the reach changes.
- **Raster fallback keeps it.** The fallback (`rasterStyle()`, used when the vector style fails to load) has no veil (M6 slice H skipped it), so without the circle nothing would mark the reach. When the map falls back to raster, the radius source and layers are added as today.
- **What is accepted.** At city zoom the veil fades out (from z12.8 to nothing at z10.5), so nothing marks the reach there on the vector map. The rail shows the distance while it is dragged, and pins outside the reach stay faded.
- **Owner decisions after the design review** (2026-10-24):
  1. **Drag ring.** The veil redraws only at the rail's stops, so while the rail is dragged a bright dashed ring shows the reach under the finger, and it goes when the drag ends. Bright (night ink) on the night map; grey (day `muted`) on the day map, where white would vanish into the roads.
  2. **5 km stop.** No ring there: at 5 km the map works as a view of the whole area, so the veil fading out is fine.
  3. **No "you" dot on the map.** The overview map's centre is the user; at 5 km and above it does not matter. The dot shows only while navigating, when the route is drawn ("Going there", which already does this).
- **Spec and design text.** M6 slice H's owner decision 3 ("pins, the reach circle and the user dot stay above it") and the `docs/design/README.md` lit-map line are updated: the circle is drawn only on the raster fallback.
- **Tests.** The vector style has no `radius-*` layer; after a simulated fallback to raster it has both.
- **Built** (slice D, 2026-10-24): the vector map draws no reach circle; the veil's lit disc shows the reach. The circle moved to `apps/web/src/reachCircle.ts` and is added only when the map has no vector source, which is the raster fallback, so it appears exactly where there is no veil. It is drawn in day ink in both themes, because the raster tiles stay light at night (design review). The drag ring (decision 1) is a hidden layer on the vector map, shown only while the rail is dragged. Nothing skipped, nothing open.

## 2. Accounts

Browsing, filters, the atlas on the device and reporting stay anonymous (brief, Decisions). Adding events needs a free account (owner, 2026-10-24): the add row in the settings sheet stays visible to everyone, and tapping it signed out opens a short sheet saying adding events needs a FREE account, with sign-in right there. Adding stays free; the account is what makes the monthly limits (§5) mean something, as a device limit is easy to reset.

- **Supabase Auth over plain fetch**, as `apps/web/src/auth.ts` does today (no SDK in the bundle). It grows from moderators to everyone: public sign-up on.
- **Sign-in methods** (owner, 2026-10-23):
  - **Email with a 6-digit code.** The code matters for installed apps: on iOS a home-screen web app keeps its storage apart from Safari, so a magic link opened from Mail signs in Safari, not the installed app.
  - **Google** through `/auth/v1/authorize?provider=google` with PKCE (the code verifier in `sessionStorage` across the redirect). Test the redirect in an installed iOS app; the email code is the fallback there.
  - Apple later: it needs a paid Apple Developer Program membership.
- **How codes reach people** (owner, 2026-10-24). `auth.emailDelivery` in `config/app.json`:
  - **`"manual"` (until the domain and an email sender exist).** The app's "send me a code" calls `POST /api/auth/code-request` instead of Supabase's `/otp`, which would send through the built-in SMTP (team members only, 2 an hour). The Worker stores the request (email, language, time; rate-limited per IP and per email) and the app says the code will arrive by email from the Happow team, with the code field ready.
  - The admin panel (§2, admin) lists open requests. "Generate" calls Supabase's admin `generate_link` (type `magiclink`), which returns the 6-digit code and the sign-in link without sending anything. The panel shows a ready email in the user's language (subject, text with the code and the link) with a copy button and a `mailto:` button that opens it in the owner's mail app, filled in. The owner sends it from their own address.
  - Codes are made to last: the Supabase "Email OTP expiration" is set to 24 hours (its maximum), so a code sent by hand the same day still works. Requests are deleted once the code is used, or after 7 days.
  - **`"supabase"` (later).** Custom SMTP on the app's own domain (Resend recommended: 3,000 a month free), and the app calls `/otp` directly. Switching is the config value plus the SMTP settings in Supabase.
  - Google sign-in works in both modes and needs no email.
- **Sessions** in `localStorage` with refresh-token rotation, so an installed app stays signed in; moderators too (owner, 2026-10-24).
- **Roles.** A `role` column on the existing `moderators` table (slice A plan, owner's OK 2026-10-24; first written here as `app_metadata.role`, which only Supabase's admin API can change): `moderator` (the moderation queue) and `admin` (the owner: moderation plus the code requests and manual grants). One SQL line adds a role (`docs/SETUP.md`). The moderator sign-in screen goes; the shield row in About shows only for those roles.
- **The Worker checks the user.** One `requireUser(req)` helper: bearer token → `GET /auth/v1/user`, the result cached in memory for at most 5 minutes. Every account endpoint answers `cache-control: private, no-store`.
- **Profile.** `profiles (user_id primary key references auth.users on delete cascade, display_name null, locale, terms_version, terms_accepted_at, created_at)`, created by a trigger on `auth.users`. The display name is optional and unused in M8 (M11 shows it to invitees).
- **`GET /api/me`** returns `{ email, plan, planEndsAt, entitlements, usage: { events, autofill }, role }`, each usage as `{ used, limit, resetsAt }`. The client caches it for the session and refetches after sign-in, an added event or a plan change.
- **Consent.** At sign-up the user accepts the terms and privacy notice (one checkbox, linked texts). Until M13's final texts, an interim text names what an account stores, the quotas and the early-access terms (§4). Claude drafts it in slice E for the owner's OK (owner, 2026-10-24).
- **No settings sync** (owner, 2026-10-24). Theme, colour, language, reach, filters and family mode are preferences of a device: dark on the phone, light on a shared tablet, Polish on one and English on the other. Only a person's own content follows the account: their events (§5) now, later the lit map (§6), saved events (M10) and follows (M7).
- **Export and delete** (GDPR, for what M8 stores; M13 extends both to every later feature):
  - `GET /api/me/export`: JSON of the profile, grants, usage and the events the user added.
  - `DELETE /api/me`: deletes the auth user, which cascades to every M8 table. Events the user added stay published but lose the link to the account.
- **Row-level security** on every new table: a user reads and writes only their own rows. The Worker uses the service key, so each SQL function also takes `p_user` and filters by it; the RLS is the backstop for direct PostgREST access.
- **Tests.** Database: the profile trigger, RLS on each table (another user sees nothing), cascade on delete. Worker: 401 without a token, `no-store` on every account endpoint, `/api/me` shape, export, delete, the code-request flow with a faked `generate_link`, admin-only access to requests. Web: the OTP and PKCE flows against a faked GoTrue.
- **Built** (slice A, 2026-10-24): the server side of §2. The app looks and works as before; its screens come in slices E and F.
  - **Migration** `20261024000009_accounts.sql`. On plain Postgres (local, CI) it creates a minimal `auth.users` and `auth.uid()`, as Supabase has them, so the trigger and policies are tested the same way. `profiles` with a trigger on new users and an own-row policy; `moderators.role` (`moderator` / `admin`) and `staff_role()`; `code_requests` with one open request per email, purged after `auth.codeRequestRetentionDays` or once the person signed in after their code was made. Service-role functions: `profile_get`, `profile_update`, `account_export`, `account_forget`, `request_code`, `code_requests_list`, `code_request_get`, `code_request_mark`, `code_request_delete`.
  - **API** (`packages/api/src/accounts.ts`): `requireUser` (token checked with GoTrue, cached up to `auth.userCacheSec`), `GET`/`PUT`/`DELETE /api/me`, `GET /api/me/export` (a `happow-account-YYYY-MM-DD.json` attachment), `POST /api/auth/code-request` (rate-limited per client and per email; the same answer whether or not an account exists), and for the admin `GET /api/admin/code-requests`, `POST …/:id/generate` (creates the user if needed, then admin `generate_link`; returns the code, link, filled email and a `mailto:`) and `DELETE …/:id`. Moderation now goes through `requireUser` and the role.
  - **Config:** `auth` (delivery mode, limits, retention, code validity, cache, the email text in Polish and English) and `legal.termsVersion` (`2026-10-24-interim` until slice E's consent text).
  - **Tests:** `packages/api/test/accounts.test.ts` (13, faked Supabase); `scripts/m8.db.test.ts` (7, runs only on a local or CI database because it writes to `auth.users`).
  - **Setup** (`docs/SETUP.md`): sign-ups stay off until slice E; Email OTP Expiration 86400 s; the admin role in SQL.
  - Skipped: nothing planned for slice A. The web client still keeps sessions in `sessionStorage`; moving to `localStorage` is slice E.
  - Open: the generate flow is checked against a faked GoTrue only. Supabase's live response to `generate_link` is the first thing to try once deployed: open a code request and generate it as the admin.

## 3. Plans and entitlements

Owner, 2026-10-23: the app is partly paid. Paid never buys visibility: every public event is shown to everyone, equally (brief, Monetization).

- **Code asks for a feature, never for a plan.** `can(user, 'atlas.export')`, `quota(user, 'events.perMonth')`. A new `config/plans.json`, validated by a zod schema in core, maps plans to entitlements, so moving a feature between tiers is a config change.

  | Entitlement         | No account | Account | Premium | Used by                |
  | ------------------- | ---------- | ------- | ------- | ---------------------- |
  | `events.perMonth`   | 0          | 15      | 300     | M8 (owner, 2026-10-24) |
  | `autofill.perMonth` | 0          | 5       | 300     | M8 (owner, 2026-10-24) |
  | `presets.account`   |            | ✓       | ✓       | M8 (Tally red)         |
  | `presets.premium`   |            |         | ✓       | M8 (Magenta)           |
  | `atlas.export`      |            | ✓       | ✓       | M8 (owner, 2026-10-24) |
  | `atlas.sync`        |            | later   | later   | later (§6)             |
  | `alerts.newDates`   |            |         | ✓       | M7 slice G             |
  | `saved.sync`        |            | ✓       | ✓       | M10                    |
  | `private.create`    |            |         | ✓       | M11                    |

  Entitlements for later milestones are listed so the tiers are written down once; nothing checks them until their milestone.

- **Presets by tier.** `config/theme.json` already gives each preset a `tier`. `selectablePresets` becomes "presets the user's entitlements allow". A preset no longer allowed (signed out, plan ended) falls back to Violet; the choice is kept on the device and comes back with the entitlement.
- **Where it is checked.** The Worker resolves the plan (§4) and passes limits into the SQL functions that write (as `/api/autofill` passes `p_max` today), so quotas are checked in the same statement that counts. The client only shows or hides controls; it is never the gate.

## 4. Early access, grants and the premium provider

- **Early access is a promotion with one end date, not a cohort** (owner, 2026-10-24). Every account has premium until a fixed date, the same for everyone, so nobody has to guess whether they still fit in. `config/plans.json` → `earlyAccess: { plan: "premium", until: "2026-11-30" }`: premium through the whole of 30 November 2026, Warsaw time (owner, 2026-10-24: about five weeks from the first testers).
  - **Extending it is a config change.** The promotion is not stored per user: the Worker computes the effective plan as the highest of the user's grants and the promotion while `now < until`. Moving `until` and deploying extends it for everyone at once; the owner then announces it ("extended as a promotion").
  - **Recommendation** (asked by the owner): start with one month, as the owner suggests. Extending is free and reads as a gift; shortening is the move to avoid, and a short first term never needs it. The one hard rule: `until` must not pass before a way to buy premium exists (§4, provider), or premium features stop with nothing to buy. Until then, extend.
  - The account row shows the end date ("Premium do 30.11.2026" / "Premium until 30 Nov 2026"). No reminder emails in M8 (no email sender yet); the owner announces the end or an extension.
- **Grants** for everything else: `plan_grants (id, user_id, plan, source, provider, provider_ref, starts_at, ends_at, note, created_at)`, `source` one of `manual`, `trial`, `purchase`. The admin adds manual grants (testers, organisers) in the admin panel (slice F).
- **When premium ends, nothing made is taken away; only new use stops.**
  - Events already added stay; the monthly quotas fall back to the account's.
  - Premium presets fall back to Violet.
  - No automatic switch to a paid plan: no payment details are taken in early access, so nothing can be charged without the user choosing to buy.
- **The premium provider interface.** The provider is still open (Q10). Whatever it is, it only writes grants with `source: 'purchase'`; entitlements never ask which provider sold them, so premium bought on the web works in the native app and the other way round.

  ```ts
  interface PremiumProvider {
    id: string; // 'none' | later 'stripe', 'revolut', 'google-play', …
    offers(): Promise<Offer[]>; // what can be bought: plan, period, price, currency
    checkout?(user: UserRef, offerId: string, returnUrl: string): Promise<{ url: string }>; // web redirect
    verify?(user: UserRef, receipt: string): Promise<GrantChange[]>; // store purchase token (native)
    webhook?(req: Request): Promise<GrantChange[]>; // signed events: paid, renewed, cancelled, refunded
    manageUrl?(user: UserRef): Promise<string | null>; // where to cancel or change
  }
  ```

  - **`none`** (M8 default, `premium.providers: []` in `config/app.json`): no offers, so the app shows no buy button; premium comes from the promotion and grants.
  - Several providers can be active at once (web and Play), each writing its own grants.
  - Endpoints: `GET /api/premium/offers`, `POST /api/premium/checkout`, `POST /api/premium/verify`, `POST /api/premium/webhook/:provider`. With no provider they answer an empty list or 404.

- **What the user sees** (slice E, mockup first):
  - The account row in About shows the plan and its end with a small premium mark.
  - Gated controls are visible to signed-in users with the premium mark; tapping one without the entitlement opens a short sheet saying what it unlocks. No nagging, no counters on the map (pull, not push: M6 §1).
- **Tests.** Effective plan from grants and the promotion, at the `until` boundary and with overlapping grants; a fake provider through the interface (checkout, webhook → grant, cancel → `ends_at`, refund → grant ended); the fallbacks when premium ends.
- **Built** (slice B, 2026-10-24): §3 and §4 on the server. The app looks and works as before; presets and the plan mark come in slice E, quotas in slice C.
  - **Config:** `config/plans.json` (the entitlement table above, checked so every plan lists every entitlement and a higher plan never gives less; `atlas.sync` is off in all plans until §6), loaded by `loadConfig`. `earlyAccess` until `2026-11-30`. `premium.providers: []` in `config/app.json`.
  - **Core** (`packages/core/src/plans.ts`): `effectivePlan` (the highest of the account, the promotion and active grants; its end is the latest end of whatever gives that plan), `earlyAccessEnd` (midnight after `until` in the default region's time zone), `entitlementsFor`, `can`, `quota`, `presetsFor`.
  - **Migration** `20261024000010_plans.sql`: `plan_grants` (users read only their own; one grant per provider purchase), `grants_active`, `grants_list`, `grant_add` (by email), `grant_end` (ends now), `grant_apply` (a provider's purchase, updated in place; refuses a purchase already on another account), and `account_export` with the grants.
  - **API:** `GET /api/me` adds `plan`, `planSource` (`account`, `early_access`, `manual`, `trial`, `purchase`), `planEndsAt` and `entitlements`. Admin: `GET /api/admin/grants`, `POST /api/admin/grants {email, plan?, endsAt | null, note?}` (makes the account if needed), `DELETE /api/admin/grants/:id`. `packages/api/src/premium.ts`: the `PremiumProvider` interface, a registry by config id (empty), and the four `/api/premium/*` endpoints; a receipt only ever gives the user who sent it a plan, and checkout always returns to the app's own origin.
  - **Tests:** `packages/core/test/plans.test.ts` (11: the `until` boundary, the DST change, overlapping, open-ended, ended and future grants, config checks, presets by tier); `packages/api/test/accounts.test.ts` (+10: plans on `/api/me`, admin grants, premium with no provider and with a fake one through checkout, webhook paid/cancelled/refunded, a bad signature, verify); `scripts/m8.db.test.ts` (+3, CI database).
  - Skipped: nothing planned for slice B. `manageUrl` has no endpoint yet; the first provider slice adds it with its button.
  - Open: no way to buy premium yet (Q10). The promotion must be extended before 30 November 2026 unless a provider exists by then (§4 recommendation).

## 5. Events and autofill per account

Owner, 2026-10-24: adding events stays free. A free account adds up to 15 events a month, 5 of them with autofill (enough to show what it does); premium adds 300, all of them with autofill. The autofill code is built (M4) and switched off with `submissions.autofill: false`.

- **Quotas.** `events.perMonth` and `autofill.perMonth` (§3), counted per calendar month in the region's time zone (Europe/Warsaw) in `account_usage (user_id, month, events, autofills)`.
- **What counts.**
  - An event counts when it is submitted, whatever moderation decides; a duplicate the server merges counts too.
  - An autofill counts only when it returned at least one prefill. A page that yields nothing, a fetch error or an invalid URL is free. JSON-LD and LLM fills count alike: the user can't tell them apart.
- **Checked where it is counted.** An SQL function increments and checks in one statement, so two parallel requests can't pass the limit.
- **Endpoints.** `POST /api/submissions` and `POST /api/autofill` take the bearer token; `submissions.autofill` becomes `false | "account"`. Without autofill left, the form still works by hand.
- **Global guards stay.** `extraction.autofillLlmPerDay` remains a ceiling on LLM calls across all accounts; `submissions.autofillPerHour` (was `autofillPerHourPerClient`) is per account, against loops.
- **Usage** is in `/api/me` and on the add form: "Wydarzenia 3 / 15 · Autouzupełnienie 1 / 5" as two small meters, with the reset date when one runs out (slice G mockup).
- **Brief.** Slice C rewrites "Automation add-on (paid): URL autofill" to point here and updates `docs/ADVANTAGES.md`.
- **Tests.** Limits at the edge, only successful fills count, parallel requests at the limit, month rollover in Europe/Warsaw, premium limits, 401 where an account is required; LLM extraction stays faked.
- **Built** (slice C, 2026-10-24): §5 on the server. The app looks and works as before: adding events without an account still works, and autofill stays off until the add form signs people in (slice G).
  - **Migration** `20261024000011_usage.sql`: `account_usage` (users read only their own rows), `usage_take` (checks and counts in one statement), `usage_get`, and `submissions.user_id` (cleared when the account is deleted; the event stays). `submit_event` takes the user, month and limit: it counts and stores in one transaction, refuses past the limit with `HQ001`, and counts nothing when the insert fails. `account_export` adds monthly usage and the account's submissions.
  - **API:** `POST /api/submissions` counts against `events.perMonth` when it carries a token (a bad token is 401); signed-in users get `submissions.perHourPerAccount` (30) instead of the per-device and per-IP daily caps. `POST /api/autofill` needs an account, checks the quota before fetching the page, and counts only a fill with prefills. A used-up quota is 429 `quota_exceeded` with `kind`, `limit` and `resetsAt`. `GET /api/me` adds `usage` (month, reset time, used and limit for both). The month is worked out in the default region's time zone (`usageMonth` in core).
  - **Config:** `submissions.account: "optional"` (slice G switches it to `"required"`), `submissions.autofill: false` (slice G: `"account"`), `perHourPerAccount`, and `autofillPerHour` replacing `autofillPerHourPerClient`.
  - **Tests:** core +2 (`usageMonth` across the month, year and summer time); API +10 (both quotas at the limit, plan limits after the promotion, only fills with prefills count, no fetch once used up, a race on the last fill, anonymous and required-account submissions, a bad token, `usage` on `/api/me`); `scripts/m8.db.test.ts` +4 (the limit in SQL, a failed insert counts nothing, six parallel requests against a limit of three, RLS, export, unlink on delete).
  - **Brief:** the "Automation add-on (paid): URL autofill" section is now "URL autofill: part of accounts" and points here, and the M8 entry links to it. `docs/ADVANTAGES.md` doesn't mention autofill, so it is unchanged.
  - Skipped: nothing planned for slice C.
  - Open: none.

## 6. The lit map and accounts

- **Export and import move behind sign-in** (owner, 2026-10-24): someone without an account will never use them, and the basic app stays uncluttered. The atlas bar in About (M6 slice H) shows them only with `atlas.export`. For everyone, About keeps the lit-cell count and hold-to-clear (owner, 2026-10-24), because forgetting one's own location history should never need an account.
- **Sync is later** (owner, 2026-10-24): it waits until the exploration side of the app grows (more to gain from the lit map). The design stays as in M6 §8 (end-to-end encrypted, passkey PRF plus a recovery code, the server holding only ciphertext) with one decision taken now: **devices' counts add up** (owner, 2026-10-24), so the synced map shows the whole route walked across devices, not the busiest device. Each device then uploads only what it recorded itself, not what it imported, so a file imported on two phones isn't counted twice.
- **Owner, 2026-10-24:** sync makes little difference until the exploration and gamification side is built; whether it then runs automatically for every signed-in user or is premium is decided then.

## 7. Free and paid after M8

`docs/ADVANTAGES.md` → "Free and paid" is updated in the slice that ships each row:

| Feature                                        | No account | Free account | Premium |
| ---------------------------------------------- | ---------- | ------------ | ------- |
| Events added a month                           |            | 15           | 300     |
| …of them with autofill from a link             |            | 5            | all     |
| Tally red preset                               |            | ✓            | ✓       |
| Export and import your lit map                 |            | ✓            | ✓       |
| Extended colour presets (Magenta, future ones) |            |              | ✓       |

The "Settings page" row goes (no settings sync).

## 8. Acceptance

- The vector map shows no reach circle, except a dashed ring while the rail is dragged; the reach reads from the lit veil at street zoom; the raster fallback still draws it. The map shows no "you" dot outside "Going there".
- With manual delivery, a tester asks for a code, the owner sends it from the admin panel's ready email, and the tester signs in with it in an installed iOS home-screen app. Google sign-in works on Android and desktop.
- A new account has premium until `until`; moving `until` in config extends it for everyone.
- A free account adds 15 events a month, 5 with autofill; premium 300, all with autofill; the form shows both meters.
- Export returns everything M8 stores for the user; delete removes it.
- Lit-map export and import show only when signed in; hold-to-clear works for everyone.

## 9. Owner decisions and open questions

Decided by the owner on 2026-10-24:

1. **Quotas:** a free account adds 15 events a month, 5 with autofill; premium adds 300, all with autofill.
2. **No settings sync:** preferences belong to the device.
3. **Early access:** one end date for everyone, first set one month ahead, extended by config and announced as a promotion.
4. **Email:** manual code delivery from the admin panel until the domain and a sender exist; Google meanwhile.
5. **Atlas merge (for later sync):** devices' counts add up.
6. **Interim terms:** Claude drafts a short consent text in slice E.
7. **Reach circle slice:** before/after screenshot, no mockup.
8. **Moderators** stay signed in (`localStorage`).
9. **Atlas sync:** not in M8; later, with more exploration features.
10. **Atlas export and import:** for signed-in users only.
11. **Adding events** needs a free account; the add row says so when tapped signed out.
12. **Lit-map sync** and its tier: later, with the gamification work.
13. **Atlas bar without an account:** the cell count and hold-to-clear stay for everyone; export and import only signed in.
14. **Native apps** for both the Play Store and the App Store (brief updated).
15. **Pricing** and what is worth paying for: rethought later.

Open:

- **Q10 Payment provider.** Not needed in M8 (`none` ships); decide before the promotion stops being extended. See "Payments" below.

### Payments: what the options cost (checked 2026-10-24)

Figures from secondary sources and forum posts as well as provider pages; check the official pages before deciding.

- **Buying on the web unlocks Android and iOS for the same account.** Premium is a grant on the account (§4), whichever side sold it.
  - Google Play allows using in the app what was bought elsewhere; the app must not steer Android users to the web price except through Google's programmes.
  - Apple (App Store guideline 3.1.3(b), multiplatform services) allows it too, on one condition: the same premium must also be buyable inside the iOS app with Apple's in-app purchase. So the iOS app sells through Apple as well, and the server gets an `app-store` provider next to `google-play`.
  - In the EU, from 1 October 2026, Apple also allows a link from the app to a web checkout, at 15 % (10 % in the Small Business Program).
- **What each side keeps:**
  - Google Play, EEA from 30 June 2026: 10 % service fee plus 5 % when Play Billing processes the payment, so 15 %, with no fixed fee.
  - Apple in-app purchase: 15 % in the Small Business Program (under 1 million USD a year), no fixed fee.
  - Revolut Merchant: 1 % + 1 zł per payment. Stripe in Poland, reported: 1.5 % + 1 zł for EEA cards, 1.6 % + 1 zł for BLIK.
- **At a few złoty, the fixed złoty dominates.** At 4.99 zł a month, Revolut keeps about 1.05 zł (21 %) and Stripe about 1.07 zł (21 %), while Play or Apple keep 0.75 zł (15 %). Below about 10 zł a month the stores are cheaper than any card processor. Ways round it: a yearly price (49 zł a year loses about 1.50 zł, 3 %), or selling premium on the web only as a yearly plan and monthly inside the apps.
- **Friction.** Inside the apps, the store's own purchase is one tap with a saved card: the least friction. On the web, BLIK is what Polish users expect, and Stripe offers BLIK (recurring on request), cards, Google Pay, Apple Pay and Revolut Pay on one page.
- **Recommendation for later:** store billing inside the native apps; on the web, Stripe with a yearly plan. Revisit with pricing.
