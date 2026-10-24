# Setting up the hosted services

A one-time checklist for taking Happow from "runs on a laptop" to "live on the internet". Everything below runs on free tiers except the Claude API, which is pay-as-you-go (cents per month at PoC volume, see [Claude API costs](#claude-api-costs)).

There are four accounts, and each one owns some of the secrets:

| Account                                       | What it runs                                                                  | Cost                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Supabase** (supabase.com)                   | Postgres database, magic-link sign-in for moderators                          | Free tier                                                          |
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
   - the **publishable** key (`sb_publishable_…`), or the legacy **anon** key. This is **`VITE_SUPABASE_ANON_KEY`**. It is public by design: it ships inside the app and can only call what the database allows anonymous users to call.
   - the **secret** key (`sb_secret_…`), or the legacy **service_role** key. This is **`SUPABASE_SERVICE_ROLE_KEY`**. It bypasses all security rules: keep it server-side only and never put it in a variable whose name starts with `VITE_`.
4. **Sign-in settings.** Open **Authentication → Sign In / Providers**:
   - Keep **Allow new users to sign up** off until Google sign-in arrives (M8 slice E). Accounts are created by the admin panel when you send someone a code (section 4), which works with sign-ups off.
   - Click **Email** in the provider list. Set **Email OTP Expiration** to `86400` (24 hours, the maximum), so a code you send by hand later the same day still works, and check that **Email OTP Length** is `6`. Save.

   Then open **Authentication → URL Configuration**:
   - Set **Site URL** to the deployed app, for example `https://happow.<your-subdomain>.workers.dev` (later your own domain).
   - Add the same URL and `http://localhost:5173` to **Redirect URLs**. The sign-in link in a code email returns to the address you generated it from, so it must be on this list.

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
3. Wait about a minute for a green tick. Open the run to see the log lines `applied 2026…sql` and `seeded 20 events for wroclaw`.

Run it again after every merge that adds a file to `supabase/migrations/`. It is safe to repeat: applied migrations are skipped. Untick **Re-seed** once real sources are flowing, or set the `seed` source to `"enabled": false` in `config/sources.json`.

Command-line alternative: put `DATABASE_URL` in `.env`, then run `pnpm db:migrate && pnpm db:seed`.

## 4. Moderators, the admin and sign-in codes

Staff are ordinary accounts with a role in the `moderators` table: `moderator` (the moderation queue) or `admin` (the queue, sign-in code requests and, from M8 slice B, plan grants). Make yourself the admin once, in the **SQL Editor**:

```sql
insert into moderators (email, role) values ('you@example.org', 'admin')
on conflict (email) do update set role = 'admin';
```

For each moderator:

1. In Supabase, open **Authentication → Users → Add user → Send invitation** and enter their email.
2. Open the **SQL Editor** and run `insert into moderators (email) values ('name@example.org');`, with the email in lower case.

They then sign in from the app: **About → Moderator sign-in**, or `/#/moderate`.

**Sign-in codes by hand** (`auth.emailDelivery: "manual"` in `config/app.json`, until the app has its own domain and an email sender). When someone asks for a code in the app, the request waits for you. From M8 slice F the admin panel lists the requests; **Generate** creates the account if needed and shows a ready email (code and link, in their language) with a button that opens it in your mail app. Send it from your own address. Until slice F, the same works through the API: `GET /api/admin/code-requests` and `POST /api/admin/code-requests/<id>/generate`, signed in as the admin.

**Premium by hand (plan grants).** Every account has premium during the early-access promotion: `earlyAccess.until` in `config/plans.json` (the last day included, Warsaw time). To extend it, change that date and deploy; it applies to everyone at once. To give one person premium beyond that (a tester, a partner organiser), add a grant. From M8 slice F the admin panel does it; until then, signed in as the admin:

- `POST /api/admin/grants` with `{"email": "name@example.org", "endsAt": null, "note": "organiser"}` gives premium with no end. For an end, send `"endsAt": "2027-01-31T23:00:00Z"` (UTC; that is midnight in Warsaw in winter). The account is created if the person has never signed in.
- `GET /api/admin/grants` lists every grant; `DELETE /api/admin/grants/<id>` ends one now.

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
6. **Deployments → Retry** (or push to `main`). The app is then at `https://happow.<your-subdomain>.workers.dev`, shown on the Worker's overview page. A custom domain is added later under **Settings → Domains & Routes**.

**Logs:** errors from `/api` appear under the Worker's **Observability → Logs**, and failed builds under **Deployments → View build**.

### 5a. Scheduled ingestion (Cron Trigger)

The Worker has a Cron Trigger every 15 minutes (`triggers.crons` in `wrangler.jsonc`). Each tick reads the latest rows of `source_runs` and starts the GitHub **Ingest sources** workflow only when some source is due. A tick that finds nothing due costs nothing, and GitHub's own schedule is only a fallback every 6 hours. This keeps ingestion on time (GitHub runs its own frequent schedules late or not at all) and within the 2,000 free Actions minutes a private repository gets.

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - **Repository access:** Only select repositories → `PriamSinbob/happow`.
   - **Permissions → Repository permissions → Actions:** Read and write. Nothing else.
   - **Expiration:** pick a date and set yourself a reminder; when it expires, ingestion falls back to every 6 hours.
2. Cloudflare → the `happow` Worker → **Settings → Runtime variables and secrets → + Add variable**, secret checkbox ticked, name `GITHUB_DISPATCH_TOKEN`, value: the token.
3. Check: the Worker's **Settings → Triggers** lists the Cron Trigger `*/15 * * * *` (it appears after the first deploy of this change). After the next tick, **Observability → Logs** shows a line like `{"cron":"*/15 * * * *","due":["ticketmaster@wroclaw"],"dispatched":true}`, and GitHub → **Actions** shows a new run started by `workflow_dispatch`.

Sources whose GitHub secrets are missing are recorded as skipped and not retried for 24 hours (`ingest.dispatch` in `config/app.json`), so an unconfigured source never triggers runs on its own. Expected use with today's sources: about 24 hourly runs a day for Ticketmaster (about a minute each, as GitHub bills whole minutes) plus a few minutes a day of crawling, roughly 1,000 minutes a month.

## 6. GitHub: secrets for the scheduled jobs

**Settings → Secrets and variables → Actions → New repository secret**:

| Name                               | Where it comes from              | Used by            |
| ---------------------------------- | -------------------------------- | ------------------ |
| `DATABASE_URL`                     | Supabase connection string (1.2) | migrate, ingest    |
| `ANTHROPIC_API_KEY`                | Anthropic Console (2.4)          | ingest (NFM crawl) |
| `TICKETMASTER_API_KEY`, `MEETUP_*` | optional, see README             | ingest             |

**Ingest** is started by the Worker's Cron Trigger whenever a source is due (**5a**), with a fallback schedule every 6 hours. Each source decides whether it is due, so a run fetches only those. To run everything now: **Actions → Ingest sources → Run workflow** with **force** ticked.

## 7. Check that it works

- The map shows the demo events, now coming from Supabase instead of the bundled file.
- **+ → Add an event** with a ticket link: the form fills itself. Submit, and the event appears with the **Unverified** badge.
- **About → Moderator sign-in** with your invited email: the magic link arrives, and the submission is in the queue.
- In Supabase → **Table Editor → source_runs**, each ingest run has a row with its statistics.

## Claude API costs

Prices: Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens. One event page is about 4,000 input tokens (the page text is cut to 12,000 characters) plus a few hundred output tokens, so roughly **$0.0005–0.001 per page**.

| What calls Claude                               | How often                                                                | Bound                                                                                       | Cost                |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------- |
| NFM crawl                                       | Only pages that changed since the last crawl (content-hash cache)        | at most 25 pages a day                                                                      | a few cents a month |
| "Add an event" autofill                         | Off in the PoC (`submissions.autofill: false`); planned as a paid add-on | when on: `extraction.autofillLlmPerDay` (300) across all users, plus 30 per hour per client | $0 now              |
| Map, list, filters, detail, reports, moderation | never                                                                    | —                                                                                           | $0                  |

So in the PoC the only Claude cost is crawling, and it grows with the number of **cities and sources**, not users: about $0.01–0.05 per city per month for an NFM-like source. The workspace spend limit (step 2.3) is the backstop.

Your own Claude subscription (Claude.ai and Claude Code) is a different product with its own limits. The app never uses it, and building the app in Claude Code never touches the API key.
