# Milestone 12 — More events: scope

Oct 26, 2026

**Status:** scope draft for the owner's OK (2026-10-26). M12 moves up to come right after M8 (owner, 2026-10-26): more events on the map, and people adding events in the app, matter most now. The build session turns this into a spec with slices, gets the owner's OK on the open questions (§5), then builds slice by slice as in M6 and M8.

## 1. Why now

The map is only as good as what is on it. Today the events come from seven sources: Ticketmaster, Meetup, eBilet, wroclaw.pl GO, NFM, Threads and community submissions. That leaves gaps: small venues, churches, libraries, clubs, garage sales and one-off local happenings. M12 attacks both sides:

- **A. More sources** that cost little and run on their own (the brief's "More venue and event data").
- **B. More people adding events**, by making it fast and worth their while, within the brief's rules: no streaks, no guilt mechanics, no fake urgency, pull not push (M6 §1, `docs/ADVANTAGES.md`). Paid never buys visibility.

**How we know it worked** (measured on the server, per week, in the default region): events on the map for today and for the next 7 days, how many districts have at least one event this evening, the share of events from community submissions, and how many accounts added at least one event. The baseline is recorded before the first slice ships.

## 2. A. More sources

Each source is an adapter plus config, with a contract test on recorded fixtures (CLAUDE.md). Listed in the order I recommend building them:

1. **Venue calendar feeds (iCal / RSS).** Many venue sites publish a feed (WordPress with The Events Calendar: `?ical=1`). These feeds are structured, cheap to read and low-risk. One feed adapter reads a list of URLs from `config/sources.json`.
2. **OpenStreetMap venues (Overpass).** Theatres, clubs, cinemas, community centres, libraries and places of worship, with name, point, website and opening hours (ODbL, attribution in About). They fill the Venue table and correct venue pins. Each venue's `website` is checked once for JSON-LD events or an iCal feed. Hits go to a **source review list** for the admin, never straight to the crawler, so the crawl list stays curated.
3. **Regular services at places of worship.** From OSM `service_times` and parish pages, generated from a weekly pattern as separate events in the religious category, one per occurrence. They are never merged into one card (time-first principle).
4. **Cultural institutions and universities.** City culture centres, libraries and university calendars as crawl targets like NFM, with a feed where they offer one.
5. **More ticket sites** as JSON-LD crawl targets where their terms allow it (for example Biletyna, KupBilecik, Going). For Going and Eventim, ask for a partner feed first.
6. **Coverage view for the admin.** Events per district and category for today and the week, so the gaps are visible and the next source is chosen by data, not guesswork.

Out: Instagram, Google Places and Facebook events (no API; terms), as decided in the brief.

## 3. B. Adding events in the app: faster

The quickest way to get more community events is to make adding one take seconds, not minutes.

1. **Share into Happow.** As a PWA share target (Web Share Target API), Happow appears in the phone's share sheet. Sharing a link from Facebook, Instagram, a browser or a ticket site opens the add form already filling from that link (it uses the autofill quota).
2. **Photo of a poster.** Take or pick a photo of a poster or flyer, and Claude Haiku reads the title, time and place into the form. This suits garage sales, concerts in small venues and church fairs, which are rarely online. It counts against the autofill quota and is capped by the daily LLM limit.
3. **"Happening here" quick add.** The pin starts at your location and the start at now. A title, a category and you're done: one screen for things happening around you right now.
4. **Add again.** Repeat one of your past events with a new date, for weekly markets, open mics or regular gatherings. Each date is its own event.
5. **Recurring events by pattern** for organisers who run something weekly ("every Thursday at 19:00 until December"), stored as separate occurrences.
6. **Calendar feed import** for an account: paste an iCal URL once, and its events keep coming (the brief's "possible extras" under URL autofill). It needs a check that the feed belongs to the person, or moderation of the first batch.

## 4. B. Adding events in the app: worth it

Ideas that reward contributing and fit the brief's rules. Each is pull, not push: you see it when you look, and nothing nags you. Recommended ones are marked ★.

1. ★ **Your impact.** After adding, and in your account, you see how your events did: shown to N people on the map, opened N times, N walked there (GoThere arrivals, already measured in M6), and later "N going" (M9). Real numbers about real people beat points. The counts are totals per event, with no tracking of who saw what.
2. ★ **Premium for contributions.** Each event that passes moderation earns premium days, for example 3 days per verified event, up to 30 days a month. This uses M8's grants (`source: 'trial'` or a new `contribution`), costs nothing to run, and turns premium into a thank-you, not a paywall. It also makes the free quota feel generous, not limiting.
3. ★ **Trusted contributor.** After N verified events with no rejections, your events publish without the "Unverified" label and skip the queue. It's earned through quality, not paid for, and it saves moderation time too.
4. ★ **Fill the map: places first.** The lit map (M6 §6) already rewards exploring. Adding the first event at a place nobody has listed lights that place up for everyone, with "first added by you" on its card for you (not shown to others by default). This ties contributing to the exploration side the owner wants to grow.
5. **Contributor levels without streaks.** Levels only ever go up (Neighbour → Local → Guide → City guide), from verified events and how many people they reached. There's no daily target, nothing to lose, no countdown. The level shows on your account card and, if you opt in, on your events ("added by a Local guide").
6. **Community goals for a district.** For example: "Nadodrze has 3 events this weekend; help fill it." This appears only in the coverage gaps you look at (list empty states, the guidance card when your reach is empty), never as a notification.
7. **Season collections.** For example "Christmas markets", "Summer open-air" or "Garage sale season". Adding an event that fits puts it in a themed list everyone can browse, with your contribution counted for that season. Collections come from config.
8. **Thanks from visitors.** After GoThere arrives, a one-tap "thanks" goes to whoever added the event. The adder sees the count. It's optional and anonymous.

Not proposed: streaks, daily goals, public leaderboards (they reward volume over quality and invite spam), points with no meaning, and anything that pays for visibility.

**Guardrails:** rewards count only after moderation (or trusted status), duplicates the server merges earn nothing, and the existing quotas (15 a month free, 300 premium) stay as the spam ceiling. Any public credit needs the contributor's opt-in (privacy).

## 5. Questions for the owner (before the spec)

1. **Order.** I recommend A1 → A2 (with the source review list) → B3.1 share target → B4.1 impact → B4.2 premium for contributions → B3.2 poster photo, then the rest. Is that the right priority?
2. **Premium for contributions:** how many days per verified event, and what monthly cap? Should it also stand in for the promotion after 30 Nov 2026 until a payment provider exists?
3. **Trusted contributor:** after how many verified events (I suggest 5 with no rejections)?
4. **Public credit:** may an event show "added by <display name>" when the person opts in, or stay anonymous always?
5. **Poster photo:** is an LLM call per photo acceptable within the daily cap (about the same cost as an autofill)?
6. **Which gamification ideas go in M12** (§4), and which wait for the exploration and gamification work the owner mentioned in M8 (§6, lit-map sync)?

## 6. Depends on, and changes

- **Builds on:** M4 (crawler, autofill, moderation), M6 (lit map, GoThere arrivals, analytics), M8 (accounts, quotas, grants, admin panel).
- **Before testing on previews:** the Cloudflare preview needs its own Supabase secrets and build variables (found on 2026-10-25), or nothing signed-in can be checked there.
- **UI slices** get a mockup in `docs/design/` and the owner's OK first. The `design-review` subagent is paused until the owner asks for it again (2026-10-26).
- **Docs to update as it ships:** the brief's "More venue and event data", `docs/ADVANTAGES.md` (sources and the contributor rows in "Free and paid"), the About attribution for OSM.
