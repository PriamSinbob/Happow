# Privacy policy

Version {{termsVersion}}. Draft for review before the public launch.

## 1. Controller

{{operator}}, {{address}}. Contact for anything about your data: {{contactEmail}}.

## 2. Without an account

- No cookies, no advertising, no tracking across sites.
- Your location is used on your phone to show what's near you. It is never stored with anything that identifies you. A request for the map sends a rounded area, not your position.
- To limit abuse (adding, reports, searches), we keep a salted hash of a random device id and of your IP address for the length of each limit (from an hour to a day). The hash can't be turned back into the id or the address.
- Your preferences, the lit map (atlas), saved events, reminders you set and the artists you follow are kept in your browser (see [device storage](/legal/storage.en)).
- **Search:** what you type is sent to our server to answer and is not stored. If analytics are on, we count that a search happened, without the text.
- **Followed artists:** to find their events, the names are sent with the request and not kept.
- **Notifications:** if you allow them, your browser's push address is stored with the hashed device id and the reminders you set.
- **"I'm going", "on the way", "here"** are stored with the hashed device id, and deleted {{attendanceKeepHours}} hours after the event ends.

## 3. With an account

We process: your email address (and your Google account id if you sign in with Google), the name you choose to show, your plan and its history, the events you add and their moderation, rewards for added events, saved events, contacts, groups, private events and invitations, organiser claims, posts and edits, calendar feeds you add, followed artists and new-date alerts (premium), and the devices that receive your notifications.

## 4. Why, and on what basis

| Purpose                                              | Basis (GDPR)                                           |
| ---------------------------------------------------- | ------------------------------------------------------ |
| Running your account and its features                | contract, art. 6(1)(b)                                 |
| Notifications (reminders, organiser notices, alerts) | your consent, art. 6(1)(a), withdrawn by switching off |
| Preventing abuse, moderation, security               | legitimate interest, art. 6(1)(f)                      |
| Showing public events with performers and organisers | legitimate interest, art. 6(1)(f) (see §8)             |
| Legal obligations (DSA notices, records)             | art. 6(1)(c)                                           |

## 5. Who processes data for us

- **Supabase** (database and sign-in, EU region) and **Cloudflare** (hosting, the API, cache).
- **Anthropic** (Claude): reads the text of public event pages and, when you use it, a poster photo you take, to pull out the event's facts. Nothing is kept by us beyond the facts; Anthropic doesn't train on API data.
- **The email provider**, once we send emails ourselves (sign-in codes, alerts).
- **Plausible**, only if analytics are on: cookie-free, no personal data.
- **OpenStreetMap** tile servers and **openrouteservice** see your device's IP address when they draw the map and walking routes.
- Transfers outside the EEA (Cloudflare, Anthropic) rely on the EU–US Data Privacy Framework or standard contractual clauses.

## 6. How long

- Account data: until you delete the account; then it's deleted at once, except what we must keep by law.
- Sign-in code requests: {{codeRequestRetentionDays}} days.
- Private events and their invitations: {{privateKeepDays}} days after they end.
- Ended saved events leave your agenda after {{agendaKeepPastDays}} days.
- Sent new-date alerts: 30 days.
- Public events you added stay as long as they're useful on the map; deleting your account removes your name from them.

## 7. Your rights

Access, correction, deletion, restriction, portability and objection. Export and delete your account yourself in About → Account; for anything else, write to {{contactEmail}}. You can complain to the Polish supervisory authority, the President of the Personal Data Protection Office (UODO), ul. Stawki 2, 00-193 Warszawa.

## 8. People named in public event listings (art. 14 GDPR)

Happow shows public events from ticket sites, venues' and organisers' own pages and Meetup group pages. When an event names a performer or an organiser who is a person, we show that name as it was published, to say who performs or organises. We don't build profiles, store photos of people, or collect anything else about them.

- **Source:** the public listing the event links to.
- **Purpose and basis:** informing the public about events; legitimate interest (art. 6(1)(f)).
- **How long:** while the event is listed, plus the time it stays in the archive of ended events.
- **Your right to object:** write to {{contactEmail}}; we remove or anonymise the name within 48 hours unless the listing is yours to keep as an organiser.

## 9. Changes

When this policy changes, the app asks signed-in people to accept the new version.
