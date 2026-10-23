# Happow — instructions for Claude Code

- Read `docs/BRIEF.md` before any work. Its Decisions table is fixed unless the owner changes it.
- Work milestone by milestone (see "Milestones and build-agent instructions" in the brief). Plan first, show the plan, then build.
- Every source, region, category and provider lives in config; no city names or API keys in code.
- Secrets only in GitHub Secrets or local `.env` files (never committed); keep `.env.example` current.
- Each data adapter gets a contract test against recorded fixtures; no live API calls in CI.
- UI is mobile-first (380 px), polished, Polish and English strings from the start.
- UI work matches `docs/design/` (interactive prototype and exact icons; see its README). Open the prototype before building a screen; don't redraw its icons or invent alternatives. Deviations need the owner's OK first.
- End each milestone with a short report: built, skipped, open issues.
