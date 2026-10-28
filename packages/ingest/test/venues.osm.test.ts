import { describe, expect, it, vi } from 'vitest';
import { runIngest } from '../src';
import { overpass } from '../src/overpass';
import {
  linkVenues,
  parseOsmVenues,
  venueQuery,
  websiteUrl,
  type EventVenue,
} from '../src/venues/osm';
import { config, fixture, noSleep, region } from './helpers';

const tags = config.app.venues.osmTags;
const answer = JSON.parse(fixture('venues/overpass-venues.json'));
const venues = parseOsmVenues(answer.elements, tags);

describe('OSM venues (contract, Overpass response shape)', () => {
  it('asks for every configured tag inside the bbox, with centres for ways and relations', () => {
    const q = venueQuery(tags, region.bbox);
    expect(q).toContain(`nwr["amenity"~"^(theatre|arts_centre|`);
    expect(q).toContain(
      `nwr["tourism"~"^(museum|gallery)$"]["name"](51.042,16.807,51.211,17.176);`,
    );
    expect(q).toMatch(/out center tags;$/);
  });

  it('keeps named venues of a configured kind, with point, address and website', () => {
    expect(venues.map((v) => [v.osmId, v.kind])).toEqual([
      ['node/1001', 'amenity=concert_hall'],
      ['way/2002', 'amenity=nightclub'],
      ['relation/3003', 'amenity=place_of_worship'],
      ['node/6006', 'tourism=museum'],
    ]);
    expect(venues[0]).toMatchObject({
      name: 'Narodowe Forum Muzyki',
      point: { lat: 51.10795, lng: 17.02675 },
      address: 'plac Wolności 1, 50-071 Wrocław',
      website: 'https://www.nfm.wroclaw.pl/',
      wheelchair: 'yes',
    });
    expect(venues[1]).toMatchObject({
      point: { lat: 51.10565, lng: 17.03605 },
      website: 'https://klub.example/',
    });
    expect(venues[2]!.serviceTimes).toBe('Su 08:00,10:00,12:00; Mo-Sa 18:00');
    expect(venues[2]!.website).toBe('http://parafia.example/msze');
    expect(venues[3]!.website).toBeNull();
  });

  it('reads websites as OSM writes them', () => {
    expect(websiteUrl('www.teatr.example')).toBe('https://www.teatr.example/');
    expect(websiteUrl('https://a.example/x#top; https://b.example')).toBe('https://a.example/x');
    expect(websiteUrl('localhost')).toBeNull();
  });
});

describe('linkVenues', () => {
  const cfg = config.app.venues.link;
  const v = (id: string, name: string, lat: number, lng: number): EventVenue => ({
    id,
    name,
    point: { lat, lng },
    osmId: null,
    osmPoint: null,
  });

  it('links a close name nearby and moves the pin to OSM’s point', () => {
    // About 40 m from the OSM node.
    const [link] = linkVenues(
      [v('ebilet:nfm', 'Narodowe Forum Muzyki', 51.1083, 17.0267)],
      venues,
      cfg,
    );
    expect(link).toMatchObject({ venueId: 'ebilet:nfm', osmId: 'node/1001', similarity: 1 });
    expect(link!.distanceM).toBeGreaterThan(30);
    expect(link!.moveTo).toEqual({ lat: 51.10795, lng: 17.02675 });
  });

  it('links a looser name without moving the pin, and keeps a pin that is already there', () => {
    // Similarity 0.6: enough to link, not to move.
    const [loose] = linkVenues(
      [v('a', 'Forum Muzyki im. Lutosławskiego', 51.1081, 17.0268)],
      venues,
      cfg,
    );
    expect(loose?.osmId).toBe('node/1001');
    expect(loose?.moveTo).toBeNull();
    // A hall named after its building moves with it (similarity 0.9).
    const [hall] = linkVenues(
      [v('h', 'Narodowe Forum Muzyki, Sala Czerwona', 51.1081, 17.0268)],
      venues,
      cfg,
    );
    expect(hall?.moveTo).toEqual({ lat: 51.10795, lng: 17.02675 });
    const [same] = linkVenues([v('b', 'Narodowe Forum Muzyki', 51.10796, 17.02676)], venues, cfg);
    expect(same?.moveTo).toBeNull();
  });

  it('does not link a similar name far away or a different name nearby', () => {
    expect(linkVenues([v('c', 'Narodowe Forum Muzyki', 51.111, 17.0267)], venues, cfg)).toEqual([]);
    expect(linkVenues([v('d', 'Hala Stulecia', 51.1081, 17.0268)], venues, cfg)).toEqual([]);
  });
});

describe('overpass', () => {
  it('tries the next server when one refuses, and reports all when none answers', async () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).includes('first')
        ? new Response('Not Acceptable', { status: 406 })
        : Response.json({ elements: [{ type: 'node', id: 1 }] }),
    );
    const urls = ['https://first.example/api', 'https://second.example/api'];
    expect(
      await overpass('q', { urls, userAgent: 'Happow/0.4', fetch: f as typeof fetch }),
    ).toEqual([{ type: 'node', id: 1 }]);
    expect(new Headers(f.mock.calls[0]![1]!.headers).get('user-agent')).toBe('Happow/0.4');
    const down = vi.fn(async () => new Response('', { status: 504 }));
    await expect(
      overpass('q', { urls, userAgent: 'x', fetch: down as typeof fetch }),
    ).rejects.toThrow(/first\.example.*504.*second\.example.*504/);
  });

  it('treats a timed-out query as no answer', async () => {
    const f = vi.fn(async () =>
      Response.json({ elements: [], remark: 'runtime error: Query timed out' }),
    );
    await expect(
      overpass('q', { urls: ['https://a.example'], userAgent: 'x', fetch: f as typeof fetch }),
    ).rejects.toThrow(/timed out/);
  });
});

describe('osm-venues job (dry run)', () => {
  it('runs as a scheduled source and reports what it found', async () => {
    const f = vi.fn(async () => Response.json(answer));
    const [summary] = await runIngest({
      config,
      env: {},
      now: new Date('2026-10-28T12:00:00Z'),
      store: null,
      force: true,
      sourceIds: ['osm-venues'],
      fetch: f as typeof fetch,
      sleep: noSleep,
      log: () => {},
    });
    expect(summary).toMatchObject({
      sourceId: 'osm-venues',
      status: 'ok',
      stats: { osmVenues: 4, withWebsite: 3 },
    });
  });
});
