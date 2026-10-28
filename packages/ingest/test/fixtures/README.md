# Adapter fixtures

Contract tests replay these files instead of calling the live APIs (no live calls in CI).

The current files follow each provider's documented response shape. The IDs, venues and
programmes are illustrative, because no API keys were available when they were written. Once
keys are set up, replace them with real recordings:

```sh
pnpm ingest --dry-run --source ticketmaster --record packages/ingest/test/fixtures
pnpm ingest --dry-run --source meetup --record packages/ingest/test/fixtures
```

`threads/` is hand-built from the documented `keyword_search` response (no token yet; the
source waits for Meta App Review). Usernames in the permalinks are placeholders.

Recording writes `<source>/page-N.json`, masks `apikey=` values, and never stores OAuth token
responses. Recorded pages hold real event times, so after re-recording, update the test's
`now` and the expected values.

`venues/` (M12 slice C):

- `tec-demo.ics` and `tribe-demo.json` are real recordings (2026-10-28) from The Events
  Calendar's own demo site (demo.theeventscalendar.com), trimmed to a few events. Its venues
  are in the US, so tests read them with a test region around them.
- `google-holidays.ics` is a real Google Calendar export (Polish public holidays), trimmed to
  three all-day events.
- `wroclaw-club.ics`, `overpass-venues.json` and the `site-*.html` pages are hand-built in the
  real formats: no Wrocław venue site checked so far publishes a feed, and Overpass refused
  this machine when the slice was written. The club, parish and museum are made up; the NFM
  entry uses the real address.
