# Adapter fixtures

Contract tests replay these files instead of calling the live APIs (no live calls in CI).

The current files follow each provider's documented response shape. The IDs, venues and
programmes are illustrative, because no API keys were available when they were written. Once
keys are set up, replace them with real recordings:

```sh
pnpm ingest --dry-run --source ticketmaster --record packages/ingest/test/fixtures
pnpm ingest --dry-run --source meetup --record packages/ingest/test/fixtures
```

Recording writes `<source>/page-N.json`, masks `apikey=` values, and never stores OAuth token
responses. Recorded pages hold real event times, so after re-recording, update the test's
`now` and the expected values.
