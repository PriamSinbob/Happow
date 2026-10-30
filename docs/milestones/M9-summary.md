# M9 Sharing and attendance: what it does

Oct 30, 2026

M9 has one goal: **a shared event opens in Happow itself, looks right wherever it's pasted, and shows that people are going, without anyone giving up their privacy.** All of it is free, and the person who gets a link needs no account and no install. This page describes every feature from the user's side, then what's left for the owner. The details, tests and open points of each slice are in its "Built" note in [M9-sharing-attendance.md](M9-sharing-attendance.md).

## Sharing an event

| Feature                   | What the user sees                                                                                                                                                                                                                       | Slice |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Clean links**           | Shared links look like `happow…/e/<event>`. Pasted into WhatsApp, Messenger and the like, they preview with the event's title, day and time, venue and category in the region's language, and open straight into the event's card.       | A     |
| **Preview image**         | The preview shows our own card: a small map of the districts around the place, the pin with the category glyph, the title, time and venue. Never the source's picture, no prices, no counts. An edited event gets a new image.           | B     |
| **Share sheet**           | "Share" on the card opens: **Send link** (with "title · day and time · venue"), **Share as image** (where the phone can share files, for Stories), **Copy link**, and a **QR code** big enough to scan from a screen or a printed flyer. | C     |
| **Route in Happow first** | On event and list cards, "Route in Happow" is the main button and Google Maps the plain one beside it.                                                                                                                                   | C     |
| **Links that outlive it** | An old link opens the event marked **ended**, with **On now nearby**: up to 5 live events around that place, nearest first. The link preview says "Ended" too. Hidden events read as "no longer listed".                                 | D     |
| **Opening in the app**    | On Android, an installed Happow opens shared links itself. On iPhone, links open in Safari, where everything works; a card opened from a link shows a one-line "Add to Home Screen" hint once, never again.                              | G     |

## Who's going

Everything here is anonymous (a device, never a name) and pull, not push: no notifications, no streaks, no "be the first".

| Feature                       | What the user sees                                                                                                                                                                                                             | Slice |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| **I'm going**                 | One tap on the card, again to undo. Once 5 people are going, the card says "5+ going", then 10+ and 25+. Below 5, nothing.                                                                                                     | E     |
| **Your link's count**         | Each device's shared links carry its own token. When people who came through it mark "going", the sharer sees "3 people from your link are going". No names; only the sharer sees it.                                          | E     |
| **Here, on the way, looking** | Under "I'm going": "10+ here · 5+ on the way · 25+ looking", each from 5 up. Opening a card counts as looking for 30 minutes; "Going there" counts as on the way; "I'm here" is always a tap, on arrival or near a live event. | F     |
| **Sensitive events**          | Religious events (and a protest category if one is added: `publicAttendance: false` in `config/categories.json`) never show counts or link counts. People can still mark themselves, so M11 can add a friends-only view.       | E, F  |

## What's left for the owner

1. **Apply migrations 22 and 23** to the live database, in that order. 22 draws the district map on preview images (until then the map is plain); 23 holds "I'm going" and share links (until then those buttons do nothing visible).
2. **Merge the stacked PRs in order:** #52 (spec), then #53 (A), #54 (B), #55 (C), #56 (D), #57 (E), #58 (F), #59 (G). Each is based on the one before.
3. **Check the Workers plan.** Drawing one preview image takes about 60 ms of CPU. It rendered fine on the preview Worker (three in a row), but the Free plan's limit is 10 ms per request, so on Free some first renders may fail; the link then previews without its picture (`docs/HARDENING.md`).
4. **Test on phones** through a preview link: paste a `/e/<id>` link into a chat, share as image on Android, scan the QR code, and the iOS hint in Safari.

## Not built, on purpose

- **Names on link counts** wait for M11 (accounts on both sides, the recipient's choice). The data already keeps the signed-in account with each mark.
- **The friends' view** of who's going, including for sensitive events, is M11 (brief, owner 2026-10-30).
