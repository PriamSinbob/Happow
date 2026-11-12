# Happow native apps

Happow is an Android app first and an iOS app next, each built in its own repository against this one's API. This repository keeps the server, the database, the ingest, the config and the web app. The web app is not launched as a product: it serves shared links (`/e/<id>`), embeds on other sites, and stays the reference client, the place where every behaviour is already built and tested.

## What the native project gets from here

|                                                        | Where                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| The API, its rules and every endpoint                  | [API.md](API.md)                                                                    |
| Response shapes and error codes                        | `packages/core/src/wire.ts`, `eventRow.ts`                                          |
| Regions, categories, plans, theme, map style, settings | `GET /api/config` at start (cache it; never bundle it)                              |
| Behaviour and look                                     | [DESIGN.md](DESIGN.md), and the web app itself (`pnpm dev` works without a backend) |
| Logic that runs on the phone                           | `packages/core/src` (see below)                                                     |
| Wording, Polish and English                            | `apps/web/src/i18n/pl.ts`, `en.ts`                                                  |
| Glyphs                                                 | `apps/web/src/glyphs.ts` (SVG paths on a 24 grid)                                   |
| Map style and night colours                            | `config/map.json` (`styleUrl`, `themeLayers`), `config/theme.json`                  |

## Shared core or two apps

The phone does real work in Happow: it builds the map from the area snapshot, works out pins and their rings, the time line's bars, "open now" from opening hours, the hotspot, the dice and the agenda. That logic is about 4,000 lines of TypeScript in `packages/core`, and both apps need the same results.

**Recommended: Kotlin Multiplatform.** One shared Kotlin module holds the API client, the models and that logic; the UI is native on each platform: Jetpack Compose on Android first, SwiftUI (or Compose Multiplatform) on iOS later. It is Google's supported way to share code between Android and iOS, it keeps each app fully native (widgets, geofences, notifications and MapLibre all have first-class native APIs), and iOS later costs a UI, not a second app.

The cost is that the logic exists twice, in TypeScript here (server, web, embeds) and in Kotlin there. Hold the two together with shared test cases: inputs and expected outputs written as JSON in this repository, run by the tests on both sides.

Alternatives considered:

- **Two separate native apps** (Kotlin and Swift): the most native, but every piece of logic written three times.
- **React Native with Expo:** reuses `packages/core` as it is, one codebase for both phones. Widgets, geofencing and native push still need Kotlin and Swift modules, and the map-heavy UI runs through a bridge. A sound choice if one TypeScript codebase matters more than the most native feel.
- **Flutter:** no reuse of anything here, and a second language. Not recommended.

## First steps on the server for the native app

These are changes in this repository, made when the native app reaches them:

1. **Native push.** Reminders, follow alerts and organiser notices go out as web push only. Add a push kind to `push_subscriptions` (web or FCM, with the device token), send through Firebase Cloud Messaging (it reaches iOS too, through APNs), and keep web push for the web. The three senders already share `sendPush` in `packages/api/src/webpush.ts`; that is where the channel splits.
2. **App links.** Set `config.app.native.android.package` and the signing certificates' SHA-256 (`sha256`; Play App Signing shows them), and later `ios.appId`. The Worker then publishes `/.well-known/assetlinks.json` and `apple-app-site-association`, and `/e/` and `/c/` links open in the app.
3. **Google sign-in on Android.** Create an Android OAuth client in Google Cloud for the package and certificate, add it to Supabase's Google provider, and sign in with Credential Manager's ID token (`grant_type=id_token`). Nothing changes on the server.
4. **Retiring old builds.** Raise `native.<platform>.minVersion` in `config/app.json`; older builds get `426 client_outdated`.

## Sign-in and updates, as the web app does them

- **Signed in at once.** After the email is given, call `POST /api/auth/pending` and keep its session: invitations can be accepted right away. The code field takes `auth.codeDigits.min` to `.max` digits. After the code (or Google), call `POST /api/auth/activate` with both tokens, then drop the waiting session ([API.md](API.md), Account). Reference: `apps/web/src/auth.ts`.
- **Unseen updates.** `POST /api/events/updates` for the saved and going events, plus `changed_at` / `last_post_at` of accepted private events; compare with the time each event's card was last opened, kept on the device. Unseen: the "!" in the pin colour on the pin and the row, and the newest updates on the card. Reference: `apps/web/src/updates.ts`.

## On the phone

- **Arrival.** A geofence (`navigation.arriveM`, today 40 m) around events marked "I'm going" or saved for today, at most 100 at a time (Android's limit). Entering one offers "I'm here" and, for community events, thanks, as a notification, on the widget and on the event's card. Nothing is sent from location alone: the person taps. Background location is optional and asked for with its reason; without it, arrival shows when the app or widget is open nearby. The trip screen with an in-app route ("Going there") is not part of the native app.
- **Widgets.** What is on now in reach, the next plan, and arrival.
- **Notifications.** Reminders, followed artists' new dates, organisers' notices, invitations.
- **Speed.** 60 fps on the reach rail with 500 events; the first pin tap under 3 s.
- **Offline.** The last area snapshot and the config stay readable without a connection.

## What stays here

- The web app with everything it does today, PWA features included: it is the reference for every behaviour, the test bed for API changes, and the page behind shared links. Nothing is removed from it.
- Server, database, ingest, config, moderation and admin.
