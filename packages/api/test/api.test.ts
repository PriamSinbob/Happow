import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Extractor, Geocoder } from '@happow/extract';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';

const page = (name: string) =>
  readFileSync(new URL(`../../extract/test/fixtures/${name}`, import.meta.url), 'utf8');

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
const now = () => new Date('2026-10-20T20:00:00Z');

interface Backend {
  rpc: Record<string, (args: Record<string, unknown>) => { status?: number; body: unknown }>;
  pages?: Record<string, string>;
  users?: Record<string, string>;
}

/** Fake Supabase (PostgREST RPC + GoTrue) and web, recording every call. */
function backend(b: Backend) {
  const calls: { name: string; args: Record<string, unknown>; headers: Headers }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
      const name = url.slice(`${SB}/rest/v1/rpc/`.length);
      const args = JSON.parse(String(init.body ?? '{}'));
      calls.push({ name, args, headers });
      const handler = b.rpc[name];
      if (!handler) return new Response('{}', { status: 404 });
      const { status = 200, body } = handler(args);
      return new Response(JSON.stringify(body), { status });
    }
    if (url === `${SB}/auth/v1/user`) {
      const token = headers.get('authorization')?.replace('Bearer ', '') ?? '';
      const email = b.users?.[token];
      return email
        ? new Response(JSON.stringify({ email }), { status: 200 })
        : new Response('{"msg":"invalid"}', { status: 401 });
    }
    const html = b.pages?.[url];
    if (html !== undefined)
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('not found', { status: 404 });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

const geocoder: Geocoder = {
  geocode: async () => ({ point: { lat: 51.1079, lng: 17.0385 }, precision: 'venue', label: 'x' }),
};
// URL autofill is off in the PoC config (planned paid add-on); these tests switch it on.
const base = loadConfig();
const autofillOn = {
  ...base,
  app: { ...base.app, submissions: { ...base.app.submissions, autofill: true } },
};
const withAutofill = (...[env, deps]: Parameters<typeof createApi>) =>
  createApi(env, { config: autofillOn, ...deps });

const allow = { rate_limit_hit: () => ({ body: true }) };

const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: JSON.stringify(payload),
  });

describe('POST /api/autofill', () => {
  const goUrl = 'https://www.wroclaw.pl/go/wydarzenia/edukacja-i-rozwoj/1416880-cool-moms-club';

  it('prefills from JSON-LD, geocodes the place and rate-limits by hashed IP', async () => {
    const web = backend({ rpc: allow, pages: { [goUrl]: page('go-event-1.html') } });
    const api = withAutofill(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('autofill', { url: goUrl }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.method).toBe('jsonld');
    expect(data.events[0]).toMatchObject({
      title: 'Cool Moms Club: meet, yoga & chill',
      start: '2026-10-27T12:00',
      venueName: 'Clara Wellness Studio',
      point: { lat: 51.1079, lng: 17.0385 },
      isFree: false,
      priceMin: 89,
      url: goUrl,
    });
    // Descriptions are not copied into submissions (copyright: facts only).
    expect(data.events[0]).not.toHaveProperty('description');
    const rl = web.calls.find((c) => c.name === 'rate_limit_hit')!;
    expect(rl.args).toMatchObject({ p_bucket: 'autofill', p_window_seconds: 3600 });
    expect(String(rl.args.p_actor)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(rl.args.p_actor)).not.toContain('203.0.113.7');
    expect(rl.headers.get('apikey')).toBe('service-key');
  });

  it('falls back to the LLM on pages without structured data', async () => {
    const url = 'https://www.nfm.wroclaw.pl/pl/component/nfmcalendar/event/14132';
    const extract = vi.fn<Extractor['extract']>(async () => [
      {
        title: 'Pustynne portato',
        description: null,
        start: '2026-11-22T10:00',
        end: null,
        venueName: 'NFM, Sala Czerwona',
        address: {
          street: 'plac Wolności 1',
          postalCode: '50-071',
          city: 'Wrocław',
          country: null,
        },
        point: null,
        isFree: false,
        priceMin: 35,
        priceMax: 120,
        currency: 'PLN',
        url: null,
        ticketUrl: null,
        imageUrl: null,
        status: 'scheduled',
        online: false,
        categoryHints: [],
        categoryIds: ['kids', 'music'],
        method: 'llm',
        confidence: 0.9,
      },
    ]);
    const web = backend({ rpc: allow, pages: { [url]: page('nfm-event.html') } });
    const api = withAutofill(env, {
      fetch: web.fetch,
      now,
      geocoder,
      extractor: { id: 'fake', extract },
    });
    const data = await (await api(post('autofill', { url }))).json();
    expect(data.method).toBe('llm');
    expect(data.events[0]).toMatchObject({
      title: 'Pustynne portato',
      categoryIds: ['kids', 'music'],
    });
    expect(extract.mock.calls[0]![0]).toMatchObject({
      today: '2026-10-20',
      timeZone: 'Europe/Warsaw',
    });
  });

  it('skips the LLM once the global daily cap is used up, or when it fails', async () => {
    const url = 'https://www.nfm.wroclaw.pl/pl/component/nfmcalendar/event/1';
    const extract = vi.fn(async () => {
      throw new Error('credit balance too low');
    });
    const capped = backend({
      rpc: {
        rate_limit_hit: (args: Record<string, unknown>) => ({
          body: args.p_bucket !== 'autofill-llm',
        }),
      },
      pages: { [url]: page('nfm-event.html') },
    });
    const deps = { now, geocoder, extractor: { id: 'fake', extract } };
    const off = await (
      await withAutofill(env, { ...deps, fetch: capped.fetch })(post('autofill', { url }))
    ).json();
    expect(off).toMatchObject({ method: 'none', events: [] });
    expect(extract).not.toHaveBeenCalled();
    expect(capped.calls.find((c) => c.args.p_bucket === 'autofill-llm')!.args).toMatchObject({
      p_actor: 'global',
      p_window_seconds: 86_400,
    });

    const open = backend({ rpc: allow, pages: { [url]: page('nfm-event.html') } });
    const res = await withAutofill(env, { ...deps, fetch: open.fetch })(post('autofill', { url }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ method: 'none', events: [] });
    expect(extract).toHaveBeenCalledOnce();
  });

  it('refuses private addresses and reports unreachable pages', async () => {
    const web = backend({ rpc: allow });
    const api = withAutofill(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const bad = await api(post('autofill', { url: 'http://169.254.169.254/latest/meta-data' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('unsafe_url');
    const gone = await api(post('autofill', { url: 'https://gone.example/event' }));
    expect(gone.status).toBe(422);
  });

  it('answers 503 until the server is configured, and 429 when over the limit', async () => {
    const api503 = withAutofill({}, { now, geocoder, extractor: null });
    expect((await api503(post('autofill', { url: 'https://x.example' }))).status).toBe(503);
    const web = backend({ rpc: { rate_limit_hit: () => ({ body: false }) } });
    const api = withAutofill(env, { fetch: web.fetch, now, geocoder, extractor: null });
    expect((await api(post('autofill', { url: 'https://x.example' }))).status).toBe(429);
  });
});

describe('POST /api/submissions', () => {
  const valid = {
    deviceId: 'device-0123456789',
    event: {
      title: 'Wyprzedaż garażowa na Ruskiej',
      categoryIds: ['garage-sale'],
      venueName: 'Podwórko Ruska 46',
      address: 'ul. Ruska 46, Wrocław',
      point: { lat: 51.1105, lng: 17.0255 },
      start: '2026-10-24T10:00',
      end: '2026-10-24T14:00',
      isFree: true,
      url: null,
      description: 'Książki, płyty, rowery.',
    },
  };

  it('normalizes, hashes the device and publishes as unverified', async () => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('submissions', valid));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.status).toBe('published');
    expect(out.eventId).toBe(`submissions:${out.id}`);
    const call = web.calls.find((c) => c.name === 'submit_event')!;
    expect(call.args.p_publish).toBe(true);
    expect(call.args.p_region).toBe('wroclaw');
    expect(String(call.args.p_submitter)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call.args)).not.toContain('device-0123456789');
    const n = (call.args.p as { normalized: { event: Record<string, unknown>; sourceId: string } })
      .normalized;
    expect(n.sourceId).toBe('submissions');
    expect(n.event).toMatchObject({
      title: 'Wyprzedaż garażowa na Ruskiej',
      startAt: '2026-10-24T08:00:00.000Z',
      endAt: '2026-10-24T12:00:00.000Z',
      trust: 'community',
      isFree: true,
      categoryIds: ['garage-sale'],
    });
    expect(n.event.h3r9).toMatch(/^89/);
    expect(n.event.densityCell).toMatch(/^88/);
  });

  it.each([
    ['outside the region', { point: { lat: 52.23, lng: 21.01 } }, 'outside_region'],
    ['in the past', { start: '2026-10-01T10:00', end: null }, 'invalid_input'],
    ['ending before it starts', { end: '2026-10-24T09:00' }, 'invalid_input'],
    ['with an unknown category', { categoryIds: ['nope'] }, 'invalid_input'],
    ['with a private link', { url: 'http://localhost/x' }, 'unsafe_url'],
    ['without a title', { title: ' ' }, 'invalid_input'],
  ])('rejects an event %s', async (_name, change, error) => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('submissions', { ...valid, event: { ...valid.event, ...change } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(web.calls.some((c) => c.name === 'submit_event')).toBe(false);
  });
});

describe('POST /api/reports', () => {
  it('stores a report and maps unknown events to 404', async () => {
    const web = backend({
      rpc: {
        ...allow,
        report_event: (a) =>
          a.p_event === 'missing'
            ? { status: 400, body: { code: 'P0002', message: 'unknown event' } }
            : { body: true },
      },
    });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const ok = await api(
      post('reports', {
        deviceId: 'device-0123456789',
        eventId: 'ticketmaster:1',
        reason: 'cancelled',
      }),
    );
    expect(ok.status).toBe(201);
    const missing = await api(
      post('reports', { deviceId: 'device-0123456789', eventId: 'missing', reason: 'other' }),
    );
    expect(missing.status).toBe(404);
    const bad = await api(
      post('reports', { deviceId: 'device-0123456789', eventId: 'x', reason: 'boring' }),
    );
    expect(bad.status).toBe(400);
  });
});

describe('/api/moderation', () => {
  const rpc = {
    ...allow,
    is_moderator: (a: Record<string, unknown>) => ({ body: a.p_email === 'mod@example.org' }),
    moderation_queue: () => ({ body: { submissions: [], reports: [] } }),
    moderate_submission: (a: Record<string, unknown>) =>
      a.p_id === 'done'
        ? { status: 400, body: { code: 'P0001', message: 'already reviewed' } }
        : { body: { id: a.p_id, eventId: 'e1', action: a.p_action } },
    resolve_reports: () => ({ body: 2 }),
  };
  const users = { 'good-token': 'Mod@Example.org', 'user-token': 'someone@example.org' };
  const get = (token?: string) =>
    new Request('https://happow.example/api/moderation', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('requires a signed-in moderator', async () => {
    const web = backend({ rpc, users });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    expect((await api(get())).status).toBe(401);
    expect((await api(get('forged'))).status).toBe(401);
    expect((await api(get('user-token'))).status).toBe(403);
    const ok = await api(get('good-token'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ moderator: 'mod@example.org', submissions: [], reports: [] });
  });

  it('approves submissions and resolves reports as the moderator', async () => {
    const web = backend({ rpc, users });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const auth = { authorization: 'Bearer good-token' };
    const approve = await api(post('moderation/submissions/s1', { action: 'approve' }, auth));
    expect(await approve.json()).toMatchObject({ action: 'approve' });
    expect(web.calls.find((c) => c.name === 'moderate_submission')!.args).toMatchObject({
      p_id: 's1',
      p_moderator: 'mod@example.org',
    });
    expect(
      (await api(post('moderation/submissions/done', { action: 'reject' }, auth))).status,
    ).toBe(409);
    const resolve = await api(
      post('moderation/reports/seed%3Ae1', { action: 'cancel', note: 'confirmed' }, auth),
    );
    expect(await resolve.json()).toEqual({ resolved: 2 });
    expect(web.calls.find((c) => c.name === 'resolve_reports')!.args).toMatchObject({
      p_event: 'seed:e1',
    });
    // Report actions do not apply to submissions.
    expect((await api(post('moderation/submissions/s1', { action: 'hide' }, auth))).status).toBe(
      400,
    );
  });
});

it('answers 404 for autofill while the add-on is off', async () => {
  const web = backend({ rpc: allow });
  const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
  expect((await api(post('autofill', { url: 'https://x.example' }))).status).toBe(404);
  expect(web.calls).toEqual([]);
});

it('answers 404 for unknown routes', async () => {
  const api = createApi(env, {
    fetch: backend({ rpc: allow }).fetch,
    now,
    geocoder,
    extractor: null,
  });
  expect((await api(post('nope', {}))).status).toBe(404);
  expect((await api(new Request('https://happow.example/api/autofill'))).status).toBe(404);
});
