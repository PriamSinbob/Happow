import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../src';
import { nationwideDates } from '../src/follows';
import { alertMessage, sendFollowAlerts, type DueAlert } from '../src/followAlerts';
import { config, env, req, SB, supabase, type Rpc } from './helpers';

/** Search, follow matching, nationwide Ticketmaster, synced follows and new-date alerts. */

const now = () => new Date('2026-11-05T10:00:00Z');
const tmEnv = { ...env, TICKETMASTER_API_KEY: 'tm-key' };
const tmFixture = readFileSync(
  new URL('./fixtures/ticketmaster-attraction.json', import.meta.url),
  'utf8',
);

function backend(rpc: Record<string, Rpc>, cfg = config) {
  const external: string[] = [];
  const sb = supabase(rpc, {
    other: (url) => {
      // Only RPCs: the API never reads or writes a table directly here.
      if (url.startsWith(`${SB}/rest/v1/`)) throw new Error(`table access: ${url}`);
      external.push(url);
      return url.startsWith('https://app.ticketmaster.com/')
        ? new Response(tmFixture, { headers: { 'content-type': 'application/json' } })
        : undefined;
    },
  });
  const api = createApi(tmEnv, { config: cfg, fetch: sb.fetch, now, extractor: null });
  return { ...sb, api, external };
}

const row = {
  id: 'ticketmaster:Z698xZb_Z17a0kA',
  title: 'Dawid Podsiadło',
  category_ids: ['music'],
  start_at: '2026-11-14T19:00:00+00:00',
  end_at: '2026-11-14T22:00:00+00:00',
  timezone: 'Europe/Warsaw',
  venue_name: 'Hala Stulecia',
  lat: 51.1069,
  lng: 17.0773,
  distance_m: 2412.6,
  is_free: false,
  status: 'scheduled',
  performers: ['Dawid Podsiadło'],
  matched_performer: 'Dawid Podsiadło',
};

describe('GET /api/search', () => {
  it('asks search_events for the region up to the horizon, with config thresholds', async () => {
    const b = backend({
      search_events: () => ({ body: [{ ...row, match: 'performer', score: 1 }] }),
    });
    const res = await b.api(req('search?q=%20podsiadlo%20&lat=51.11&lng=17.03'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      `public, max-age=${config.app.search.cacheSeconds}`,
    );
    const { results } = (await res.json()) as { results: { id: string; distanceM: number }[] };
    expect(results[0]).toMatchObject({ id: row.id, distanceM: 2413, match: 'performer' });
    const [c] = b.call('search_events');
    expect(c!.args).toMatchObject({
      q: 'podsiadlo',
      p_region: 'wroclaw',
      p_lat: 51.11,
      p_lng: 17.03,
      from_ts: '2026-11-05T10:00:00.000Z',
      max_results: config.app.search.maxResults,
      min_similarity: config.app.search.minSimilarity,
    });
    const horizon = new Date(c!.args.to_ts as string).getTime() - now().getTime();
    expect(horizon).toBe(config.app.ingest.lookaheadHours * 3_600_000);
    expect(b.call('rate_limit_hit')[0]!.args).toMatchObject({
      p_bucket: 'search',
      p_max: config.app.search.perHourPerClient,
    });
  });

  it('refuses one character or over 80, and answers 429 past the hourly limit', async () => {
    const b = backend({ search_events: () => ({ body: [] }) });
    expect((await b.api(req('search?q=a'))).status).toBe(400);
    expect((await b.api(req(`search?q=${'x'.repeat(81)}`))).status).toBe(400);
    expect(b.call('search_events')).toHaveLength(0);
    const c = backend({ rate_limit_hit: () => ({ body: false }) });
    expect((await c.api(req('search?q=kult'))).status).toBe(429);
  });
});

describe('POST /api/follows/match', () => {
  const follows = [
    { name: 'Dawid  Podsiadło', tmAttractionId: 'K8vZ9175Tr0' },
    { name: 'Kult' },
    { name: 'kult' },
  ];

  it('matches by name and attraction id and stores nothing about the list', async () => {
    const b = backend({
      follows_match: () => ({ body: [{ ...row, matched_norm: 'dawid podsiadlo' }] }),
      follow_lookups_get: () => ({
        body: {
          K8vZ9175Tr0: {
            fetchedAt: '2026-11-05T09:00:00Z',
            events: nationwideDates('K8vZ9175Tr0', JSON.parse(tmFixture)),
          },
        },
      }),
    });
    const res = await b.api(req('follows/match', { body: { follows, lat: 51.1, lng: 17.03 } }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { matches: unknown[]; nationwide: { city: string }[] };
    expect(out.matches).toHaveLength(1);
    // Wrocław's own date is on the map already; the cancelled Gdańsk date is left out.
    expect(out.nationwide.map((d) => d.city)).toEqual(['Warszawa']);
    expect(b.call('follows_match')[0]!.args).toMatchObject({
      p_norms: ['dawid podsiadlo', 'kult'],
      p_tm_ids: ['K8vZ9175Tr0'],
      p_region: 'wroclaw',
    });
    // A fresh cache: no call to Ticketmaster, and no write anywhere.
    expect(b.external).toEqual([]);
    const writes = b.calls.filter(
      (c) => !['rate_limit_hit', 'follows_match', 'follow_lookups_get'].includes(c.name),
    );
    expect(writes).toEqual([]);
  });

  it('looks an attraction up nationwide once its cache is a day old, and caches the answer', async () => {
    const b = backend({
      follows_match: () => ({ body: [] }),
      follow_lookups_get: () => ({
        body: { K8vZ9175Tr0: { fetchedAt: '2026-11-04T08:00:00Z', events: [] } },
      }),
      follow_lookups_put: () => ({ body: null }),
    });
    const res = await b.api(req('follows/match', { body: { follows } }));
    const out = (await res.json()) as { nationwide: { venueName: string; url: string }[] };
    expect(out.nationwide).toEqual([
      expect.objectContaining({
        venueName: 'PGE Narodowy',
        url: expect.stringContaining('ticketmaster.pl'),
      }),
    ]);
    const u = new URL(b.external[0]!);
    expect(u.searchParams.get('attractionId')).toBe('K8vZ9175Tr0');
    expect(u.searchParams.get('countryCode')).toBe('PL');
    expect(b.call('follow_lookups_put')[0]!.args.p_id).toBe('K8vZ9175Tr0');
    // The daily cap shared by everyone.
    expect(b.call('rate_limit_hit').map((c) => c.args.p_bucket)).toContain('tm-follow-lookup');
  });

  it('skips the lookup past the daily cap, keeping the old answer', async () => {
    const b = backend({
      rate_limit_hit: (a) => ({ body: a.p_bucket !== 'tm-follow-lookup' }),
      follows_match: () => ({ body: [] }),
      follow_lookups_get: () => ({ body: {} }),
    });
    const res = await b.api(req('follows/match', { body: { follows } }));
    expect(res.status).toBe(200);
    expect(b.external).toEqual([]);
  });

  it('validates the body: at most follows.max names', async () => {
    const b = backend({});
    const many = Array.from({ length: config.app.follows.max + 1 }, (_, i) => ({
      name: `Band ${i}`,
    }));
    expect((await b.api(req('follows/match', { body: { follows: many } }))).status).toBe(400);
    expect((await b.api(req('follows/match', { body: { follows: [{ name: 'x' }] } }))).status).toBe(
      400,
    );
  });
});

describe('follows on the account', () => {
  it('syncs with follows.sync, normalising the names', async () => {
    const b = backend({ follows_sync: () => ({ body: [{ name: 'Kult', norm: 'kult' }] }) });
    const res = await b.api(
      req('me/follows', {
        token: 'user-token',
        body: { items: [{ name: 'Kult', changedAt: '2026-11-05T09:00:00Z' }] },
      }),
    );
    expect(res.status).toBe(200);
    expect(b.call('follows_sync')[0]!.args).toMatchObject({
      p_user: 'u1',
      p_items: [{ name: 'Kult', norm: 'kult', removed: false }],
      p_max: config.app.follows.max,
    });
    expect((await b.api(req('me/follows', { body: { items: [] } }))).status).toBe(401);
  });

  it('refuses sync and alerts outside the plan', async () => {
    const noPremium = {
      ...config,
      plans: { ...config.plans, earlyAccess: null },
    };
    const b = backend(
      { follows_sync: () => ({ body: [] }), follow_alerts_set: () => ({ body: null }) },
      noPremium,
    );
    expect(
      (await b.api(req('me/follows', { token: 'user-token', body: { items: [] } }))).status,
    ).toBe(403);
    expect(
      (
        await b.api(
          req('me/follows/alerts', { token: 'user-token', method: 'PUT', body: { on: true } }),
        )
      ).status,
    ).toBe(403);
    // Switching off is always allowed.
    expect(
      (
        await b.api(
          req('me/follows/alerts', { token: 'user-token', method: 'PUT', body: { on: false } }),
        )
      ).status,
    ).toBe(200);
  });
});

describe('new-date alerts', () => {
  const alert: DueAlert = {
    id: 7,
    eventId: 'ticketmaster:Z698xZb_Z17a0kA',
    title: 'Dawid Podsiadło – Trasa 2026',
    venue: 'Hala Stulecia',
    performer: 'Dawid Podsiadło',
    startAt: '2026-11-14T19:00:00Z',
    timezone: 'Europe/Warsaw',
    hidden: false,
    status: 'scheduled',
    subscriptions: [],
  };

  it('says who has a new date, when and where, in the subscription’s language', () => {
    expect(alertMessage(alert, 'pl')).toEqual({
      title: 'Nowy termin: Dawid Podsiadło',
      body: expect.stringMatching(/^Dawid Podsiadło – Trasa 2026 · .*20:00 · Hala Stulecia$/),
      url: '/e/ticketmaster%3AZ698xZb_Z17a0kA',
      tag: 'follow:ticketmaster:Z698xZb_Z17a0kA',
    });
    expect(alertMessage(alert, 'en').title).toBe('New date: Dawid Podsiadło');
  });

  it('queues, then marks alerts with nowhere to go as done', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const name = String(input).split('/rpc/')[1]!;
      calls.push(name);
      if (name === 'follow_alerts_queue') return Response.json(1);
      if (name === 'follow_alerts_due') return Response.json([alert]);
      if (name === 'follow_alerts_done') {
        expect(JSON.parse(String(init.body)).p_ids).toEqual([7]);
        return Response.json(null);
      }
      return new Response('{}', { status: 404 });
    });
    const secret = JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
      y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
      d: 'jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI',
    });
    const r = await sendFollowAlerts(
      { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'k', VAPID_PRIVATE_KEY: secret },
      now(),
      { fetch: f as typeof fetch },
    );
    expect(r).toMatchObject({ queued: 1, due: 1, sent: 0 });
    expect(calls).toEqual(['follow_alerts_queue', 'follow_alerts_due', 'follow_alerts_done']);
  });
});
