# Happow — future ideas and open items

Everything not built yet, one line each: what, and why or what it waits for. Launch blockers live in [LAUNCH.md](LAUNCH.md).

## Data sources

- **Threads keyword search:** adapter built but off (`config/sources.json`); waits for Meta App Review (`threads_keyword_search`, ~500 queries / 7 days) and a legal check of social sources.
- **Logged-out Facebook event and group pages:** garage sales and local happenings; only after a legal opinion under Polish/EU law.
- **Instagram hashtags** (#wyprzedazgarazowa, #pchlitarg): ruled out for now; needs a Business account + App Review, 30 hashtags / 7 days, captions rarely give place and time, highest GDPR risk.
- **Google Places** (opening hours, popular times): last resort; paid and its terms forbid caching.
- **Ticketing partner feeds** (Going, Eventim): a business agreement, not code; ask for an affiliate or partner feed instead of crawling.
- **Google Events via SerpApi:** optional paid gap-filler; per-search pricing and needs a precise location.
- **Meetup:** decide between the API (needs Meetup Pro) and crawling public pages; verify the `gql-ext` `eventSearch` schema against the live endpoint with a real token.
- **KupBilecik:** skipped; its city listing needs JavaScript.
- **Culture centres** (CK Zamek, OKiS, Strefa Kultury), the opera, Teatr Polski: each needs a listing URL found by hand.
- **Free-form parish timetable pages:** reading a weekly pattern from prose needs an LLM.
- **RSS feeds:** left out; items carry publishing dates, not event times.
- **Nationwide results beyond Ticketmaster:** wait for more regions.
- **Photo upload on submissions:** needs storage and image moderation; the poster photo is read for autofill and discarded.
- **Batch API for crawl extraction:** halves LLM cost; synchronous calls are enough at a few dozen pages a day.
- **Prompt cache:** may silently do nothing while the system prompt is below the minimum cacheable length; check.
- **Cross-source venue merging:** venues are keyed per source; OSM linking covers only part.
- **Dedup when approving crawled items** from the moderation queue.
- **Moderator edit before approve:** today the only path is reject and re-add.
- **Per-event entry grace (`graceMin`):** no source provides it; the column exists only for overrides.
- **Data reviews on real traffic:** dedup thresholds (0.5 similarity, 30 min, 1 H3 ring) and density thresholds (r8, 5 km, 3 per hotspot, 6 chevrons) are tuned on fixtures/demo data; concert vs club-night entry; NFM events in other buildings; Ticketmaster 60-day window vs the 1,000-result cap.
- **Selector drift:** watch `source_runs.stats` (`fetched` dropping to 0) for crawled sites after redesigns.
- **Ruled out:** Eventbrite (public search shut in 2020), PredictHQ (free plan 2 locations), Last.fm import (non-commercial terms), Spotify import (5-user dev limit; extended access needs 250k MAU).

## Map and UX

- **"New since last open" bloom** on pins: moved to the native app.
- **First-launch nudge on the reach rail.**
- **Pin collision thinning:** skipped; zoom clustering keeps pins apart for now.
- **Veil and night colours on the raster fallback map:** it stays light at night and shows the dashed reach circle instead.
- **Keyboard focus for pins and edge dots:** keyboard and screen-reader users go through the list today.
- **Family glyph on pins:** only cards and lists carry it.
- **Hotspot area name** from OSM places instead of the cell's most common venue.
- **Server-side cache of density results.**
- **Design and wording pass** over all screens (atlas bar looks, category tints on list icons and chips, language codes at 10.5 px below the 11 px floor).
- **Checks to run:** 5-second test with someone new; veil redraw time and OLED smear on a mid-range phone; 14-day snapshot payload vs the 100 KB target; whether 14 days is the right "Later" length.
- **The future range at scale:** its snapshot has no end and is cut at `refresh.areaMaxEvents` (1,000, nearest first); if a busy area fills it, read it per month. Sources now look a year ahead (`ingest.lookaheadHours`): watch the run time and Ticketmaster's 1,000-result cap.
- **Open places:** restaurants, pubs, galleries and the like on the map while they are open, with the time to closing; an event there (happy hour, show, opening) takes the place over for its duration, and a private party is marked. Needs more OSM kinds, an `opening_hours` parser, a places endpoint and a pin look.
- **Real-phone checks:** iOS Safari and Android Chrome (toolbar and pills), real GPS fix and arrival, poster photo via camera, a calendar through the feed job, `/e/` links in chats, share as image, QR code, Add-to-Home-Screen hint, private invite via WhatsApp, signed-in flows and first live `generate_link` against the real Supabase.

## Accounts and premium

- **Premium purchase:** no payment provider yet (`premium.providers: []`); the purchase API (offers, provider grant changes) was removed and comes back with the first provider. Today premium comes only from early access and admin grants.
- **Payment provider recommendation:** store billing inside the native apps (Apple guideline 3.1.3(b) requires IAP on iOS, so `app-store` and `google-play` providers), Stripe with a yearly plan on the web (BLIK, cards, Google/Apple/Revolut Pay); at ~5 zł/month card fixed fees cost ~21 % vs 15 % in the stores.
- **Manage-subscription link** (`manageUrl`): comes with the first provider.
- **Pricing** and what is worth paying for: to rethink before selling.
- **E2E-encrypted atlas sync:** passkey PRF + recovery code, server holds only ciphertext (`atlas.sync: false` in every plan); tier decided with exploration/gamification work.
- **Apple sign-in:** needs a paid Apple Developer membership.
- **Email before early access ends:** none; needs the email sender.

## Notifications

- **Email channel** (alerts, invitations, claim codes): waits for the domain and sender (`email.provider: "none"`).
- **Default reminder lead in settings:** today the last lead chosen comes first.
- **Native push** replaces web push in the native app.
- **Ruled out:** email reminders (events go into the phone calendar instead); walk time in notification text (would store location on the server); pushes for anonymous bookmarks (the server doesn't know them).

## Organisers

- **Paid organiser tier:** everything is free; `organiser.infoPosts` and `organiser.publish` can move to premium by config. Schedule changes and safety notices stay free.
- **Email claim codes and invitations:** wait for the email sender.
- **Cancel one date of a series** by its adder.

## Native app

- **Native rewrite** for Play Store and App Store, reusing the server, database and API; the PWA is the reference. A new project maintains it afterwards.
- Carries over: home-screen widgets, native push, the bloom, and client speed checks (60 fps rail drag with 500 events, first pin tap under 3 s), which are measured there, not on the web build.
- **Phone tests of reminders** wait for it, since notifications may be rebuilt natively.

## Scale triggers

- **Workers Paid** when reminders, follow alerts or link previews are used widely (Free-plan CPU caps them; see LAUNCH.md §4).
- **Preview images:** draw them in the ingest job and store in R2 if Worker CPU is short; subset the two bundled Inter fonts to Latin (~0.5 MB smaller Worker).
- **Daily ingest run (~40 min):** measure where time goes (geocoder vs Nominatim at 1 s, DB round trips from the runner) before changing anything; a second region changes the budget.
- **Account card totals:** `contributions_get` sums up to 200 events per open; keep running totals or page it for very active accounts.
- **District goal:** cache at the edge per district and weekend only if the database shows load.
- **Search p95 under 300 ms at 10k events:** never timed; the DB test only checks index plans.
- **Geocoding:** self-hosted Photon if submissions grow.
- **Map tiles:** OpenFreeMap has no SLA, and the raster fallback uses tile.openstreetmap.org, not meant for production traffic.
- **Hosting path:** Supabase Pro ($25/mo, no pause) or self-hosted Postgres; Node container behind a CDN; a VPS (Hetzner from ~€5.50/mo) with BullMQ instead of GitHub Actions.
- **Abuse:** device ids are client-generated; switch `submissions.publishBeforeModeration` off if spam appears.
- **GitHub cron:** scheduled workflows are disabled in public repos after 60 days without activity; the Worker cron covers it, but keep an eye on it.

## Monetization

- **Event add-ons** for organisers (timetable or lineup, live updates, photo gallery, ticket link): enrich the card, never change its visibility or order.
- **Supporter tier ideas:** saved searches with alerts, weekend planner, a walking route through several events, offline city pack, widgets. Map, filters and details stay free.
- **Ticket affiliate links:** same price for the user, disclosed on the card.
- **Ruled out:** featured or sponsored pins, paid ranking, banner ads, selling location data; streaks, daily goals, public leaderboards, meaningless points.

## Weather

- **Weather at the spot now and at the event's end, plus official alert chips:** MET Norway primary (free, no key, identifying User-Agent, CC BY 4.0), IMGW for Polish warnings, Open-Meteo ($29/mo commercial) for 15-minute resolution, Pirate Weather as fallback.
- **Cost control:** fetch per H3 res-7 cell, cache 30 min, as a scheduled job next to ingestion (browsers can't send the User-Agent), behind a `WeatherProvider` interface; a city needs a few hundred calls a day.

## Routing

- **Arrival estimates** are straight line × 1.3 at 80 m/min; the evening queue uses the same estimates with no routing calls.
- **In-app routes** use openrouteservice (2,000/day free) with a direct-line fallback; switch providers in `navigation.routing` when the quota runs out: Geoapify (3,000/day free), Mapbox (100k/month free, then $2 per 1,000), or self-hosted Valhalla on Hetzner (Poland €8.49–15.99/mo, Europe €29–57/mo, OSM rebuilt weekly).
