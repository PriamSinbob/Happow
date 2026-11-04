# M11 Organisers and private events: what it does

Nov 4, 2026

M11 has two goals: **the people who run an event keep its page right and talk to visitors, and anyone can hold a private event that only the people they invite see.** Organisers are never placed or ranked differently on the map, and browsing public events stays anonymous. This page describes every feature from the user's side, then what's left for the owner. The details of each slice are in its "Built" note in [M11-organisers-private.md](M11-organisers-private.md).

## Private events

| Feature           | What the user sees                                                                                                                                                                                                                                                           | Slice |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Creating one**  | "Who sees it: Everyone / Only people I invite" on the add form. A private event is live at once, with no review. A free account has 1 a month, premium 300; either way it counts as one of the month's events.                                                               | A     |
| **Inviting**      | On the event's page, "Invite people": a link for one person, sent through WhatsApp, Messenger or a text from the share sheet (the first person to accept takes it), or contacts and whole groups. The guest list shows who said yes, who said no and which links are unused. | C     |
| **Being invited** | The event shows on your map with a lock in every view, so you don't miss it, and in the Private view. "I'm in" adds it to My plans; "Decline" removes it. A link opens the page before you sign in, then "Sign in to accept".                                                | C, D  |
| **Changes**       | When the organiser moves or cancels it, everyone who accepted and allowed notifications gets one. The agenda row says "Changed" until you open it.                                                                                                                           | C, G  |
| **Nobody else**   | Private events never appear in anyone else's map, list, counts, hotspots or shares. A link to one previews only as "Private event · Happow".                                                                                                                                 | A, D  |
| **Reports**       | Wrong details go to the organiser. Spam and unlawful content go to moderators, who can stop that account's private events.                                                                                                                                                   | D     |

## Contacts and friends

| Feature               | What the user sees                                                                                                                                                                                                                                        | Slice |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Your name**         | Set once: the name the people you invite (and who invite you) see. Nobody else does.                                                                                                                                                                      | B     |
| **Contacts**          | People join your contacts when they accept your invitation or open your contact link. No address book, no search for people. Remove or block anyone; a new link stops the old one.                                                                        | B     |
| **Groups**            | "Family", "Running club": invite a whole group at once.                                                                                                                                                                                                   | B     |
| **The friends' view** | On any event, sensitive ones included: "Ola going · Tomek here", only friends who show themselves too. "Show my friends when I'm going" in Contacts, and "Show friends I'm going to this" per event. Names behind your share links follow the same rules. | E     |

## Organisers

| Feature               | What the user sees                                                                                                                                                                                                               | Slice |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **"I organise this"** | On a public event: claim this event or everything at its venue. Put a short code on your own website and tap Check, or explain to a moderator. Then the page says "Organiser: Klub Pralnia ✓".                                   | F     |
| **Updates**           | "Post an update": a change (moves the event's time or cancels it), important (pinned and highlighted), or info. Everyone who saved it, is going, set a reminder or is there gets a notification for changes and important posts. | G     |
| **Your times stick**  | A source that later lists the old time doesn't undo the organiser's; moderators see the disagreement.                                                                                                                            | G     |
| **Editing**           | "Edit event": title, times, status, price, description, links. Organisers' edits go live at once; a contributor's waits for a moderator until they're trusted.                                                                   | H     |
| **Publishing**        | New events at a venue you organise publish at once, without the queue.                                                                                                                                                           | H     |
| **Reports**           | The organiser sees reports on their event and can answer; moderators still see the public ones with the answer. Nothing blocks an edit or a post meanwhile.                                                                      | G     |
| **Your events**       | On the account card: what you organise and your private events, with guests and open reports, and claims waiting.                                                                                                                | H     |

## Privacy (GDPR)

Export includes contacts, groups, contact links, private events, invitations sent and received, friend settings, claims, posts and edits. Deleting the account removes its private events, contacts, groups, invitations, claims and posts. Private events are deleted 30 days after they end, unused invite links when the event ends.

## What's left for the owner

1. **Apply migration 26** to the live database (Actions → Database migrate + seed). Until it's in, the add form's private switch, contacts, invitations, posts and claims answer with errors; the rest of the app works as before.
2. **Confirm the claim check (§11.3).** Public claims use a code on the organiser's own site, or a moderator. Your answer to question 3 covered private events (no moderator); say if public claims should work differently.
3. **The four new icons** are Tabler's lock, users, pencil and message, as they are, like the bell in M10. The Private view now uses the lock instead of M10's shield. They need your OK (CLAUDE.md).
4. **The consent text.** The terms need a paragraph on contacts, invitations and claims, and a new `legal.termsVersion` so everyone accepts once more. Draft for your OK:
   - _EN:_ "If you use contacts and private events, we store the name you choose, the people you connect with, your groups and your invitations, only to show your private events to the people you invite and your friends to each other where you both allow it. Nobody can search for you. Private events and their invitations are deleted 30 days after they end. If you claim an event as its organiser, we store your organiser name and how it was checked."
   - _PL:_ „Jeśli korzystasz z kontaktów i prywatnych wydarzeń, przechowujemy wybrane przez ciebie imię, osoby, z którymi się łączysz, twoje grupy i zaproszenia, tylko po to, by pokazać twoje prywatne wydarzenia zaproszonym, a znajomych sobie nawzajem tam, gdzie oboje na to pozwalacie. Nikt nie może cię wyszukać. Prywatne wydarzenia i zaproszenia usuwamy 30 dni po ich zakończeniu. Jeśli zgłaszasz się jako organizator wydarzenia, przechowujemy nazwę organizatora i sposób weryfikacji."
5. **Test on phones** when convenient: a private event with an invite link sent through WhatsApp to a second phone, and an organiser's schedule change reaching a phone with a reminder.

## Not built, on purpose

- **Email invitations and email claim codes** (owner, 2026-11-04): links through messengers first; email waits for the app's own sender.
- **A paid organiser tier** (§11.5): everything organisers do is free for now; `organiser.infoPosts` and `organiser.publish` in `config/plans.json` can move to premium later.
- **Pushes to anonymous bookmarks:** a bookmark kept only on a phone without an account is unknown to the server, so that phone sees the change on the card but gets no notification.
