import { describe, expect, it } from 'vitest';
import {
  eventsFromJsonLd,
  extractJsonLd,
  findLinks,
  htmlToText,
  pageMeta,
  parseRobots,
  productToken,
  resolveInstant,
} from '../src';
import { fixture } from './helpers';

describe('JSON-LD (recorded pages)', () => {
  it('reads every Event in an eBilet ItemList listing', () => {
    const events = eventsFromJsonLd(
      extractJsonLd(fixture('ebilet-listing.html')),
      'https://www.ebilet.pl/miasto/wroclaw',
    );
    expect(events.length).toBeGreaterThanOrEqual(20);
    // The "Wrocław" listing also carries touring shows in other cities; the crawler filters by city.
    const local = events.filter((x) => x.address.city === 'Wrocław');
    expect(local.length).toBeGreaterThan(5);
    expect(local.length).toBeLessThan(events.length);
    const e = local[0]!;
    expect(e.title).toBeTruthy();
    expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(e.address.city).toBe('Wrocław');
    expect(e.address.street).toBeTruthy();
    expect(e.url).toMatch(/^https:\/\/www\.ebilet\.pl\//);
    expect(e.method).toBe('jsonld');
    // eBilet publishes no coordinates: these events must be geocoded.
    expect(events.every((x) => x.point === null)).toBe(true);
  });

  it('reads a city-portal event page with offers and a venue', () => {
    const [e, ...rest] = eventsFromJsonLd(
      extractJsonLd(fixture('go-event-1.html')),
      'https://www.wroclaw.pl/go/wydarzenia/edukacja-i-rozwoj/1416880-cool-moms-club',
    );
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      title: 'Cool Moms Club: meet, yoga & chill',
      start: '2026-10-27T12:00',
      end: null,
      venueName: 'Clara Wellness Studio',
      address: { postalCode: '50-102', street: null },
      isFree: false,
      priceMin: 89,
      currency: 'PLN',
      online: false,
      status: 'scheduled',
    });
  });

  it('expands an EventSeries into its dated occurrences, inheriting the place', () => {
    const events = eventsFromJsonLd(
      extractJsonLd(fixture('go-event-2.html')),
      'https://www.wroclaw.pl/go/wydarzenia/dla-dzieci/1403864-bajkowe-poranki-w-centrum-historii-zajezdnia-1',
    );
    expect(events.length).toBeGreaterThan(1);
    for (const e of events) {
      expect(e.title).toBe('Bajkowe Poranki w Centrum Historii Zajezdnia');
      expect(e.venueName).toBe('Centrum Historii Zajezdnia');
      expect(e.address).toMatchObject({ street: 'Grabiszyńska 184', postalCode: '50-102' });
    }
    expect(new Set(events.map((e) => e.start)).size).toBe(events.length);
  });

  it('finds nothing on pages without structured data', () => {
    expect(eventsFromJsonLd(extractJsonLd(fixture('nfm-event.html')), 'https://x.example')).toEqual(
      [],
    );
  });

  it('handles @graph, subtypes, statuses, free events, online events and broken JSON', () => {
    const html = `
      <script type="application/ld+json">{"@graph":[
        {"@type":"MusicEvent","name":"Jazz &amp; Wine","startDate":"2026-10-24T19:00:00+02:00",
         "eventStatus":"https://schema.org/EventCancelled","isAccessibleForFree":true,
         "location":{"@type":"Place","name":"Klub","geo":{"latitude":"51.11","longitude":"17.03"}}},
        {"@type":["Event","Festival"],"name":"Online talk","startDate":"2026-10-25",
         "location":{"@type":"VirtualLocation","url":"https://meet.example"}},
        {"@type":"Event","name":"No date"}
      ]}</script>
      <script type="application/ld+json">{"@type":"Event","name":"Trailing","startDate":"2026-10-26",}</script>
      <script type="application/ld+json">{not json at all</script>`;
    const events = eventsFromJsonLd(extractJsonLd(html), 'https://x.example/page');
    expect(events.map((e) => e.title)).toEqual(['Jazz & Wine', 'Online talk', 'Trailing']);
    expect(events[0]).toMatchObject({
      status: 'cancelled',
      isFree: true,
      point: { lat: 51.11, lng: 17.03 },
      categoryHints: ['musicevent'],
    });
    expect(events[1]).toMatchObject({ online: true, categoryHints: ['festival'] });
  });
});

describe('page text and links', () => {
  it('drops scripts and chrome, keeps the event text', () => {
    const text = htmlToText(fixture('nfm-event.html'));
    expect(text).toContain('Pustynne portato');
    expect(text).toContain('plac Wolności 1');
    expect(text).not.toMatch(/<|function\s*\(/);
    expect(htmlToText(fixture('nfm-event.html'), 200).length).toBeLessThanOrEqual(200);
  });

  it('finds event links on listing pages', () => {
    const go = findLinks(
      fixture('go-listing.html'),
      'https://www.wroclaw.pl/go/',
      /^https:\/\/www\.wroclaw\.pl\/go\/wydarzenia\/[a-z-]+\/\d+-/,
    );
    expect(go.length).toBeGreaterThan(20);
    const nfm = findLinks(
      fixture('nfm-listing.html'),
      'https://www.nfm.wroclaw.pl/component/nfmcalendar',
      /\/pl\/component\/nfmcalendar\/event\/\d+$/,
    );
    expect(nfm.length).toBeGreaterThan(5);
    expect(nfm.every((u) => u.startsWith('https://www.nfm.wroclaw.pl/'))).toBe(true);
  });

  it('reads page metadata', () => {
    const m = pageMeta(fixture('go-event-1.html'));
    expect(m.title).toContain('Cool Moms Club');
  });
});

describe('robots.txt', () => {
  const ua = productToken('Happow/0.4 (+https://github.com/PriamSinbob/Happow)');

  it('follows the recorded rules of the crawl targets', () => {
    const ebilet = parseRobots(fixture('ebilet-robots.txt'), ua);
    expect(ebilet.isAllowed('https://www.ebilet.pl/miasto/wroclaw')).toBe(true);
    expect(ebilet.isAllowed('https://www.ebilet.pl/api/events')).toBe(false);
    const city = parseRobots(fixture('wroclaw-robots.txt'), ua);
    expect(city.isAllowed('https://www.wroclaw.pl/go/')).toBe(true);
    expect(city.isAllowed('https://www.wroclaw.pl/rss.xml')).toBe(false);
  });

  it('prefers our own group, longest match and Allow on ties, with wildcards', () => {
    const r = parseRobots(
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: happow',
        'Disallow: /private',
        'Allow: /private/public',
        'Disallow: /*.pdf$',
      ].join('\n'),
      ua,
    );
    expect(r.isAllowed('https://a.example/events')).toBe(true);
    expect(r.isAllowed('https://a.example/private/x')).toBe(false);
    expect(r.isAllowed('https://a.example/private/public/x')).toBe(true);
    expect(r.isAllowed('https://a.example/file.pdf')).toBe(false);
    expect(r.isAllowed('https://a.example/file.pdf?x=1')).toBe(true);
    expect(parseRobots('', ua).isAllowed('https://a.example/x')).toBe(true);
  });
});

describe('resolveInstant', () => {
  it('honours offsets and reads local values in the region time zone', () => {
    expect(resolveInstant('2026-10-24T19:00:00+02:00', 'Europe/Warsaw')?.at.toISOString()).toBe(
      '2026-10-24T17:00:00.000Z',
    );
    expect(resolveInstant('2026-12-28T19:00:00', 'Europe/Warsaw')).toEqual({
      at: new Date('2026-12-28T18:00:00.000Z'),
      allDay: false,
    });
    expect(resolveInstant('2026-10-24', 'Europe/Warsaw')).toEqual({
      at: new Date('2026-10-23T22:00:00.000Z'),
      allDay: true,
    });
    expect(resolveInstant('soon', 'Europe/Warsaw')).toBeNull();
  });
});
