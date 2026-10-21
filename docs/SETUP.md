# Setting up the hosted services

A one-time checklist for taking Happow from "runs on a laptop" to "live on the internet". Everything below runs on free tiers except the Claude API, which is pay-as-you-go (cents per month at PoC volume, see [Claude API costs](#claude-api-costs)).

There are four accounts, and each one owns some of the secrets:

| Account                                       | What it runs                                                                  | Cost                               |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| **Supabase** (supabase.com)                   | Postgres database, magic-link sign-in for moderators                          | Free tier                          |
| **Cloudflare** (dash.cloudflare.com)          | Hosts the app and the `/api` endpoints, later the domain and email forwarding | Free tier                          |
| **Anthropic Console** (console.anthropic.com) | Claude API key for reading event pages without structured data                | Prepaid credits; set a spend limit |
| **GitHub** (this repo)                        | Stores the secrets and runs the ingest, deploy and migrate workflows          | Free (public repo)                 |

Optional: **Ticketmaster** and **Meetup** API keys (see the README). Each source is skipped while its key is missing, so you can add them later.

Never paste a secret into an issue, a commit, a chat or a file in the repo. Secrets go only into the three places named below: GitHub → Settings → Secrets, the Cloudflare Pages project settings, and your local `.env`, which git ignores.

## 1. Supabase: database and sign-in

1. Sign up at supabase.com → **New project**. Pick a name such as `happow`, a strong **database password** (save it in a password manager) and region **Central EU (Frankfurt)**, which is closest to Wrocław.
2. **Connection string.** Click **Connect** at the top of the project → **Session pooler** → copy the URI. It looks like `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`. Replace `[YOUR-PASSWORD]` with the password from step 1. This value is **`DATABASE_URL`**.
3. **API keys.** Open **Project Settings → API Keys** and copy three values:
   - the **Project URL** (`https://<ref>.supabase.co`). This is both **`VITE_SUPABASE_URL`** and **`SUPABASE_URL`**.
   - the **publishable** key (`sb_publishable_…`), or the legacy **anon** key. This is **`VITE_SUPABASE_ANON_KEY`**. It is public by design: it ships inside the app and can only call what the database allows anonymous users to call.
   - the **secret** key (`sb_secret_…`), or the legacy **service_role** key. This is **`SUPABASE_SERVICE_ROLE_KEY`**. It bypasses all security rules: keep it server-side only and never put it in a variable whose name starts with `VITE_`.
4. **Sign-in settings.** Open **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**: moderators are invited and nobody else can sign up. Then open **Authentication → URL Configuration**:
   - Set **Site URL** to the deployed app, for example `https://happow.pages.dev` (later your own domain).
   - Add the same URL and `http://localhost:5173` to **Redirect URLs**.

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

## 4. Moderators

For each moderator:

1. In Supabase, open **Authentication → Users → Add user → Send invitation** and enter their email.
2. Open the **SQL Editor** and run `insert into moderators (email) values ('name@example.org');`, with the email in lower case.

They then sign in from the app: **About → Moderator sign-in**, or `/#/moderate`.

## 5. Cloudflare: hosting the app and the `/api`

1. Sign up at dash.cloudflare.com (free plan). Your **Account ID** is shown in the right-hand column of **Workers & Pages**, or under **Account home → ⋯ → Copy account ID**. This is **`CLOUDFLARE_ACCOUNT_ID`**.
2. **API token.** Open **My Profile → API Tokens → Create Token → Custom token**:
   - Permissions: **Account → Cloudflare Pages → Edit**.
   - Account resources: your account.

   Create it and copy the token. This is **`CLOUDFLARE_API_TOKEN`**.

3. **Create the Pages project.** The first deploy creates it, but the server secrets must be set on it, so create it first:
   1. Open **Workers & Pages → Create → Pages → Use direct upload**.
   2. Name it `happow`. The app's address becomes `https://happow.pages.dev`.
   3. Upload any small placeholder folder; the workflow replaces it.
4. **Server secrets.** Open the project → **Settings → Variables and Secrets** → for the **Production** environment add each of these as type **Secret**:
   - `SUPABASE_URL` (Project URL from step 1.3)
   - `SUPABASE_SERVICE_ROLE_KEY` (secret / service_role key from step 1.3)
   - `SUBMITTER_SALT`: a long random string you create once, for example the output of `openssl rand -hex 32` or 40 random characters from a password manager. It makes stored device and IP hashes unlinkable. Keep it stable: changing it resets rate limits and breaks "one report per device".
   - `ANTHROPIC_API_KEY`, the same key as step 2.4 (optional; without it autofill uses structured data only).

## 6. GitHub: the remaining secrets

**Settings → Secrets and variables → Actions**:

| Name                               | Where it comes from                   | Used by                     |
| ---------------------------------- | ------------------------------------- | --------------------------- |
| `DATABASE_URL`                     | Supabase connection string (1.2)      | migrate, ingest             |
| `VITE_SUPABASE_URL`                | Supabase Project URL (1.3)            | deploy (baked into the app) |
| `VITE_SUPABASE_ANON_KEY`           | Supabase publishable / anon key (1.3) | deploy                      |
| `CLOUDFLARE_API_TOKEN`             | Cloudflare token (5.2)                | deploy                      |
| `CLOUDFLARE_ACCOUNT_ID`            | Cloudflare account id (5.1)           | deploy                      |
| `ANTHROPIC_API_KEY`                | Anthropic Console (2.4)               | ingest (NFM crawl)          |
| `TICKETMASTER_API_KEY`, `MEETUP_*` | optional, see README                  | ingest                      |

Optional **Variables** tab: `CLOUDFLARE_PAGES_PROJECT` if you named the project something other than `happow`, and `VITE_REGION_ID`.

After that:

- **Deploy:** **Actions → Deploy web (Cloudflare Pages) → Run workflow**. It also runs on every push to `main`. Open `https://happow.pages.dev`.
- **Ingest:** runs every 15 minutes by itself. Each source decides whether it is due, so most runs finish in seconds. **Actions → Ingest sources → Run workflow** with **force** runs everything now.

## 7. Check that it works

- The map shows the demo events, now coming from Supabase instead of the bundled file.
- **+ → Add an event** with a ticket link: the form fills itself. Submit, and the event appears with the **Unverified** badge.
- **About → Moderator sign-in** with your invited email: the magic link arrives, and the submission is in the queue.
- In Supabase → **Table Editor → source_runs**, each ingest run has a row with its statistics.

## Claude API costs

Prices: Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens. One event page is about 4,000 input tokens (the page text is cut to 12,000 characters) plus a few hundred output tokens, so roughly **$0.0005–0.001 per page**.

| What calls Claude                      | How often                                                                | Bound                                                                              | Cost                                                   |
| -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| NFM crawl                              | Only pages that changed since the last crawl (content-hash cache)        | at most 25 pages per run, 1–2 runs a day                                           | a few cents a month                                    |
| "Add an event" autofill                | Only for pasted links without structured data; most ticket sites have it | `extraction.autofillLlmPerDay` (300) across all users, plus 30 per hour per client | at most about $0.30 a day, about $9 a month at the cap |
| Map, list, filters, detail, moderation | never                                                                    | —                                                                                  | $0                                                     |

What grows with users is autofill, and the daily cap bounds it whatever the traffic or abuse. When the cap is used up, autofill still reads structured data and otherwise leaves the form for manual entry. Crawling grows with the number of **cities and sources**, not users: about $0.01–0.05 per city per month for an NFM-like source. The workspace spend limit (step 2.3) is the final backstop.

Your own Claude subscription (Claude.ai and Claude Code) is a different product with its own limits. The app never uses it, and building the app in Claude Code never touches the API key.
