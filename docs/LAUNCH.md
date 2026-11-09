# Happow — launch list

What has to happen before a public launch. `pnpm launch:check` reads config and prints what still blocks; this page says how to clear each item. Work top to bottom: later steps need the earlier ones.

## 0. Open questions

- **Brand name.** Search HAPPOW / HAPPO / HAPOW in TMview (EUIPO + UPRP), WIPO Brand DB and IP Australia; consider filing "Happow" (classes 9, 35, 41, 42). happow.com is an Australian youth eLearning company (HAPPOW PTY LTD); a US "HAPPOW" mark exists in class 28 only.
- **Under the Plumbi umbrella or standalone?**
- **ARAW (wroclaw.pl/go):** ask for an events feed or a partnership, not just crawl consent (section 3).
- **Facebook public pages:** in scope at all? Only after a legal opinion under Polish/EU law.

## 1. Domain and email

_Not decided yet: the name and domain wait, and with them the contact address, the email sender and codes sent by the app. Until then `legal.contactEmail` is the owner's personal address._

1. **Register the domain.** happow.app at Cloudflare Registrar (and happow.pl at a Polish registrar), after the trademark search (section 0).
2. **Point it at the Worker.** Cloudflare → the `happow` Worker → **Settings → Domains & Routes → + Add → Custom domain** → `happow.app`.
3. **A contact address.** Cloudflare → the domain → **Email → Email Routing**: forward `kontakt@happow.app` (or similar) to your mailbox.
4. **The email sender.** At [resend.com](https://resend.com): add the domain, add the DNS records it shows (Cloudflare DNS), wait for "Verified", then **API Keys → Create** (sending access only). Add it as a Worker secret named `RESEND_API_KEY` (Settings → Variables and Secrets).
5. **Config** (`config/app.json`), in one PR:
   - `site.url`: `https://happow.app`
   - `legal.contactEmail`: the new address
   - `email.provider`: `"resend"`, `email.from`: `"Happow <kontakt@happow.app>"`
   - `auth.emailDelivery`: `"app"` (codes go out by themselves; the admin panel's code tab stays for help)
   - `ingest.userAgent`: the crawler's contact URL on the new domain
6. **Supabase → Authentication → URL Configuration:** Site URL `https://happow.app`; Redirect URLs: `https://happow.app/**` only (plus a preview pattern only if previews keep sign-in). Remove `https://*-happow.krasnoroda.workers.dev/**`: today a sign-in link can land on any branch's preview.

## 2. The operator and the legal texts

_The owner is personally responsible for Happow, possibly under their business details; the address will be on the future domain. Filled in with the domain._

1. **`legal.operator` and `legal.address`** in `config/app.json`: the person or company that runs Happow, as it should appear in the terms and privacy policy (the controller under GDPR).
2. **Review the drafts** in `docs/legal/` (Polish and English): ideally with a lawyer. They are built for a free service run from Poland with Supabase, Cloudflare and Anthropic as processors.
3. **Set the final `legal.termsVersion`** (a date such as `2027-01-15`). Everyone with an account accepts once more on their next visit.

## 3. Sources

`launch:check` lists every source with a `beforeLaunch` note while it is on. For each: get the consent and record it in `termsNotes` (then delete `beforeLaunch`), or set `enabled: false`.

| Source        | Before launch                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| eBilet        | Kept on; the owner emails eBilet for written consent or a feed before launch. Small yield, but events found nowhere else.            |
| wroclaw.pl/go | Kept on; the owner contacts ARAW. Their terms forbid reuse without written consent, so without it the source goes off before launch. |
| Biletyna      | Cleared: the full terms (28 Aug 2026) don't restrict visitors. No longer a blocker.                                                  |
| Meetup pages  | Kept while testing privately; then off, or the Meetup API (Meetup Pro). ToS §5.4.                                                    |
| NFM           | A courtesy email (not blocking).                                                                                                     |

## 4. Cloudflare and Supabase

1. **Previews' own database:** the Worker's **Previews Base** secrets are production's, so anything done on a preview (sign-ins, submissions, approvals) is real. Create a second Supabase project for previews, and in the Worker → **Settings → Variables and Secrets → Previews**, set its URL and service-role key instead of production's (or keep the service-role key out of previews).
2. **Workers Paid** ($5/month) when reminders, follow alerts or link previews are used widely: a Free-plan tick has 10 ms of CPU and one web push takes ~1.5 ms, and a preview image ~60–150 ms. Then raise `reminders.maxPerTick` and `notices.maxPerTick` to 200 and `follows.alerts.maxPerTick` to 50.
3. **Sign-in code limits:** 10 requests per hour per network and 20 per day per address, no staff bypass. Stop clearing `rate_limits` by hand.
4. **Google sign-in** (optional): [SETUP.md](SETUP.md) §1 step 5, then `auth.providers: ["google"]`.

## 5. Product checks

1. **Claim check on public events:** confirm that a claim is verified by a code on the organiser's own site, or by a moderator.
2. **Icons awaiting the owner's OK:** Tabler heart ♡ and star ★ (follows), and lock, users, pencil and message (organisers and private events; lock also replaced the shield on the Private view).
3. **Map tiles:** OpenFreeMap has no SLA and the raster fallback uses tile.openstreetmap.org; decide whether that is acceptable for public traffic.
4. **Real-phone pass** on iOS Safari and Android Chrome (list in [FUTURE.md](FUTURE.md) → Map and UX).

## 6. Last

1. `earlyAccess` in `config/plans.json`: let it end, or move the date.
2. `analytics.plausibleDomain`: set it if you want visit counts (cookie-free).
3. `pnpm launch:check` shows nothing blocking. Merge, deploy, and check `/legal/terms`, `/legal/privacy`, `/crawler` on the new domain.
