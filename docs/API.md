# Happow API

The contract every Happow client is built against: the Android and iOS apps, the web app (the reference client), shared-link pages and embeds. Clients talk to `/api` for all data and to Supabase Auth for sign-in, nothing else; only the Worker and the ingest job touch the database.

Shapes that the server and the TypeScript clients both name live in `packages/core/src/wire.ts` and `packages/core/src/eventRow.ts`. The native apps mirror them from this document.

## Basics

- **Base URL:** `config.app.site.url` + `/api` (today `https://happow.krasnoroda.workers.dev/api`).
- **Format:** JSON in and out. Times are ISO 8601 with offset (`2026-11-10T19:00:00Z`); form times without a zone (`2026-11-10T19:00`) are in the region's time zone. Coordinates are `{ lat, lng }`.
- **Identify the app** on every request: `x-happow-client: android/1.4.0` (or `ios/…`, `web/…`).
- **Contract version:** every answer carries `x-happow-api: 1`.
- **Sign-in:** `authorization: Bearer <Supabase access token>`. Endpoints marked 🔑 need it; 🔑? means optional (adds the account to an anonymous action). 🛡 is moderator or admin, 👑 admin only.
- **Device id:** a random id the app makes once and keeps (`deviceId`, 8–100 chars). The server stores only its salted hash. Anonymous actions (reports, "I'm going", reminders, counts) are keyed by it.
- **Caching:** public reads send `cache-control: public, max-age=…` and an `etag`; send `if-none-match` to get `304`. Everything per-account is `no-store`.
- **Embeds:** public GET reads (`area`, `places`, `events`, `district-goal`, `config`) send `access-control-allow-origin: *`.

## Errors

A failure is `{ "error": "<code>", "message": "…", …details }` with an HTTP status. Codes (`API_ERROR_CODES` in `wire.ts`):

| Code                                                                             | Status | Meaning                                                      |
| -------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `invalid_input`, `invalid_json`                                                  | 400    | The request is malformed; `message` names the field          |
| `unsafe_url`                                                                     | 400    | A link that is not public http(s)                            |
| `outside_region`                                                                 | 400    | The point is outside every configured region                 |
| `unauthorized`                                                                   | 401    | No or bad sign-in token                                      |
| `account_required`                                                               | 401    | This action needs an account                                 |
| `forbidden`                                                                      | 403    | Not allowed for this account or plan                         |
| `not_found`, `unknown_event`                                                     | 404    |                                                              |
| `already_reviewed`, `already_claimed`, `own_item`, `reminder_refused`            | 409    | State changed or not allowed twice                           |
| `page_unavailable`                                                               | 422    | Autofill could not read the page                             |
| `client_outdated`                                                                | 426    | This app build is too old; `minVersion` says which is needed |
| `activation_required`                                                            | 403    | The account still waits for its code (see Account)           |
| `rate_limited`                                                                   | 429    | Slow down                                                    |
| `quota_exceeded`                                                                 | 429    | Monthly allowance used; `kind`, `limit`, `resetsAt`          |
| `too_many_feeds`, `too_many_invitations`, `too_many_groups`, `too_many_contacts` | 429    | A per-account cap                                            |
| `photo_too_large`                                                                | 413    |                                                              |
| `photo_unavailable`, `not_configured`                                            | 503    | The feature is off or its provider is down                   |
| `auth_failed`, `email_failed`                                                    | 502    | Sign-in or email provider failed                             |
| `feed_stopped`, `name_required`, `blocked`                                       | 4xx    | See the endpoint                                             |
| `server_error`                                                                   | 500    |                                                              |

## Compatibility rules

An installed app may be months old. So:

1. **Add, never rename or remove.** New fields and endpoints are always allowed; clients ignore fields they don't know.
2. **Never change a field's meaning or type.** Add a new field instead.
3. **A breaking change** bumps `API_VERSION` in `wire.ts`, and the old shape keeps working until `config.app.native.<platform>.minVersion` passes every build that used it.
4. **To retire old builds,** raise `minVersion`: they get `426 client_outdated` on everything except `GET /api/config`, and should show "please update".

## The app's config

`GET /api/config` → regions, categories, plans, theme, map style, seasons and the app settings (`app`), from the same files the server reads (`config/*.json`), minus server-only sections. Public, cached 30 min, ETag. The app reads this at start and caches it, so a new city, category or colour reaches installed apps without a release. Category labels, theme tokens and plan entitlements all come from here.

## Events and places

The map is built on the phone from a snapshot of the area, so filters, the reach, the time line and hotspot counts need no requests.

|                                                            |                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/area?lat&lng&r[&range][&step]`                   | Every listed event within `r` of a grid point. `lat`/`lng` are snapped to `refresh.areaGridDeg`, `r` is one of `refresh.areaRadiiM` (use `areaKey()` in core). No `range`: the next `areaHours`; `range=<timeWindow id>` for 14 days or the future; `step` reads one month of the future. → `{ from, to, events: EventRow[] }`. Public, cached to the end of its step (5 min, 30 for a range). |
| `GET /api/places?lat&lng&r`                                | Places with opening hours (same grid) → `{ places: PlaceRow[] }`. "Open now" is worked out on the phone.                                                                                                                                                                                                                                                                                       |
| `GET /api/events/:id`                                      | One listed event with its long fields → `{ event: EventRow }`, 404 `unknown_event`. Public, cached `refresh.eventSeconds`.                                                                                                                                                                                                                                                                     |
| `POST /api/events/lookup {ids}`                            | The listed events among up to 500 ids (a device's plans), ended ones included → `{ events: EventRow[] }`                                                                                                                                                                                                                                                                                       |
| `POST /api/events/updates {ids}`                           | News of up to `organiser.updatesMaxIds` public events in one call (what the person saved or marked going) → `{ updates: EventUpdates[] }`: `lastPostAt`, `changedAt` (time or status changed by hand) and the newest `organiser.updatesPosts` posts. Events with no news are left out. Never cached.                                                                                           |
| `GET /api/events/:id/credit`                               | "Added by" → `{ credit: { name, level } \| null }`. Never cached.                                                                                                                                                                                                                                                                                                                              |
| `GET /api/district-goal?lat&lng&from&to[&region]`          | The district a point is in and its events in that span → `{ goal: { id, name, count } \| null }`                                                                                                                                                                                                                                                                                               |
| `GET /api/search?q&lat&lng[&region]`                       | Typo-tolerant search of upcoming events → `{ results: EventHit[] }`                                                                                                                                                                                                                                                                                                                            |
| `POST /api/follows/match {follows, regionId?, lat?, lng?}` | Followed artists' dates → `{ matches: EventHit[], nationwide: NationwideDate[] }`                                                                                                                                                                                                                                                                                                              |

**`EventRow`** (`packages/core/src/eventRow.ts`): the database's column names, snake case. Rows carry no distance (`distance_m` is null): measure from where the user is. Turn a row into the app's event the way `rowToEvent()` does: prices may arrive as numeric strings, `flag_*` is a community warning only when `flag_count > 0` (or the reason is `source_missing`), `performers` are strings in the snapshot and `{ name, externalId }` elsewhere.

## Adding and reporting

|                                                            |                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/submissions` 🔑?                                | An event from the add form (`submissionSchema` in `submissions.ts`): weekly `repeat`, `private`. → `{ id, eventId, status: published \| pending, trusted, firstPlace, … }` |
| `POST /api/autofill {url}` 🔑                              | Up to 5 prefills from a page → `{ method, url, title, events: Prefill[] }`                                                                                                 |
| `POST /api/autofill/photo {image, mediaType}` 🔑           | A poster photo (base64, shrunk on the phone to `app.extraction.photo`) → same                                                                                              |
| `POST /api/geocode {q}`                                    | An address → `{ result: { point, … } \| null }` inside the region                                                                                                          |
| `POST /api/reports {deviceId, eventId, reason, note?}` 🔑? | "Cancelled", "wrong", "inappropriate" … one per device per day                                                                                                             |
| `POST /api/places` 🔑                                      | A new place `{name, kind, point, openingHours, address?, website?}` → `{ id }`                                                                                             |
| `POST /api/places/change` 🔑                               | `{id, openingHours \| closed \| privateUntil}`                                                                                                                             |

## Going, sharing, thanks

|                                                                                   |                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `POST /api/attendance {deviceId, eventId}`                                        | Bucketed counts and this device's signals → `AttendanceView` |
| `POST /api/attendance/set {deviceId, eventId, kind, on, token?, forSeconds?}` 🔑? | `going`, `looking`, `onway`, `here`                          |
| `POST /api/share {deviceId, eventId}`                                             | A share-link token for `/e/<id>?s=<token>`                   |
| `POST /api/thanks {deviceId, eventId}`                                            | Thanks to the adder, after arriving                          |
| `POST /api/counts {deviceId, items}`                                              | Opens, routes and arrivals (totals only)                     |
| `POST /api/friends {eventId, deviceId}` 🔑 / `PUT /api/friends` 🔑                | Friends going; showing yourself                              |

## Reminders and push

|                                                             |                                                 |
| ----------------------------------------------------------- | ----------------------------------------------- |
| `GET /api/push/key`                                         | The web-push key (VAPID)                        |
| `POST /api/push/subscribe`, `/unsubscribe` 🔑?              | A web-push subscription for the device          |
| `POST /api/reminders {deviceId, eventId, lead \| null}` 🔑? | Set or clear a reminder (`app.reminders.leads`) |
| `POST /api/reminders/list {deviceId}`                       | Pending reminders                               |

Push is web push only today; native push is the first server task of the native app ([NATIVE.md](NATIVE.md)).

## Account 🔑

|                                                                                  |                                                                                    |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/auth/code-request {email, locale}`                                    | Ask for a sign-in code (with `auth.emailDelivery` `manual` or `app`); always `202` |
| `POST /api/auth/pending {email, locale}` 🔑?                                     | Sign in at once, waiting for the code → `{ session, email }` (`PendingSession`)    |
| `POST /api/auth/activate {pendingToken}`                                         | After the real sign-in: fold the waiting account in → `{ merged }`                 |
| `GET /api/me`                                                                    | Profile, plan, entitlements, this month's usage                                    |
| `PUT /api/me {locale?, termsVersion?, showName?, displayName?, friendsVisible?}` |                                                                                    |
| `DELETE /api/me`                                                                 | Delete the account                                                                 |
| `GET /api/me/export`                                                             | Everything the account holds, as a download                                        |
| `GET /api/me/submissions/:id`                                                    | The account's own form, for "add again"                                            |
| `GET /api/me/contributions`                                                      | Verified events, impact, trusted status                                            |
| `POST /api/me/saved {items}`                                                     | Plans synced across devices (`saved.sync`)                                         |
| `POST /api/me/follows {items}`, `GET/PUT /api/me/follows/alerts`                 | Follows synced; new-date alerts (premium)                                          |
| `GET/POST/DELETE /api/me/feeds[/:id]`                                            | The account's iCal feeds                                                           |
| `GET /api/me/claims`, `GET /api/me/events`                                       | Organiser claims and own events                                                    |

Sign-in itself goes to Supabase Auth directly: the email code (`/auth/v1/verify`; `auth.codeDigits` gives its shortest and longest length, 6 to 10 digits: never assume 6), Google (PKCE on the web, an ID token from Credential Manager on Android: `/auth/v1/token?grant_type=id_token`) and token refresh. The publishable key used there is public by design and unlocks nothing else.

**Signed in at once, waiting for the code.** Right after `code-request` (or Supabase's own OTP request), call `POST /api/auth/pending` and keep the session it returns: the person is signed in immediately as an account that waits for activation. The email is not proven yet, so this is a new account of its own, never the email's real one. With that session:

- `GET /api/me` answers `pending: true`, the `email` it waits for, the anonymous plan and zero quotas; `PUT /api/me {displayName, locale, termsVersion}` and `DELETE /api/me` work.
- Invitations work: `GET /api/private`, `GET /api/private/:id`, `/guests`, `/answer`, `POST /api/invitations/accept`, `POST /api/contacts/link/:token`, and the posts of a private event it is invited to. Its push subscription, reminders and "I'm going" are tied to it. Saving events never needed an account.
- Everything else that needs an account answers `403 activation_required`; 🔑? endpoints treat it as signed out.
- Sent with the waiting session's own token, `auth/pending` only changes the email it waits for (`{ email }`, no new session).

When the code is typed (or Google signs in), the app holds two sessions for a moment. It calls `POST /api/auth/activate` with the real one as the bearer and the waiting one's access token as `pendingToken`; the server moves the accepted invitations, contacts, name, accepted terms and devices to the real account and deletes the waiting one. Then the app keeps only the real session. A waiting account nobody activates is deleted after `auth.pending.keepDays`.

## Organisers, private events, contacts 🔑

Listed with their bodies at the top of `packages/api/src/organisers.ts` and `private.ts`:

- `/api/events/:id/posts`, `/mine`, `/edit`, `/reports/:rid`; `/api/posts/:id[/report]`; `/api/claims[/:id/check]`
- `/api/private[/:id[/invite|/guests|/answer|/transfer]]`, `/api/invitations/accept`, `/api/invitations/:id`
- `/api/contacts`, `/api/contacts/link[/:token]`, `/api/contacts/:id`, `/api/contacts/groups[/:id]`

`POST /api/private/:id/transfer {to}` hands a private event over: the owner gives it to one of its accepted guests (`to` is the guest's `person` id from `/guests`), who becomes the owner; the former owner stays as an accepted guest, and the guests are told. → `{ ok, ownerName, notified }`; `404` when the caller is not the owner or `to` has not accepted, `403 blocked` when that account can't take it.

`POST /api/private/:id/answer {answer}` answers your invitation: `going`, `maybe` or `declined` (`{accept}` alone still works: true is going). → `{ status, maybe }`, where a maybe is `status: "accepted"` with `maybe: true`: it keeps the event in the guest's plans, with the guest list and the updates. The event's `invitation` and each entry of `/guests` carry the same `maybe`. Guests of a private event see each other by name on `/guests`; the friends' switch does not apply there.

**Updates.** An organiser's posts are on `GET /api/events/:id/posts` (`EventPost[]`, important first); bodies are plain text, and clients make the http(s) links in them tappable. For the "!" on pins and rows, the app asks `POST /api/events/updates` for its saved and going events when it opens and every `refresh.dataMinutes`, takes `changed_at` / `last_post_at` of accepted private events from `/api/private`, and compares with when the person last opened each event's card (kept on the device). The same updates go out as push to devices that allowed it.

## Staff

- `/api/moderation[/:kind/:id]` 🛡: the queue and decisions
- `/api/admin/code-requests`, `/grants`, `/sources`, `/coverage`, `/trust`, `/feeds/:id` 👑

## Outside /api

- `/e/<id>`: a shared event: preview tags for chats, then the app. `/e/<id>/preview.png` is its 1200×630 image.
- `/c/<token>`: a contact link.
- `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`: open those links in the installed app, once `config.app.native` has the app ids.
