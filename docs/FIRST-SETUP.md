# First setup, click by click

This is the beginner version of [SETUP.md](SETUP.md). Follow the parts in order, and do every step in each part. Each part ends with a **Check** step, so you know it worked before you go on.

You need about 45 minutes. You will create three free accounts (Supabase, Cloudflare, Anthropic) and copy some secret values between them.

## Before you start: your secrets note

You will collect about 8 secret values. Keep them in **one private place**, such as a password manager (Bitwarden, 1Password) or a note that only you can see.

**Never** paste a secret into a GitHub issue, a commit, a chat (including chats with Claude), or any file except `.env`.

Copy this list into your note now. You will fill in each line as you go:

```
SUPABASE DATABASE PASSWORD  =
DATABASE_URL                =
SUPABASE_URL                =
SUPABASE PUBLISHABLE KEY    =   (used as VITE_SUPABASE_ANON_KEY)
SUPABASE SECRET KEY         =   (used as SUPABASE_SERVICE_ROLE_KEY)
SUBMITTER_SALT              =
ANTHROPIC_API_KEY           =
APP ADDRESS (workers.dev)   =
```

How to copy and paste: select the text with the mouse, press **Ctrl+C** to copy, click where it should go, press **Ctrl+V** to paste.

---

## Part 1: Create the database (Supabase)

1. Open your browser (Chrome or Edge). Click the long bar at the very top (the address bar), type `supabase.com` and press **Enter**.
2. Click **Start your project** (or **Sign in**), then **Continue with GitHub**. Sign in as `PriamSinbob` and click **Authorize** if you are asked.
3. If it asks you to create an **organization**: name it `happow`, plan **Free**, then click **Create organization**.
4. Click **New project** and fill in the form:
   - **Name:** `happow`
   - **Database password:** click **Generate a password**, then **Copy**. Paste it into your note next to `SUPABASE DATABASE PASSWORD`.
     If you type your own password instead, use **only letters and digits** (at least 24 of them). Characters like `@ # / ? %` break the connection string later.
   - **Region:** **Central EU (Frankfurt)**
   - Click **Create new project**, then wait 1–2 minutes until the dashboard stops showing "Setting up project".

### 1a. Get the connection string (`DATABASE_URL`)

5. Click the **Connect** button at the top of the page.
6. In the window that opens, find the **Session pooler** box and copy its address. It looks like this:
   `postgresql://postgres.abcdxyz:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
   - Use **Session pooler**, not "Direct connection". GitHub's servers cannot reach the direct one.
7. Paste it into your note next to `DATABASE_URL`. In your note, replace `[YOUR-PASSWORD]` with your database password, **including the square brackets**.
   - Correct: `...abcdxyz:Xk29fPq...@aws-0...`
   - Wrong: `...abcdxyz:[Xk29fPq...]@aws-0...`

### 1b. Get the API keys

8. In the left sidebar, click the **gear icon (Project Settings)**, then **API Keys**. If the sidebar shows only icons, hover over them to see their names.
9. Copy three values into your note:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`) → `SUPABASE_URL`. It is on the **Data API** page, or under **Connect → App frameworks**.
     The **Data API** page may show it with `/rest/v1/` at the end. **Delete that ending**: the value must end with `.supabase.co`, otherwise the app shows "Could not load events".
   - **Publishable key** (starts with `sb_publishable_`) → `SUPABASE PUBLISHABLE KEY`. This key is public on purpose: it goes inside the app.
   - **Secret key** (starts with `sb_secret_`; click **Reveal** to see it) → `SUPABASE SECRET KEY`. **This key can do anything in the database.** It must stay secret.
   - If you only see **anon** and **service_role** keys (the old style), use those instead: anon = publishable, service_role = secret.

### 1c. Lock down sign-in

10. In the left sidebar, click **Authentication**, then **Sign In / Providers**. Switch **Allow new users to sign up** **off**, then click **Save**. (Only moderators sign in, and you invite them yourself.)
11. Still in **Authentication**, click **URL Configuration**. Under **Redirect URLs**, click **Add URL**, enter `http://localhost:5173`, then click **Save**. You will add the live app address in Part 5.

**Check:** your note now has the password, `DATABASE_URL`, `SUPABASE_URL` and both keys.

---

## Part 2: Put the database secret into GitHub

12. Open `github.com/PriamSinbob/Happow` in the browser.
13. Click **Settings** in the row of tabs under the repo name. It is on the right; if you cannot see it, click **⋯** first.
14. In the left menu, click **Secrets and variables**, then **Actions**.
15. Click the green **New repository secret** button.
    - **Name:** `DATABASE_URL` (type it exactly, in capitals)
    - **Secret:** paste your full `DATABASE_URL` from the note
    - Click **Add secret**.

**Check:** the page lists `DATABASE_URL` under **Repository secrets**. GitHub never shows the value again, and that is normal.

---

## Part 3: Run "Database migrate + seed"

This creates all the tables in Supabase and loads 20 demo events in Wrocław.

16. Still on the repo page, click the **Actions** tab at the top.
17. In the left list, click **Database migrate + seed (Supabase)**.
18. On the right, click the grey **Run workflow** button. A small box opens:
    - **Branch:** `main`
    - **Re-seed demo events:** leave it ticked
    - Click the green **Run workflow** button.
19. After a few seconds, a new row appears with a yellow dot. Click it, then click **migrate** to watch the log. It takes about 1 minute.
20. When it finishes, the dot turns into a **green tick**. In the log, open the step **Run pnpm db:migrate**. You should see 7 lines starting with `applied 2026…sql`, then `migrations up to date`. Then open **Run pnpm db:seed**, which should say `seeded 20 events for wroclaw`.

**If you see a red ✗**, open the failed step and read the last lines:

| Message                                  | What it means and how to fix it                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL secret is not set`         | Part 2 was skipped, or the name has a typo. Repeat step 15.                                              |
| `password authentication failed`         | Wrong password in the string, or the `[ ]` brackets are still there. Fix the note and update the secret. |
| `getaddrinfo ENOTFOUND` or `ENETUNREACH` | You copied the **Direct connection** string. Use the **Session pooler** one (step 6).                    |
| `Tenant or user not found`               | The `postgres.<ref>` part of the user name is missing. Copy the pooler string again.                     |

To fix a secret: **Settings → Secrets and variables → Actions → pencil icon next to `DATABASE_URL` → paste → Update secret**. Then repeat steps 16–18.

**Check:** in Supabase, click **Table Editor** in the left sidebar, then the table **events**. You should see 20 rows.

> Run this workflow again whenever a new file appears in `supabase/migrations/`. Running it twice is safe: migrations that are already applied are skipped.

---

## Part 4: Run the app on your computer with the real database

### 4a. Create a random salt

21. Open **PowerShell**: press the **Windows key**, type `PowerShell` and press **Enter**.
22. Paste this line and press **Enter**:

    ```powershell
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```

23. Copy the 64-character result into your note next to `SUBMITTER_SALT`. Create it **once**: changing it later resets rate limits and "one report per device".

### 4b. Create your local `.env`

24. In the same PowerShell window, run these two lines one at a time:

    ```powershell
    cd C:\claude\happow\happow
    ```

    ```powershell
    Copy-Item .env.example .env; notepad .env
    ```

25. Notepad opens. Fill in these lines. Paste each value right after the `=`, with no spaces and no quotes:

    ```
    DATABASE_URL=<DATABASE_URL from your note>
    VITE_SUPABASE_URL=<SUPABASE_URL>
    VITE_SUPABASE_ANON_KEY=<SUPABASE PUBLISHABLE KEY>
    SUPABASE_URL=<SUPABASE_URL>
    SUPABASE_SERVICE_ROLE_KEY=<SUPABASE SECRET KEY>
    SUBMITTER_SALT=<SUBMITTER_SALT>
    ```

    Leave all the other lines empty for now. Press **Ctrl+S** to save, then close Notepad.
    Git ignores `.env`, so this file never goes to GitHub.

### 4c. Start the app

26. In PowerShell, run:

    ```powershell
    pnpm dev
    ```

    If it says the port is already in use, the app is still running in another PowerShell window. Find that window and press **Ctrl+C** in it (or close it), then try again.

27. Wait until it prints `Local: http://localhost:5173/`. Open that address in the browser.
28. To stop the app later, click the PowerShell window and press **Ctrl+C**.

**Check:**

- The map shows pins around Rynek.
- Tap a pin, then **Zgłoś problem** (Report a problem). Pick any reason and send it. You should see a thank-you message, not "not available yet". That proves the `/api` part reaches Supabase.
- In Supabase **Table Editor → reports**, there is now one row.

---

## Part 5: Put the app online (Cloudflare)

29. Go to `dash.cloudflare.com`, sign up (free plan) and confirm your email.
30. In the left menu, click **Compute (Workers)** → **Workers & Pages** → **Create** → **Import a repository**. Connect GitHub, pick **PriamSinbob/Happow**, and set the project name to `happow`.
31. On the build settings screen, enter:
    - **Build command:** `pnpm --filter @happow/web build`
    - **Deploy command:** `npx wrangler deploy`
    - **Root directory:** leave it empty
32. Click **Deploy** and wait 2–3 minutes. (The first build has no Supabase values yet; the next steps add them.)
33. Open the Worker → **Settings** tab. Scroll **down** to the **Build** section → **Variables and secrets** → **+ Add**, and add two. In the type dropdown pick **Text** (these values are public anyway, and Text lets you check them later):
    - `VITE_SUPABASE_URL` = SUPABASE_URL
    - `VITE_SUPABASE_ANON_KEY` = SUPABASE PUBLISHABLE KEY

    These are read while the app is **built**. Do **not** put them in the top section.

34. At the **top** of the same **Settings** tab, in **Runtime variables and secrets**, click **+ Add variable** once for each of these three, and **tick the secret checkbox** every time:
    - `SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY` (the SECRET key)
    - `SUBMITTER_SALT`

    Only the app's `/api` code reads these, while it **runs**. The table then shows three **Secret** rows with hidden values.
    If a yellow box says "Update your Wrangler configuration", something there was added **without** the secret checkbox: delete that row and add it again with the box ticked (or, for a `VITE_` name, in the Build section instead). Never copy values into `wrangler.jsonc`.

35. Open the **Deployments** tab and click **Retry** on the latest deployment, so the build picks up the new values.
36. Copy the address shown on the Worker's overview page (`https://happow.<something>.workers.dev`) into your note as `APP ADDRESS`.
37. Back in Supabase, open **Authentication → URL Configuration**:
    - Set **Site URL** to the APP ADDRESS.
    - Add the APP ADDRESS under **Redirect URLs**.
    - Click **Save**.

**Check:** open the APP ADDRESS on your phone. You should see the map with the demo events.

---

## Part 6: Optional keys (add later, nothing breaks without them)

| Secret                 | Where to get it                                                                                          | Where to put it                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ANTHROPIC_API_KEY`    | console.anthropic.com. Follow [SETUP.md §2](SETUP.md#2-anthropic-claude-api-key) (set a $5 spend limit!) | GitHub secret (same steps as Part 2)   |
| `TICKETMASTER_API_KEY` | developer.ticketmaster.com → My Apps → Consumer Key                                                      | GitHub secret                          |
| `ORS_API_KEY`          | account.heigit.org (free Standard plan)                                                                  | Cloudflare secret (step 34) and `.env` |

After you add ingest keys: **Actions → Ingest sources → Run workflow**, tick **force**, then click **Run workflow**.

## Part 7: Become a moderator

38. In Supabase, open **Authentication → Users → Add user → Send invitation** and enter your own email.
39. In Supabase, open **SQL Editor**. Paste the line below, replacing the example email with yours in lower case, then click **Run**:

    ```sql
    insert into moderators (email) values ('you@example.com');
    ```

40. In the app, tap **Happow** (the logo at the top left) → scroll down → **Logowanie moderatora** (Moderator sign-in). Open the link from your email.

**Check:** the **Moderation** screen opens and shows the report you sent in Part 4.

---

## Final checklist

- [ ] Part 3: the workflow has a green tick, and **events** has 20 rows
- [ ] Part 4: the app runs locally, and a test report reached Supabase
- [ ] Part 5: the app works on your phone at the workers.dev address
- [ ] Part 7: moderator sign-in works
- [ ] Your secrets note is stored safely, and no secret is in any repo file except `.env`
