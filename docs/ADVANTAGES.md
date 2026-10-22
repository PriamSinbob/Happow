# Happow — advantages

Oct 22, 2026

Why someone would use Happow over a listings site, a ticket app or Google Maps. Every item is tagged so the list stays honest:

- **Status:** `Live` = in the app today · `M6` / `M7` = specified in [M6-design](milestones/M6-design.md) / [M7-search-follow](milestones/M7-search-follow.md) · `Later` = designed, not scheduled.
- **Tier:** see [Free and paid](#free-and-paid) at the end. Unless marked otherwise, an item is free for everyone, with no account.

## Built around "now"

- **Everything on within a short walk.** Every kind of event, now, in the next hours or today, around you; 500 m by default. `Live`
- **Informal events next to ticketed ones.** Garage sales, happenings and markets sit beside concerts and theatre. `Live`
  - Official APIs: Ticketmaster, Meetup.
  - Event sites: eBilet, wroclaw.pl GO, NFM.
  - Community submissions.
  - Threads posts follow once Meta app review passes (`Later`).
- **Never an empty map.** When nothing is in reach, the app shows the nearest event and the busiest area, with one tap to widen or go. `Live`
- **One number to check.** The live counter is your street's "temperature": how many things you can still join right now. Tap it to see only those. `M6`
- **Know if you'll make it.**
  - Open-entry events (clubs, garage sales, markets, exhibitions) are never marked late.
  - Fixed-start ones (theatre, cinema, talks) show "+N min" if you'd arrive after the start. `M6`
- **Time left at a glance.** A ring around each live pin shows how long it still runs; a dotted ring means no fixed end. `M6`
- **See the evening unfold.** Drag the time line to watch events appear and end; the track shows when the busy hours are. `M6`
- **Can't decide? Roll the dice.** One tap picks something on now within reach. It learns from what you skip, on your phone only. `M6`
- **Plan from anywhere.** Long-press the map to see what's on around another spot, in walking minutes from there. `M6`

## Fair and honest

- **Every event shown equally.** No paid placement, no paid ranking, no ads on the map, no selling of location data. This is a standing rule of the project, not a setting. `Live`
- **You can see where an event comes from.** Each one has a source badge (official API, crawled site or community) and a last-verified time. Community events are marked unverified until checked. `Live`
- **Cancellations surface fast.** Events that disappear from their source are flagged "possibly cancelled". Users can report cancelled, moved or weather-hit events. A report shows on the reporter's phone at once and for everyone at the next refresh. `Live`
- **Urgency only from real time.** Rings shrink with actual time left. No fake scarcity, no streaks, no guilt mechanics. `M6`

## Intuitive, nearly wordless

- **Controls without words.**
  - The interface speaks in numbers and universal symbols (16:30, 6 min, 2 km, ●), so it reads the same in any language.
  - Event titles and places stay as text.
  - Polish and English UI. `Live`; wordless controls `M6`
- **One colour, one meaning.** If a pin is coloured, it's on right now. `M6`
- **Distance as time.** Reach is shown in walking minutes (6 min), not metres. `M6`
- **Thumb-first layout.**
  - Reach rail on the right edge, time line at the bottom, both in fixed places, so the hands learn them.
  - Haptic clicks at each step on Android. `M6`
- **Teaches itself.** No tutorial screens; controls demonstrate themselves once on first launch. `M6`
- **The map stays the screen.** Controls used to cover about a third of it; now they float at the edges, and the list opens over the map instead of replacing it. `M6`

## For families

- **Family mode.** One switch shows what suits children: kids and family events, events marked for young ages, and daytime markets, festivals and exhibitions with no age limit (marked "not confirmed"). It hides 18+ and late-evening events. Remembered on the phone; nothing about your children leaves it. `M6`
- **Age limits at a glance.** Events with an age limit carry a small "16+" or "18+" badge on the map and the card, in any mode. `M6`

## Accessible by design

- **Colour-blind ready.**
  - "On now" is carried by shape (filled vs outline) and size, not hue alone.
  - Every colour preset is checked for ≥ 3:1 contrast in both themes (WCAG 1.4.11).
  - Presets are kept clear of the map's park green and water blue. `M6`
- **E-ink usable.**
  - A Mono preset renders live pins as solid ink.
  - Nothing animates at idle, so there is no constant refresh or ghosting.
  - Even in colour mode the default violet comes out darker on greyscale panels than red would (4.5:1 vs 3.5:1). `M6`
- **High-contrast option for everyone.** Mono is free and needs no account. `M6`
- **Screen readers.** Icon-only controls carry translated labels (PL/EN). `Live`
- **Reduced motion** is respected. `M6`
- **Comfortable at night.**
  - True black background.
  - Text is soft white, not pure white, which glares for many eyes.
  - The theme follows the real sunset where you are, and you can override it. `M6`
- **Readable in daylight.** Light theme outdoors, where dark screens wash out in the sun. `M6`

## Light on battery and data

- **Few requests.** One area snapshot every 5 minutes; radius, time, filters and the live counter are all worked out on the phone. `Live`
- **GPS used sparingly.** Location is refreshed every 5 minutes or 100 m. It runs continuously only while you navigate to an event, and stops on arrival or in the background. `Live`
- **Works with weak signal.** Map tiles are cached for 7 days and the last area snapshot for 24 h. `Live`
- **No app store needed.** Install to the home screen as a PWA, on Android, iOS and desktop. `Live`
- **No idle animation; GPU-drawn pins.** Smooth with hundreds of events without burning battery. `M6`
- **True-black night saves OLED power.** Black pixels are switched off. `M6`

## Private by design

- **No account needed** for anything core. `Live`
- **Coarse location only.**
  - Location is used on the phone.
  - Area requests are rounded to a ~5 km grid.
  - Nothing is stored with an identifier. `Live`
- **Cookie-free analytics** (Plausible). `Live`
- **Your atlas stays on your phone.** Places you've explored are stored on the device. `M6`
- **Synced atlas is end-to-end encrypted.** We can't see where you've been: the key comes from your passkey, with a recovery code as backup. `Later`
- **Crowd signals stay anonymous.** "People here" counts appear only from 5 people up and expire when the event ends. They are switched off for religious and political events. `Later`

## Get there

- **Walking route in the app.**
  - Shows your live position, re-routes when you go off course and detects arrival.
  - Re-checks the event every minute, so a cancellation reaches you on the way. `Live`
- **Everyday actions.** Hand off to your maps app, add to calendar (.ics), share, save. `Live`

## Contribute

- **Add an event from a link.** Paste the event's page and the form fills itself (structured data first, AI as fallback); you only confirm. `Live`
- **Report problems** in two taps. `Live`

## Bring people along

- **Share an event, not a map pin.** A shared link opens the event in Happow, with its card and the in-app walking route; no account or install needed to open it. `Live`
- **Rich previews in WhatsApp, Messenger, X.** The preview shows the event's title, time, place and a map card instead of a generic app link. `Later`
- **Say you're going.** Tap "I'm going" on a shared event. The sharer sees how many people from their link are going, without names unless both choose to. `Later`
- **Share as an image or QR code.** A ready-made card for Instagram Stories, and a QR code for posters and flyers. `Later`
- **Old links still work.** A link to an ended event shows what's on now near that place. `Later`

## Follow the artists you like

- **Search everything coming up.** Type an artist, venue or title and see every upcoming event in the city, not just what's in reach today. Typos and missing Polish letters still match. `M7`
- **Follow without an account.** Tap ♡ on a performer; their events get a ★ on the map and float to the top of the list. The list stays on your phone. `M7`
- **Across Poland.** Followed artists playing in other Polish cities show up too (via Ticketmaster). `M7`
- **New-date alerts.** Get a push or email when a followed artist announces a date. Premium. `M7`

## Your city, lit up

- **A personal map.** The map is grey by default; your reach and the places you've actually been to glow in colour, with soft cloud-like edges. `M6`
  - Repeat visits glow brighter.
  - Nothing fades away.
  - Zooming out to city scale lifts the grey, so remote areas are always fully visible.
- **Keep it forever.** Export and import as a file with a free account. With Premium, it syncs across devices and survives phone upgrades. `Later`

## Free and paid

Map, events, filters, details and navigation are free for everyone, always. Paid features add convenience and personalisation, never visibility.

| Feature                                                             | No account | Free account | Premium |
| ------------------------------------------------------------------- | ---------- | ------------ | ------- |
| All events, map, list, filters, details, navigation, add and report | ✓          | ✓            | ✓       |
| Live counter, time line, dice, plan from anywhere                   | ✓          | ✓            | ✓       |
| Personal lit map on the device                                      | ✓          | ✓            | ✓       |
| Family mode and age markings                                        | ✓          | ✓            | ✓       |
| Search, follow artists on the phone, nationwide matches             | ✓          | ✓            | ✓       |
| Violet and Mono colour presets                                      | ✓          | ✓            | ✓       |
| Settings page, Tally red preset                                     |            | ✓            | ✓       |
| Export and import your lit map                                      |            | ✓            | ✓       |
| Encrypted lit-map sync and backup across devices and phone upgrades |            |              | ✓       |
| Extended colour presets (Magenta and future ones)                   |            |              | ✓       |
| Alerts when a followed artist announces a date; follows synced      |            |              | ✓       |

Ideas for later paid features, not decided (from the brief):

- **User features:** saved searches with alerts, a weekend planner, a walking route through several events, an offline city pack, home-screen widgets (widgets need a native wrapper).
- **Event add-ons for organisers:** timetable or lineup, live updates, photo gallery, ticket link. They enrich the event card but never change its visibility or order.
- **Ticket affiliate links:** same price for the user, disclosed on the card.

Never for sale: featured or sponsored pins, paid ranking, banner ads, location data.
