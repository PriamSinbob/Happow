# Setting up the hosted services

A checklist for taking Happow from "runs on a laptop" to "live on the internet". Everything below runs on free tiers except the Claude API, which is pay-as-you-go (cents per month at current volume, see [Claude API costs](#claude-api-costs)).

There are four accounts, and each one owns some of the secrets:

| Account                                       | What it runs                                                                  | Cost                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Supabase** (supabase.com)                   | Postgres database, email-code sign-in                                         | Free tier                                                          |
| **Cloudflare** (dash.cloudflare.com)          | Hosts the app and the `/api` endpoints, later the domain and email forwarding | Free tier                                                          |
| **Anthropic Console** (console.anthropic.com) | Claude API key for reading event pages without structured data                | Prepaid credits; set a spend limit                                 |
| **GitHub** (this repo)                        | Stores the secrets and runs the ingest, deploy and migrate workflows          | Free: unlimited Actions while public, 2,000 min/month once private |

Optional: **Ticketmaster** and **Meetup** API keys (see the README). Each source is skipped while its key is missing, so you can add them later.

Never paste a secret into an issue, a commit, a chat or a file in the repo. Secrets go only into the three places named below: GitHub → Settings → Secrets, the Cloudflare Worker settings, and your local `.env`, which git ignores.

## 1. Supabase: database and sign-in

1. Sign up at supabase.com → **New project**. Pick a name such as `happow`, a strong **database password** (save it in a password manager) and region **Central EU (Frankfurt)**, which is closest to Wrocław.
2. **Connection string.** Click **Connect** at the top of the project → **Session pooler** → copy the URI. It looks like `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`. Replace `[YOUR-PASSWORD]` with the password from step 1. This value is **`DATABASE_URL`**.
3. **API keys.** Open **Project Settings → API Keys** and copy three values:
   - the **Project URL** (`https://<ref>.supabase.co`). This is both **`VITE_SUPABASE_URL`** and **`SUPABASE_URL`**.
   - the **publishable** key (`sb_publishable_…`), or the legacy **anon** key. This is **`VITE_SUPABASE_ANON_KEY`**. It is public by design: it ships inside the app, which uses it for sign-in only (all data goes through `/api`).
   - the **secret** key (`sb_secret_…`), or the legacy **service_role** key. This is **`SUPABASE_SERVICE_ROLE_KEY`**. It bypasses all security rules: keep it server-side only and never put it in a variable whose name starts with `VITE_`.
4. **Sign-in settings.** Open **Authentication → Sign In / Providers**:
   - Keep **Allow new users to sign up** off while sign-in is by email code only. Accounts are created by the admin panel when you send someone a code (section 4), which works with sign-ups off. Turn it on when you add Google (step 5): a first Google sign-in creates the account.
   - Click **Email** in the provider list. Set **Email OTP Expiration** to `86400` (24 hours, the maximum), so a code you send by hand later the same day still works, and leave **Email OTP Length** as it is: the app takes codes of 6 to 10 digits (`auth.codeDigits` in `config/app.json`). Save.

   Then open **Authentication → URL Configuration**:
   - Set **Site URL** to the deployed app, for example `https://happow.<your-subdomain>.workers.dev` (later your own domain).
   - Add the same URL and `http://localhost:5173` to **Redirect URLs**. The sign-in link in a code email returns to the address you generated it from, so it must be on this list. Google sign-in returns there too.

5. **Google sign-in (optional).** The app shows "Continue with Google" only once `auth.providers` in `config/app.json` lists `"google"`, so do these steps first:
   1. Open console.cloud.google.com and pick or create a project (for example `happow`).
   2. **APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth Platform → Branding**). User type **External**; app name `Happow`; your email as support and developer contact. Under **Audience**, publish the app (**Publish app**), or only test users can sign in.
   3. **APIs & Services → Credentials → Create credentials → OAuth client ID** (newer consoles: **Google Auth Platform → Clients → Create client**). Application type **Web application**, name `Happow web`.
      - **Authorized JavaScript origins:** the app's URL from step 4 (no path).
      - **Authorized redirect URIs:** `https://<ref>.supabase.co/auth/v1/callback`, with your Project URL from step 3.
      - Click **Create** and copy the **Client ID** and **Client secret**.
   4. In Supabase, **Authentication → Sign In / Providers → Google**: switch it on, paste the Client ID (**Client IDs**) and the **Client Secret**, and **Save**.
   5. On the same page, turn **Allow new users to sign up** on.
   6. In `config/app.json`, set `"auth": { "providers": ["google"], … }` and deploy.

   If a label differs in your console, the field names to look for are the same: consent screen, OAuth client of type Web application, authorized redirect URI.

## 2. Anthropic: Claude API key

The app calls Claude Haiku 5.5 only when a page has no structured event data: on the NFM crawl, and when someone pastes such a link into "Add an event". This key belongs to an **API account** at console.anthropic.com. That account is separate from your Claude.ai or Claude Code subscription: API usage is billed per token from prepaid credits and does not use your chat or Claude Code limits.

1. Sign in at console.anthropic.com. You can use the same email; it is still a separate billing account.
2. **Settings → Billing**: buy a small amount of credit, for example $5–10. **Turn auto-reload off** for now, so the most you can ever spend is what you prepaid.
3. **Settings → Workspaces → Create workspace** named `happow`. In the workspace settings set a **spend limit**, for example $5 per month. When it is reached, API calls fail and the app falls back to JSON-LD only and the manual form; nothing else breaks.
4. In the `happow` workspace, open **API Keys → Create key** and name it `happow-prod`. Copy it; it is shown once. This is **`ANTHROPIC_API_KEY`**.
5. Usage and cost per day are on the Console's **Usage** and **Cost** pages, and can be filtered by workspace and key.

If the key ever leaks (pasted somewhere, committed by mistake), go to **API Keys**, disable it, create a new one and update it in GitHub and Cloudflare. Anthropic also automatically disables keys it finds pushed to public GitHub repos.

## 3. Database: run the migrate + seed workflow

This creates the tables and functions on Supabase and loads the demo events.

1. In this repo on GitHub, open **Settings → Secrets and variables → Actions → New repository secret**. Name `DATABASE_URL`, value: the connection string from step 1.2.
2. Open the **Actions** tab → **Database migrate + seed (Supabase)** in the left list → **Run workflow** (top right) → branch `main` → leave **Re-seed demo events** ticked → **Run workflow**.
3. Wait about a minute for a green tick. Open the run to see the log lines `applied 2026…sql` and `seeded … events for wroclaw`.

Run it again after every merge that adds a file to `supabase/migrations/`. It is safe to repeat: applied migrations are skipped. Untick **Re-seed** once real sources are flowing, or set the `seed` source to `"enabled": false` in `config/sources.json`.

Command-line alternative: put `DATABASE_URL` in `.env`, then run `pnpm db:migrate && pnpm db:seed`.

## 4. Moderators, the admin and sign-in codes

Staff are ordinary accounts with a role in the `moderators` table: `moderator` (the moderation queue) or `admin` (the queue, sign-in code requests and plan grants). Make yourself the admin once, in the **SQL Editor**:

```sql
insert into moderators (email, role) values ('you@example.org', 'admin')
on conflict (email) do update set role = 'admin';
```

For each moderator:

1. In Supabase, open **Authentication → Users → Add user → Send invitation** and enter their email.
2. Open the **SQL Editor** and run `insert into moderators (email) values ('name@example.org');`, with the email in lower case.

They then sign in like everyone else, in **About → Sign in** (an email code, or Google once set up). The **Moderation** link appears in About for staff only, or open `/#/moderate`.

**Check that you are the admin.** In the app, open settings → ⓘ (**About Happow**) and sign in with the email you put in the SQL above. At the end of About, the shield row **Moderation** appears. Tap it: the screen is titled **Admin** and has three tabs at the top, **Queue · Codes · Grants**. If the title is **Moderation** and there are no tabs, your row in `moderators` has the role `moderator`: run the SQL above again. If the shield row is missing, the email in `moderators` doesn't match the one you signed in with (it must be lower case).

**Sign-in codes by hand** (`auth.emailDelivery: "manual"` in `config/app.json`, until the app has its own domain and an email sender). When someone asks for a code in the app, the request waits for you:

1. Open **About Happow → Moderation → Codes**. The number on the tab is how many requests are open. Each row shows the email, the language (PL or EN), how long ago it was asked, and whether the person already has an account.
2. Tap **Generate code**. This creates the account if needed and opens **Ready email**: the code in large type (to read out over the phone), and the To, Subject and Body in the person's language.
3. Tap **Open in mail app**: your mail app opens with the email filled in. Send it from your own address. If no mail app opens, tap **Copy email** and paste it into a new email; the small copy button next to To copies the address. On a phone that blocks copying, the text is selected for you: press and hold it, then **Copy**.
4. Tap **Done**. The row now says **code made at 14:05**. The code works for 24 hours. **Generate again** makes a new code, and the old one stops working.

Requests leave the list once the person has signed in after their code was made, or after 7 days. **Delete** removes one by hand (it asks first); a code that already went out still works.

**While they wait**, the person is already signed in on their phone as an account that waits for activation: they can accept invitations and save events, nothing else. In Supabase (**Authentication → Users**) these show as `p-…@pending.happow.invalid`. The Worker creates them itself, so this works with sign-ups off; each one is folded into the real account and deleted when the code is typed, or deleted after 30 days (`auth.pending.keepDays`) if it never is. Leave them alone.

**Premium by hand (plan grants).** Every account has premium during the early-access promotion: `earlyAccess.until` in `config/plans.json` (the last day included, Warsaw time). To extend it, change that date and deploy; it applies to everyone at once. To give one person premium beyond that (a tester, a partner organiser), add a grant:

1. Open **About Happow → Moderation → Grants** and tap **Give premium**.
2. Type the **Email**. If the person has never signed in, their account is made for the grant.
3. Under **End**, leave **No end date**, or tap **Last day** and pick the last day premium should work. It works through the whole of that day, Warsaw time.
4. Optionally add a **Note** (only you see it, in the list), then tap **Give premium**.

The list shows active grants first, then ended ones, dimmed. To stop a manual grant now, tap **End** on it and confirm with **End premium**. Trial and purchase grants have no **End** button.

Or in the **SQL Editor** (the person must have an account):

```sql
select grant_add('name@example.org', 'premium', null, 'organiser', 'you@example.org');
```

## 5. Cloudflare: hosting the app and the `/api`

The app runs as one **Cloudflare Worker** named `happow`. Cloudflare serves the built PWA as static files, and only `/api/*` runs code (`apps/web/worker/index.ts`). The settings live in `wrangler.jsonc` at the repo root. Cloudflare builds and deploys it from GitHub on every push to `main` (Workers Builds); no GitHub Action or Cloudflare token is involved.

1. Sign up at dash.cloudflare.com (free plan).
2. **Workers & Pages → Create → Import a repository →** pick `PriamSinbob/Happow`, then name the Worker `happow`.
3. **Settings → Build** (the Worker's **Settings** tab, **Build** section):

   | Setting           | Value                             |
   | ----------------- | --------------------------------- |
   | Root directory    | `/` (leave empty)                 |
   | Build command     | `pnpm --filter @happow/web build` |
   | Deploy command    | `npx wrangler deploy`             |
   | Production branch | `main`                            |

   Cloudflare installs dependencies itself (it sees `pnpm-lock.yaml`), and uses Node 22 from `.node-version`.

4. **Build variables** (same **Build** section → **Variables and secrets**). These are baked into the app when it is built:
   - `VITE_SUPABASE_URL`: Project URL (1.3)
   - `VITE_SUPABASE_ANON_KEY`: publishable / anon key (1.3)
5. **Runtime secrets** (top of **Settings → Runtime variables and secrets → + Add variable**, with the **secret checkbox ticked**; never unticked, and never the `VITE_` names here). Only the `/api` code can read these:
   - `SUPABASE_URL`: Project URL (1.3)
   - `SUPABASE_SERVICE_ROLE_KEY`: secret / service_role key (1.3)
   - `SUBMITTER_SALT`: a long random string you create once, for example the output of `openssl rand -hex 32` or 40 random characters from a password manager. It makes stored device and IP hashes unlinkable. Keep it stable: changing it resets rate limits and breaks "one report per device".
   - `GITHUB_DISPATCH_TOKEN`: lets the Worker's schedule start the ingest workflow (see **5a**).
   - `ORS_API_KEY` (optional): walking routes for "Route in Happow". Sign up at account.heigit.org (openrouteservice by HeiGIT); the free **Standard** plan gives 2,000 routes a day and 40 a minute. Copy the API key from the dashboard. Without it, or when the daily quota runs out, the in-app route is drawn as a direct line, and the Google Maps button works as always.
   - `VAPID_PRIVATE_KEY` (for reminders): signs web push messages. Make it once with `pnpm push:keys` (it prints one line starting `{"kty":"EC"`) and paste that whole line as the value, also into your local `.env`. Without it, reminders can't be set. Keep it stable: a new key ends every existing push subscription. Previews read the same secrets (**Previews Base**), so set it there too to test reminders on a preview.
6. **Deployments → Retry** (or push to `main`). The app is then at `https://happow.<your-subdomain>.workers.dev`, shown on the Worker's overview page. A custom domain is added later under **Settings → Domains & Routes**.

**Logs:** errors from `/api` appear under the Worker's **Observability → Logs**, and failed builds under **Deployments → View build**.

### 5a. Scheduled ingestion (Cron Trigger)

The Worker has a Cron Trigger every 15 minutes (`triggers.crons` in `wrangler.jsonc`). Each tick reads the latest run of each source in each region (the `source_run_latest` view) and starts the GitHub **Ingest sources** workflow only when some source is due. A tick that finds a run already queued or running dispatches nothing (GitHub keeps only the newest waiting run, so it would cancel the last one, a run started by hand included). A tick that finds nothing due costs nothing, and GitHub's own schedule is only a fallback once a day. This keeps ingestion on time (GitHub runs its own frequent schedules late or not at all) and within the 2,000 free Actions minutes a private repository gets.

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - **Repository access:** Only select repositories → `PriamSinbob/happow`.
   - **Permissions → Repository permissions → Actions:** Read and write. Nothing else.
   - **Expiration:** pick a date and set yourself a reminder; when it expires, ingestion falls back to once a day.
2. Cloudflare → the `happow` Worker → **Settings → Runtime variables and secrets → + Add variable**, secret checkbox ticked, name `GITHUB_DISPATCH_TOKEN`, value: the token.
3. Check: the Worker's **Settings → Triggers** lists the Cron Trigger `*/15 * * * *` (it appears after the first deploy of this change). After the next tick, **Observability → Logs** shows a line like `{"cron":"*/15 * * * *","due":["ticketmaster@wroclaw"],"dispatched":true}`, and GitHub → **Actions** shows a new run started by `workflow_dispatch`.

Sources whose GitHub secrets are missing are recorded as skipped and not retried for 24 hours (`ingest.dispatch` in `config/app.json`), so an unconfigured source never triggers runs on its own. Runs are kept few on purpose: no source is scheduled more often than every 12 hours (Ticketmaster and account feeds; the rest daily or weekly), a failed source is retried after 6 hours, and a run that starts also takes every source due within the next 6 hours (`batchAheadHours`), so sources settle into one long run a day (about 40 minutes, the city portal alone about 20) and one short one 12 hours later. The Worker passes the regions with something due, and the workflow runs one job per region, one after another; each job may take up to 60 minutes and bills only what it uses, rounded up to a whole minute. Expected use with Wrocław alone: about 45 minutes a day, roughly 1,400 minutes a month plus CI. With ten regions it is well over a private repository's free minutes: see [Regions and limits](#regions-and-limits).

## 6. GitHub: secrets for the scheduled jobs

**Settings → Secrets and variables → Actions → New repository secret**:

| Name                               | Where it comes from                                                         | Used by            |
| ---------------------------------- | --------------------------------------------------------------------------- | ------------------ |
| `DATABASE_URL`                     | Supabase connection string (1.2)                                            | migrate, ingest    |
| `ANTHROPIC_API_KEY`                | Anthropic Console (2.4)                                                     | ingest (NFM crawl) |
| `TICKETMASTER_API_KEY`, `MEETUP_*` | optional; Ticketmaster: developer.ticketmaster.com → My Apps → Consumer Key | ingest             |

The Worker also needs `TICKETMASTER_API_KEY` (Settings → Variables and Secrets, the same key) for followed artists' dates in other Polish cities. Without it, follows still match the region's events.

**Ingest** is started by the Worker's Cron Trigger whenever a source is due (**5a**), with a fallback schedule once a day. Each source decides whether it is due, so a run fetches only those. To run everything now: **Actions → Ingest sources → Run workflow** with **force** ticked.

## 7. Check that it works

- The map shows the demo events, now coming from Supabase instead of the bundled file.
- **+ → Add an event** with a ticket link (signed in): the form fills itself. Submit, and the event appears with the **Unverified** badge.
- **About → Sign in** with your admin email: ask for a code, generate it in **Moderation → Codes**, sign in, and the submission is in the queue.
- In Supabase → **Table Editor → source_runs**, each ingest run has a row with its statistics.

## Claude API costs

Prices: Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens. One event page is about 4,000 input tokens (the page text is cut to 12,000 characters) plus a few hundred output tokens, so roughly **$0.0005–0.001 per page**.

| What calls Claude                               | How often                                                                                                                                               | Bound                                                                               | Cost                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| NFM crawl                                       | Only pages that changed since the last crawl (content-hash cache)                                                                                       | at most 25 pages a day                                                              | a few cents a month                     |
| "Add an event" autofill                         | Signed-in accounts only (`submissions.autofill: "account"`), with a monthly allowance per plan (`config/plans.json`)                                    | `extraction.autofillLlmPerDay` (300) across all users, plus 30 per hour per account | a few cents a month at most             |
| Poster and place photos                         | Each photo is one call (about 1,600–2,500 image tokens + instructions + a short answer): **about $0.0005–0.001 a photo**, 1,000–2,000 photos per dollar | the same daily cap; place photos also 5 a day per device and 30 per network         | at most about $5–9 a month at 300 a day |
| Map, list, filters, detail, reports, moderation | never                                                                                                                                                   | —                                                                                   | $0                                      |

So the Claude cost is crawling, which grows with the number of **cities and sources**, plus autofill, bounded by the daily cap: about $0.01–0.05 per city per month for an NFM-like source. The workspace spend limit (step 2.3) is the backstop.

Your own Claude subscription (Claude.ai and Claude Code) is a different product with its own limits. The app never uses it, and building the app in Claude Code never touches the API key.

## Regions and limits

Each region in `config/regions.json` is a city with its suburbs: `bbox` must hold the suburbs (events outside it are rejected as `outside-region`, and the add form refuses points outside it), and `localities` lists the town names crawled listings use (an item naming another town is dropped before geocoding). Clients pick the region from the position (`regionAt`); the web app remembers it and reloads once when it finds itself in another region, and `?region=<id>` opens one directly.

A new city is a region entry plus its id in each source's `regionIds`. Sources that read a city listing take the address per region in `regionOptions` (eBilet, Biletyna). Districts for the metrics are optional: `pnpm districts` writes them from OSM.

- **Ticketmaster** answers at most 1,000 results per query. A query that matches more is split into quarters of its area, and below about 3 km into halves of its time window, until every part fits; events are kept once. A run is capped at `options.maxRequests` (300) of the 5,000 a day the free key allows.
- **OpenStreetMap** (venues and open places) runs once every 30 days, one Overpass query per region: well inside Overpass's usage policy (under 10,000 queries and 1 GB a day, one query at a time). It is the starting set; users correct and add places after that, and their changes are kept apart from the OSM rows, so a monthly refresh does not overwrite them.
- **eBilet** is on in every region until launch only, to see whether it is worth asking them for consent or a feed (`beforeLaunch` in `config/sources.json`).

### Nominatim (addresses to points)

Events that arrive without coordinates (crawled pages, account feeds, the add form's address field) are geocoded with OpenStreetMap's public Nominatim server. Its usage policy: at most **one request a second from the whole app**, a User-Agent that identifies the app (ours has the site and contact address), results cached, and no bulk geocoding of large lists. Happow keeps to it like this:

- One request every 1.1 s (`geocoding.minIntervalMs`), and region jobs run one after another (`max-parallel: 1` in `ingest.yml`), so two jobs never ask at once.
- Every answer, found or not, is cached for 30 days (`geocoding.cacheDays`), so a venue is looked up once a month, not once per event.
- Sources with coordinates (Ticketmaster, Meetup, JSON-LD with `geo`, OSM) never call it, nor does an event whose venue already carries a point.
- The query is bounded to the region's bbox, so a Polish street name finds the right city.

What changes with ten cities is only the first week: each new city's venues are unknown, so its first runs geocode a few hundred to a few thousand addresses (an hour per 3,000). After that it is a few new venues a day. If the queue keeps growing (the run log's `geocoded` count stays high, or Nominatim answers 429 or 403), the geocoder is one class behind an interface (`Geocoder` in `packages/extract/src/geocode.ts`) and can move to a self-hosted Photon or Nominatim with a Poland extract (a small server with 8 GB of memory and 100 GB of disk, no request limit), or to a paid service with a free tier (LocationIQ, Geoapify, MapTiler). Nothing else changes.

### GitHub Actions minutes for a private repository

A private repository gets 2,000 free Actions minutes a month on GitHub Free and 3,000 on Pro or Team. Each job is billed in whole minutes, about 1–2 of them for checkout and `pnpm install` before any work. Public repositories pay nothing, which is why this was never an issue before.

A rough estimate for ten regions: Wrocław about 45 minutes a day, each other city 10–15 (two runs a day, a third of it setup), so **about 4,500–6,000 minutes a month**, plus CI (both CI jobs on every push to a pull request, a few minutes each). Measure with `source_runs` once the regions run. Three ways to fit:

1. **Self-hosted runner (recommended).** Jobs on your own machine use no included minutes. A small VPS (for example Hetzner CX22, 2 vCPU and 4 GB, about €4–5 a month) is enough for ingest. GitHub → the repository → **Settings → Actions → Runners → New self-hosted runner** → Linux x64, run the commands it shows on the server, then `sudo ./svc.sh install && sudo ./svc.sh start` so it survives reboots. Then **Settings → Secrets and variables → Actions → Variables → New repository variable** `INGEST_RUNNER` = `self-hosted`. Only the ingest workflow moves; CI stays on GitHub's runners. Keep the repository private while a self-hosted runner is attached (on a public one, anyone's pull request could run code on it). The same server can later run the self-hosted geocoder. GitHub announced and then postponed a $0.002-a-minute charge for self-hosted runners in private repositories; even at that rate, 6,000 minutes would be $12 a month.
2. **Pay for extra minutes.** Above the included ones, a Linux 2-core runner costs well under a cent a minute; 3,000–4,000 extra minutes come to roughly $20–30 a month. Set a spending limit in **Settings → Billing**.
3. **Fewer runs.** Daily instead of 12-hourly sources (`schedule` in `config/sources.json`), or a larger `batchAheadHours`, halves the setup minutes.
