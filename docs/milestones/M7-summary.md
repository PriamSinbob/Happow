# M7 Search and followed artists: what it does

Nov 5, 2026

M7 has two goals: **find any upcoming event in the region by name, artist or place, even with typos, and follow the artists you like so their dates find you.** It works without an account; the server keeps nothing about a search or an anonymous follow list. This page describes every feature from the user's side, then what's left for the owner. The details of each slice are in its "Built" note in [M7-search-follow.md](M7-search-follow.md).

## Search

| Feature              | What the user sees                                                                                                                                                         | Slice |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **The magnifier**    | Above locate and the list button on the map. It opens the list with the search field focused. The field is also at the top of the list itself.                             | C     |
| **Typo-tolerant**    | "podsiadlo", "Podsiadło", "podsiadło dawid" and "podsaidlo" all find Dawid Podsiadło's concert. Titles and venues are searched too.                                        | B     |
| **The whole region** | Every upcoming event in Wrocław for the next 60 days, not only the map's reach or time window. An exact artist comes first, then similar names, then titles; ties by date. | A, B  |
| **Results**          | By day, with the time, venue, distance and city, and the artist that matched. A tap goes to the event on the map (or its page, when it's beyond the loaded area).          | C     |

## Following artists

| Feature                      | What the user sees                                                                                                                                                        | Slice |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Who's performing**         | Artist chips on the event card and page, each with a ♡. Names come from Ticketmaster, the venues' own pages, Claude's reading of pages, and the add form's new field.     | A, C  |
| **Follow**                   | ♡ on a chip or a search result, or the Followed screen (♡ beside the search field): type a name, paste a list one per line, remove. Up to 200, on this phone, no account. | D     |
| **★**                        | A star on the pins, cards and pages of followed artists' events. "Followed" tops the list whenever one is coming up.                                                      | D     |
| **Elsewhere in Poland**      | For artists followed from a Ticketmaster listing, their dates in other Polish cities show under Followed with the city and a link to Ticketmaster, not on the map.        | E     |
| **On every phone** (premium) | Signed in with premium, the list follows the account across devices.                                                                                                      | G     |
| **New dates** (premium)      | "Tell me when a new date is announced": a notification when a followed artist gets a new event in the region.                                                             | G     |
| **My plans**                 | One tap shows only saved events and invitations: built in M10 as the view switcher.                                                                                       | H     |

## More events

Meetup's public pages for ten Wrocław groups (tech meetups, the English speakers' club, co-working) are read once a day, during private testing only (slice F).

## Privacy (GDPR)

Searches are never stored; Plausible counts that a search happened, without the text. Matching a phone's follows sends the names for that request only. With an account and alerts, the follows are stored with the account (row-level security, service role only), exported with it and deleted with it. Ticketmaster lookups are cached per artist for a day with no link to anyone.

## What's left for the owner

1. **Apply migration 27** (Actions → Database migrate + seed). Until it's in, search and follow matching answer with errors; the map works as before.
2. **Add `TICKETMASTER_API_KEY` to the Worker** (the same key as in GitHub Secrets) for dates elsewhere in Poland. Without it, follows match the region only.
3. **The two new icons** are Tabler's heart (♡, follow) and star (★, a followed artist's event), as they are. They need your OK (CLAUDE.md), like the M11 icons.
4. **Meetup pages are for private testing**: switch `meetup-pages` off, or move to the Meetup API, before monetising (ToS §5.4). It's in the launch checklist in M13.
5. **The consent text** for alerts: the M13 privacy policy covers follows and alerts; no separate paragraph is needed.
6. **Check after the first runs**: Ticketmaster's page count with the 60-day window against the 1,000-result cap, and the database size in Supabase after a week (§3).

## Not built, on purpose

- **Email alerts** come with the app's email sender (M13 slice E): "Also by email" appears beside the alerts once `email.provider` is set; until then, web push only.
- **Last.fm import** (dropped, §6) and Spotify import (not viable).
- **Speed testing**: no timing runs on the web build (brief, 2026-10-24); the DB test checks the index plans instead.
