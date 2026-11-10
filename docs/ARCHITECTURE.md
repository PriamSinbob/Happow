# Happow — architecture

Four Mermaid charts of the whole app. GitHub renders them; keep them in step with the code.

## Happow — whole system overview

Where everything runs and how data moves: config drives the Worker cron, the GitHub ingest job and the API; Supabase sits in the middle.

```mermaid
flowchart TB
  CFG[["config/*.json<br/>sources · regions · categories<br/>plans · map · seasons · theme"]]

  subgraph CF["Cloudflare Worker (happow)"]
    CRON["Cron trigger<br/>every 15 min"]
    SCHED{"Any source due?<br/>(source_runs)"}
    METRICS["Mondays:<br/>saveWeeklyMetrics"]
    API["/api/* router<br/>packages/api"]
    CACHE[("Workers Cache<br/>/api/area 5–30 min")]
    STATIC["Static assets<br/>apps/web/dist (PWA)"]
  end

  subgraph GH["GitHub Actions"]
    INGEST["ingest.yml<br/>pnpm ingest"]
    FALLBACK["Daily fallback cron 03:17"]
    MIGRATE["db-migrate.yml"]
    CI["ci.yml<br/>tests on fixtures"]
  end

  subgraph EXT["External sources"]
    TM["Ticketmaster API"]
    MU["Meetup GraphQL"]
    CRAWL["Crawl targets<br/>ebilet · wroclaw-go · nfm<br/>biletyna · mbp · uwr"]
    OSM["OpenStreetMap / Overpass<br/>venues · open places"]
    VS["Venue websites"]
    FEEDS["Account iCal feeds"]
    TH["Threads (off)"]
  end

  LLM["Claude Haiku<br/>LLM extraction fallback"]
  GEO["Nominatim geocoder"]
  DB[("Supabase Postgres<br/>events · raw payloads · venues<br/>submissions · reports · accounts<br/>plans · contributions · metrics")]

  USER(("User phone<br/>PWA"))
  MOD(("Moderator /<br/>Admin"))

  CFG --> SCHED
  CFG --> INGEST
  CFG --> API
  CRON --> SCHED
  CRON --> METRICS --> DB
  SCHED -- "yes: workflow_dispatch" --> INGEST
  FALLBACK --> INGEST
  EXT --> INGEST
  INGEST <--> LLM
  INGEST <--> GEO
  INGEST -- "upsert, dedup, flag missing" --> DB
  MIGRATE --> DB

  USER -- "loads app" --> STATIC
  USER -- "GET /api/area" --> CACHE
  CACHE -- "miss" --> API
  USER -- "submit · report · autofill<br/>sign-in · plans · route" --> API
  MOD -- "#/moderate · admin" --> API
  API <--> DB
  API <--> LLM
  API <--> GEO
```

## Ingestion pipeline (pnpm ingest)

What `pnpm ingest` does for each source (packages/ingest/src/run.ts).

```mermaid
flowchart TB
  START(["runIngest()"]) --> SYNC["store.syncConfig<br/>sources + regions from config"]
  SYNC --> LOOP{{"for each region × source<br/>plannedRuns(config)"}}
  LOOP --> FILT{"--source / --region<br/>filter matches?"}
  FILT -- no --> LOOP
  FILT -- yes --> KIND{"Adapter or job?"}
  KIND -- "none (seed, submissions)" --> LOOP
  KIND --> SEC{"Secrets present?"}
  SEC -- no --> SKIP1["recordSkip<br/>scheduler backs off 1 day"] --> LOOP
  SEC -- yes --> DUE{"isDue(schedule,<br/>lastSuccess) or --force"}
  DUE -- no --> LOOP
  DUE -- yes --> RUN["store.startRun → source_runs"]
  RUN --> JOBQ{"Venue / feed job?"}

  JOBQ -- "osm-venues · osm-places<br/>venue-probe · account-feeds" --> JOB["Job writes venues, places,<br/>site candidates, feed events"] --> FIN

  JOBQ -- "event adapter" --> FETCH["adapter.fetch(window)<br/>rate-limited HttpClient<br/>ticketmaster · meetup · crawler<br/>venue-sites · worship-services · threads"]
  FETCH --> EXTR{"Crawled page has<br/>schema.org JSON-LD?"}
  EXTR -- yes --> PARSE
  EXTR -- "no + llmFallback" --> LLM["Claude extraction<br/>(cached by content hash)"] --> PARSE
  PARSE["adapter.parse(raw)<br/>dedupe by externalId"] --> DV["Default venue for<br/>single-venue sources"]
  DV --> GEOQ{"Has coordinates?"}
  GEOQ -- no --> GEO["Geocode address<br/>coarse hit lowers confidence"] --> CONF
  GEOQ -- yes --> CONF["scoreConfidence<br/>trust · end · venue"]
  CONF --> NORM["normalize → Event model<br/>H3 cell, category, duration"]
  NORM --> REJ{"Valid?"}
  REJ -- no --> REJC["count rejected reason"]
  REJ -- yes --> APPLY["store.apply"]
  APPLY --> RAW["Save raw payloads"]
  APPLY --> DEDUP{"Same H3 cell + start ±30 min<br/>+ similar title?"}
  DEDUP -- yes --> MERGE["Merge; highest-trust<br/>source stays primary"]
  DEDUP -- no --> INS["Insert / update event"]
  APPLY --> LOWC{"confidence < min?"}
  LOWC -- yes --> QUEUE["Moderation queue"]
  APPLY --> MISS["completeListing sources:<br/>missing N runs → possibly cancelled"]
  MERGE --> FIN
  INS --> FIN
  QUEUE --> FIN
  MISS --> FIN
  FIN["finishRun ok / failed<br/>+ stats"] --> LOOP
```

## API request routing (/api/*)

How the Worker routes /api/* (packages/api/src/handler.ts), including submission → moderation → reward.

```mermaid
flowchart LR
  REQ(["Request /api/..."]) --> R{"route head"}
  R -- "GET area" --> AREA["events_area RPC<br/>grid-snapped key, ETag,<br/>public cache 5 / 30 min<br/>range: 14 days · future"]
  R -- "GET places" --> PLACES["places_area RPC<br/>same grid key, ETag,<br/>corrections applied,<br/>public cache 30 min"]
  R -- "POST autofill" --> AF["Sign-in + monthly allowance<br/>fetchPage → JSON-LD<br/>→ LLM (daily cap) → prefills"]
  R -- "POST autofill/photo" --> AFP["Poster photo → LLM prefill"]
  R -- "POST geocode" --> GC["Address → point in region"]
  R -- "POST submissions" --> SUB["Validate category, bbox, dates<br/>weekly repeat → series<br/>quota · trusted account?"]
  R -- "POST reports" --> REP["report_event<br/>1 per device per day"]
  R -- "POST thanks / counts" --> CON["Contributions:<br/>thanks, attendance counts"]
  R -- "POST route" --> ROUTE["Walking route provider<br/>rate-limited, else straight line"]
  R -- "moderation/*" --> MOD["Moderator role required<br/>queue · approve / reject<br/>series · trusted · reports"]
  R -- "auth/*" --> AUTH["Sign-in (email code, Google)"]
  R -- "me/*" --> ME["Profile, plan, usage,<br/>saved, contributions, feeds"]
  R -- "admin/*" --> ADM["Grants, sources,<br/>feed review"]
  R -- "search · follows" --> FOL["Search, followed<br/>performers' dates"]
  R -- "events · posts · claims" --> ORG["Organiser claims,<br/>updates, own events"]
  R -- "private · invitations<br/>contacts · friends" --> PRIV["Private events<br/>and contacts"]
  R -- "GET ingest/status" --> IST["Last source runs"]
  R -- other --> E404["404 not_found"]

  SUB --> PUB{"publishBeforeModeration<br/>or trusted?"}
  PUB -- yes --> LIVE["Published now<br/>(trusted → reward)"]
  PUB -- no --> PEND["Pending → moderation queue"]
  MOD -- approve --> AWARD["Event live + award reward"]
  MOD -- "report: hide" --> REVOKE["Hide event,<br/>revoke reward"]
  MOD -- "report: cancel" --> CANC["Mark cancelled"]

  AREA & PLACES & AF & SUB & REP & CON & MOD & ME & ADM & FOL & ORG & PRIV & IST --> DB[("Supabase<br/>service-role RPCs")]
```

## PWA user journey (apps/web)

What a person can do in the PWA (apps/web/src/App.tsx, hash routes in useHashRoute.ts).

```mermaid
flowchart TB
  OPEN(["Open app"]) --> REPO{"Supabase env set?"}
  REPO -- yes --> AREAR["AreaEventRepository<br/>GET /api/area"]
  REPO -- no --> SEED["Static seed file<br/>data/seed/*.json"]
  AREAR --> HOME
  SEED --> HOME
  OPEN --> LOC["Geolocation /<br/>live location"] --> HOME
  HOME["Home: Map, list + search overlay<br/>shared filter state"]
  HOME --> F["Filters: time line (today · 14 days · future)<br/>radius rail 100 m–25 km<br/>categories · price · My plans"]
  F --> HOME
  HOME --> EMPTY{"Anything in radius?"}
  EMPTY -- no --> GUIDE["Guidance: nearest + busiest<br/>expand radius / take me there"]
  EMPTY -- yes --> PINS["Pins, edge chevrons,<br/>hotspot, timeline"]
  HOME --> OPENP["Open places today<br/>GET /api/places (or seed)<br/>open now from opening hours"]
  OPENP --> PCARD["Place card: open until,<br/>time left, Google Maps"]
  HOME --> SET["Settings sheet<br/>language PL/EN, theme"]
  HOME --> ACC["Account: sign in, plan,<br/>premium, feeds, contributions"]
  PINS --> DET["#/e/:id Event detail"]
  GUIDE --> GO
  DET --> GO["#/go/:id Going there<br/>walking route"]
  DET --> ACT["Save · share · add to calendar (.ics)<br/>report wrong/cancelled · I'm going"]
  DET --> AGAIN["Add again (#/add?again)"]
  HOME -- "add pill on the map" --> ADD["#/add Add event"]
  AGAIN --> ADD
  ADD --> PASTE{"Paste URL / photo?"}
  PASTE -- yes --> AUTOF["/api/autofill → prefilled form"]
  PASTE -- no --> MAN["Manual form<br/>pin or address, weekly repeat"]
  AUTOF --> SUBMIT["POST /api/submissions"]
  MAN --> SUBMIT
  SUBMIT --> THANK["Published or pending<br/>thanks · first-place badge"]
  ACC --> MODR["#/moderate (moderators)"]
  HOME --> ABOUT["#/about · coverage"]
```
