# Happow — the owner's launch list

Nov 5, 2026

What only the owner can do before a public launch (M13 §7). `pnpm launch:check` reads config and prints what still blocks; this page says how to clear each item. Work top to bottom: later steps need the earlier ones.

## 1. Domain and email

1. **Register the domain.** happow.app at Cloudflare Registrar (and happow.pl at a Polish registrar), after the trademark search in the brief's open questions.
2. **Point it at the Worker.** Cloudflare → the `happow` Worker → **Settings → Domains & Routes → + Add → Custom domain** → `happow.app`.
3. **A contact address.** Cloudflare → the domain → **Email → Email Routing**: forward `kontakt@happow.app` (or similar) to your mailbox.
4. **The email sender.** At [resend.com](https://resend.com): add the domain, add the DNS records it shows (Cloudflare DNS), wait for "Verified", then **API Keys → Create** (sending access only). Add it as a Worker secret named `RESEND_API_KEY` (Settings → Variables and Secrets).
5. **Config** (`config/app.json`), in one PR:
   - `site.url`: `https://happow.app`
   - `legal.contactEmail`: the new address
   - `email.provider`: `"resend"`, `email.from`: `"Happow <kontakt@happow.app>"`
   - `auth.emailDelivery`: `"app"` (codes go out by themselves; the admin panel's code tab stays for help)
6. **Supabase → Authentication → URL Configuration:** Site URL `https://happow.app`; Redirect URLs: `https://happow.app/**` only. Remove `https://*-happow.krasnoroda.workers.dev/**` (HARDENING: sign-in links may return to any preview).

## 2. The operator and the legal texts

1. **`legal.operator` and `legal.address`** in `config/app.json`: the person or company that runs Happow, as it should appear in the terms and privacy policy (the controller under GDPR).
2. **Review the drafts** in `docs/legal/` (Polish and English): ideally with a lawyer. They are built for a free service run from Poland with Supabase, Cloudflare and Anthropic as processors.
3. **Set the final `legal.termsVersion`** (a date such as `2027-01-15`). Everyone with an account accepts once more on their next visit.

## 3. Sources

`launch:check` lists every source with a `beforeLaunch` note while it is on. For each: get the consent and record it in `termsNotes` (then delete `beforeLaunch`), or set `enabled: false`.

| Source        | Before launch                                                    |
| ------------- | ---------------------------------------------------------------- |
| eBilet        | Written consent or a partner feed (email them).                  |
| wroclaw.pl/go | ARAW: consent or a feed.                                         |
| Biletyna      | Read the full terms (biletyna.pl/static/regulamin), or ask them. |
| Meetup pages  | Switch off, or move to the Meetup API (Meetup Pro). ToS §5.4.    |
| NFM           | A courtesy email (not blocking).                                 |

## 4. Cloudflare and Supabase

1. **Previews' own database** (HARDENING): create a second Supabase project for previews, and in the Worker → **Settings → Variables and Secrets → Previews**, set its URL and service-role key instead of production's.
2. **Workers Paid** ($5/month) when reminders, follow alerts or link previews are used widely: then raise `reminders.maxPerTick` and `notices.maxPerTick` to 200 and `follows.alerts.maxPerTick` to 50 (HARDENING: Free-plan CPU).
3. **Sign-in code limits:** 10 requests per hour per network and 20 per day per address (owner, 2026-11-05). Stop clearing `rate_limits` by hand.

## 5. Last

1. `earlyAccess` in `config/plans.json`: let it end, or move the date.
2. `analytics.plausibleDomain`: set it if you want visit counts (cookie-free).
3. `pnpm launch:check` shows nothing blocking. Merge, deploy, and check `/legal/terms`, `/legal/privacy`, `/crawler` on the new domain.
