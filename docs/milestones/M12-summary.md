# M12 More events: what it does

Oct 29, 2026

M12 has two goals: more events on the map, and more people adding events in the app. This page describes every feature from the user's side, then what's left for the owner. The details, tests and open points of each slice are in its "Built" note in [M12-more-events.md](M12-more-events.md).

## Adding events, faster

All paths end in the same add form, the same server endpoint, the same monthly quota (15 a month free, 300 premium) and the same moderation.

| Feature                 | What the user does                                                                                                                                                                                                                                                    | Slice |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Share into Happow**   | Shares a page from another app into the installed Happow; the add form opens and fills itself from the link (an autofill, when one is left).                                                                                                                          | D     |
| **Poster photo**        | Taps "Photo of a poster" and picks or takes a photo. It's shrunk on the phone, read by Claude Haiku, and fills the form (several events: a pick-one list). Counts as an autofill; the photo isn't kept.                                                               | G     |
| **Happening here, now** | With a precise location (100 m), a card on the add form puts the pin where you are and the start at now. Only title, category, place name and price are asked; "More details" opens the rest.                                                                         | H     |
| **Add again**           | "Add again" on your events in the account card, or "Add another date" after adding: everything is copied except the date; a new start keeps the original length. Each date is its own event.                                                                          | H     |
| **Repeats weekly**      | "Repeats: Weekly" on the form: weekdays and an until date, at most 12 weeks and 24 dates. Each date is its own event and counts once against the month; it's all or nothing.                                                                                          | I     |
| **Calendar feed**       | In the account card, paste an iCal link once (up to 2). Every 6 hours its upcoming in-person events come in as yours, against the month. The first ones go to a moderator; after one is approved, later ones follow your trust. Imported events earn no premium days. | L     |

## Reasons to add, without streaks

Nothing here counts down, nags or resets. There are no daily goals, leaderboards or paid visibility.

| Feature                 | What the user sees                                                                                                                                                                                                           | Slice   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Your impact**         | Your events' opens, routes, arrivals and thanks (totals only), your level, and how each event did. Shown under the account card and after adding.                                                                            | E, F, M |
| **Levels**              | Neighbour → Local → Guide → City guide, from verified events and opens. Levels never go down.                                                                                                                                | E, F    |
| **Premium days**        | 3 days of premium for each verified event, at most 30 a month. A weekly repeat earns once; imported feed events earn nothing. Days earned during the promotion start when it ends (30 Nov 2026).                             | E, I, L |
| **Trusted contributor** | After 5 verified events with no rejection, new events skip the queue. One rejection takes the status away until an admin restores it.                                                                                        | E       |
| **Credit on the card**  | An opt-in "Added by <name>" on your community events. Off by default.                                                                                                                                                        | E, F    |
| **First added by you**  | An event where nothing happened within 75 m in 90 days gets this mark on your own card. Nobody else sees it.                                                                                                                 | M       |
| **Thanks**              | After GoThere marks an arrival at an event someone added, a one-tap Thanks. It's anonymous and counted once per device. Only the adder sees the total.                                                                       | M       |
| **District goals**      | Only when your reach is empty, the guidance card says "Nadodrze has 3 events this weekend: know something on?" with "Add it". It's never a notification.                                                                     | N       |
| **Season collections**  | While a season runs (Halloween, Christmas and markets, New Year's Eve, winter break; `config/seasons.json`), the list view shows a chip with that season's events, by time and distance. Your card counts your events in it. | N       |

## More sources

Each source is config plus an adapter with a contract test on recorded pages. Anything that would put events on the map without review starts **off**.

| Source                    | What it reads                                                                                                                                          | State                  | Slice  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------ |
| **OSM venues**            | Theatres, clubs, cinemas, libraries, community centres and places of worship from OpenStreetMap, weekly. They correct pins and feed the website check. | on                     | C1     |
| **Website check**         | Each OSM venue's website, about monthly, looking for an iCal feed, The Events Calendar's API or Event JSON-LD. Finds go to the admin's Sources tab.    | on                     | C1, C2 |
| **Venue websites**        | The sites an admin accepted, read daily.                                                                                                               | on                     | C1     |
| **Regular services**      | OSM `service_times` on places of worship become one event per service for the next 14 days, never merged.                                              | **off**                | J      |
| **Biletyna**              | Its Wrocław listing's Event JSON-LD (36 events on the recorded page).                                                                                  | **off**: confirm terms | K      |
| **City library**          | Up to 30 event pages a day, read by the AI fallback.                                                                                                   | **off**                | K      |
| **University of Wrocław** | Up to 20 event pages a day, read by the AI fallback.                                                                                                   | **off**                | K      |
| **Account feeds**         | The calendars accounts add (see above).                                                                                                                | on                     | L      |

Left out, with reasons in the spec: RSS feeds (publishing dates, not event times), KupBilecik (no city listing without JavaScript), culture centres, the opera and Teatr Polski (no event data at the checked addresses), Going and Eventim (waiting for a partner-feed answer), and free-form parish timetables (they need an LLM to read a weekly pattern).

## For moderators and the admin

- **Queue:**
  - A weekly repeat is one card with its dates, approved or rejected together.
  - Feed events say which calendar they came from, and the admin can stop that feed.
  - What trusted contributors published is listed for spot checks, with Reject.
- **Sources tab:** website-check finds with samples. Read daily, reject, resume, stop.
- **Coverage tab:**
  - The five measures now and week by week: events today, events for 7 days, districts with an event tonight, community share, accounts that added.
  - Every district with today's and this week's events, emptiest first, with a category picker.
- **Restore trust** for an account that lost it.
- **Metrics:** `pnpm metrics` prints the five measures, and the Worker saves a weekly row every Monday from 08:00. Baseline (26 Oct): 404 events for 7 days, 5 of 48 districts lit tonight, 0% community.

## What the owner still needs to do

1. **Merge in order:** #41 (I) → #42 (J) → #43 (K) → #44 (L) → #45 (M) → #46 (N) → the O PR. Each is stacked on the one before it, so after a merge GitHub moves the next one's base to `main` (if it doesn't, change the base by hand).
2. **Run "Migrate database"** for migrations 12–21. 12–15 are from slices A–E if not run yet; 16–21 are add-again, series, account feeds, places and thanks, goals and seasons, and coverage. `pnpm db:seed` loads the districts, if that hasn't been done since slice A.
3. **Switch sources on** when ready, in `config/sources.json`:
   - `worship-services`, once the OSM venues have loaded;
   - `mbp-wroclaw` and `uwr`;
   - `biletyna`, after confirming its terms.
4. **Ask Going and Eventim** for a partner feed.
5. **Fix the preview Worker's Supabase secrets and build variables.** Nothing signed in could be checked on Cloudflare previews in M12. It was checked locally with a stubbed API at 380 px, in Polish and English.

## Not checked anywhere yet

- Signed-in flows against the real Supabase.
- On a phone: a real GPS fix, a real poster read by Claude, the camera, and a real arrival.
- A real calendar through the feed job. A live run of the new crawl targets (they were tested on recorded pages).
- The four database tests for slices I, L, M and N, and the O one, which run in CI only.
- One design pass over all M12 screens, as agreed: no mockups from slice D on (owner, 2026-10-28).
