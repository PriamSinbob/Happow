# Happow — instructions for Claude Code

- Read `README.md` (direction, principles, layout) and `docs/ARCHITECTURE.md` before any work; read `docs/API.md` before touching `/api`, and `docs/NATIVE.md` for anything the apps need.
- Happow is an Android app first, then iOS, built in separate repositories against this one's API. This repository is the server, database, ingest, config and the web app.
- The web app is the reference client, the shared-link page and the embed. Never delete web or PWA functionality; new behaviour is built and tested here first.
- One API for every client: apps and the web read and write through `/api` and sign in with Supabase Auth; no client calls the database.
- Never break an installed app: add fields and endpoints, never rename, remove or change the meaning of one. Shapes both sides name go in `packages/core/src/wire.ts`; every endpoint goes in `docs/API.md` with its test.
- Config, not code: every source, region, category and provider lives in `config/`; no city names or API keys in code. Apps read config from `GET /api/config`.
- Secrets only in GitHub Secrets or local `.env` files (never committed); keep `.env.example` current.
- Each data adapter gets a contract test against recorded fixtures; no live API calls in CI.
- UI is mobile-first (380 px), with Polish and English strings from the start.
- UI follows `docs/DESIGN.md`; new icons need the owner's OK first.
- Unbuilt ideas go in `docs/FUTURE.md`; launch to-dos go in `docs/LAUNCH.md`.
- Run checks once, at the end: no tests, typecheck or build until the owner gives the green light at the end of the conversation. Small changes usually follow a first version, and every rerun costs time and money. Formatting the files you touched is fine at any time.
- Commit locally as you go and push once, on that same green light: every push starts CI and a preview build. A push that changes only `CLAUDE.md` or `README.md` carries `[skip ci]`.
- Do not grow the test suite for its own sake: no tests that restate config values, repeat an assertion made at another layer, or pin CSS or SVG strings.
