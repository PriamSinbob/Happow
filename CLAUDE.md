# Happow — instructions for Claude Code

- Read `README.md` (principles, layout) and `docs/ARCHITECTURE.md` before any work.
- Config, not code: every source, region, category and provider lives in `config/`; no city names or API keys in code.
- Secrets only in GitHub Secrets or local `.env` files (never committed); keep `.env.example` current.
- Each data adapter gets a contract test against recorded fixtures; no live API calls in CI.
- UI is mobile-first (380 px), with Polish and English strings from the start.
- UI follows `docs/DESIGN.md`; new icons need the owner's OK first.
- Unbuilt ideas go in `docs/FUTURE.md`; launch to-dos go in `docs/LAUNCH.md`.
