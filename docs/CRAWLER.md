# Happow crawler

Happow is a free map of events happening near you (concerts, markets, talks), starting in Wrocław, Poland. Its crawler identifies itself as:

```
Happow/0.4 (+https://github.com/PriamSinbob/Happow/blob/main/docs/CRAWLER.md)
```

## What it does

- Reads public event listing pages, at most **once a day** per site, with at least **5 seconds** between requests and one request at a time.
- Obeys `robots.txt`. To block it, add `User-agent: Happow` and `Disallow: /`.
- Takes only facts: title, date and time, venue, address, price and the link. It does **not** copy descriptions or images. Every event in the app links back to the page it came from.
- Reads schema.org Event data (JSON-LD) when a page has it. For a few pages without it, the page text is sent to an AI model (Claude, by Anthropic) to pull out those same facts. The page text is not stored; only the extracted facts are kept.
- Keeps events only while they are current, and drops events that are no longer listed.

## Opting out or asking for changes

Open an issue at https://github.com/PriamSinbob/Happow/issues (a contact email will be listed here before public launch). We stop crawling a site within 48 hours of a request and remove its events from the app. Every source has an on/off switch in `config/sources.json`.

## Sources

| Site                 | Status                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| wroclaw.pl/go (ARAW) | Daily; asking ARAW for consent or a feed                                            |
| nfm.wroclaw.pl       | Daily, about 25 pages                                                               |
| ebilet.pl            | **Paused** until eBilet gives written consent (its terms limit use to personal use) |
