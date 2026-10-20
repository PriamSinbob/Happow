import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adapters, HttpClient, normalize, parsedEventSchema } from '../src';
import { isoDurationMs } from '../src/adapters/meetup';
import { config, fixture, region, replayFetch, source } from './helpers';

const mu = source('meetup');
const now = new Date('2026-10-24T05:00:00Z');
const window = { from: new Date('2026-10-23T21:00:00Z'), to: new Date('2026-10-26T05:00:00Z') };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  MEETUP_CLIENT_KEY: 'client-key',
  MEETUP_MEMBER_ID: '123456',
  MEETUP_SIGNING_KEY_ID: 'kid-1',
  // Stored with literal \n, as GitHub Secrets often hold it.
  MEETUP_PRIVATE_KEY: privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString()
    .replace(/\n/g, '\\n'),
};

async function fetchAll(
  bodies = ['meetup/token.json', 'meetup/page-0.json', 'meetup/page-1.json'],
) {
  const replay = replayFetch(bodies.map(fixture));
  const http = new HttpClient({ userAgent: config.app.ingest.userAgent, fetch: replay.fetch });
  const raws = await adapters.meetup!.fetch({ source: mu, region, window, http, env, now });
  return { raws, calls: replay.calls };
}

function parseAll(raws: Awaited<ReturnType<typeof fetchAll>>['raws']) {
  return raws.map((raw) => {
    const parsed = adapters.meetup!.parse(raw, { source: mu, region });
    if (!parsed) return { id: raw.externalId, dropped: true as const };
    expect(() => parsedEventSchema.parse(parsed)).not.toThrow();
    const res = normalize(parsed, {
      source: mu,
      region,
      categories: config.categories,
      h3Resolution: 9,
      descriptionMaxChars: 600,
      now,
    });
    return { id: raw.externalId, dropped: false as const, res };
  });
}

describe('Meetup adapter (contract, recorded fixtures)', () => {
  it('gets a token with a signed RS256 JWT assertion', async () => {
    const { calls } = await fetchAll();
    expect(calls[0]!.url).toBe('https://secure.meetup.com/oauth2/access');
    const form = new URLSearchParams(calls[0]!.init.body as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, c, sig] = form.get('assertion')!.split('.');
    const header = JSON.parse(Buffer.from(h!, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
    expect(header).toEqual({ kid: 'kid-1', typ: 'JWT', alg: 'RS256' });
    expect(claims).toMatchObject({ sub: '123456', iss: 'client-key', aud: 'api.meetup.com' });
    expect(claims.exp).toBe(Math.floor(now.getTime() / 1000) + 120);
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, sig!, 'base64url');
    expect(ok).toBe(true);
  });

  it('searches around the region with the bearer token and follows the cursor', async () => {
    const { calls } = await fetchAll();
    expect(calls).toHaveLength(3);
    const [first, second] = [calls[1]!, calls[2]!].map((c) => JSON.parse(c.init.body as string));
    expect(calls[1]!.url).toBe('https://api.meetup.com/gql-ext');
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-access-token',
    );
    expect(first.query).toContain('eventSearch');
    expect(first.variables).toMatchObject({ first: 50, after: null });
    expect(first.variables.filter).toMatchObject({
      startDateRange: window.from.toISOString(),
      endDateRange: window.to.toISOString(),
    });
    expect(first.variables.filter.lat).toBeCloseTo(51.1265, 3);
    expect(first.variables.filter.radius).toBeGreaterThanOrEqual(6); // miles
    expect(second.variables.after).toBe('Y3Vyc29yOjM=');
  });

  it('maps in-person meetups and drops online-only ones', async () => {
    const results = parseAll((await fetchAll()).raws);
    expect(results).toHaveLength(5);
    expect(results.find((r) => r.id === '311000002')!.dropped).toBe(true);

    const ok = (id: string) => {
      const r = results.find((x) => x.id === id)!;
      if (r.dropped || !r.res.ok) throw new Error(`expected ${id} to normalize`);
      return r.res.value.event;
    };
    expect(ok('311000001')).toMatchObject({
      title: 'Wrocław JS #87: Signals, Servers and Suspense',
      categoryIds: ['talk'],
      startAt: '2026-10-24T16:00:00.000Z',
      endAt: '2026-10-24T18:30:00.000Z',
      endEstimated: false,
      isFree: true,
      officialUrl: 'https://www.meetup.com/wroclaw-js/events/311000001/',
      imageUrl:
        'https://secure-content.meetupstatic.com/images/classic-events/523000001/676x380.webp',
      venue: { name: 'Business Link Wrocław', address: 'ul. Szewska 3A, 50-139 Wrocław' },
    });
    expect(ok('311000001').description).toBe(
      'Agenda 1. Signals deep dive – Anna 2. Pizza & networking',
    );
    expect(ok('311000003')).toMatchObject({
      categoryIds: ['happening'],
      isFree: false,
      priceMin: 10,
      currency: 'PLN',
      description: 'Gramy w Azul, Wingspan i więcej.',
    });
    expect(ok('311000004')).toMatchObject({
      status: 'cancelled',
      categoryIds: ['sport'],
      endEstimated: true,
    });
    const noPlace = results.find((r) => r.id === '311000005')!;
    expect(!noPlace.dropped && !noPlace.res.ok && noPlace.res.reason).toBe('no-location');
  });

  it('surfaces GraphQL errors', async () => {
    const replay = replayFetch([
      fixture('meetup/token.json'),
      JSON.stringify({
        data: null,
        errors: [{ message: 'slow down', extensions: { code: 'RATE_LIMITED' } }],
      }),
    ]);
    const http = new HttpClient({ userAgent: 'test', fetch: replay.fetch });
    await expect(
      adapters.meetup!.fetch({ source: mu, region, window, http, env, now }),
    ).rejects.toThrow(/RATE_LIMITED/);
  });

  it('parses ISO 8601 durations', () => {
    expect(isoDurationMs('PT2H30M')).toBe(9_000_000);
    expect(isoDurationMs('P1DT1H')).toBe(25 * 3_600_000);
    expect(isoDurationMs('PT0S')).toBeNull();
    expect(isoDurationMs('soon')).toBeNull();
  });
});
