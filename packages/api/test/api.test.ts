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

/** What a signed-in request needs: no staff role, no grants, nothing used this month. */
const accountRpc: Backend['rpc'] = {
  staff_role: () => ({ body: null }),
  grants_active: () => ({ body: [] }),
  usage_get: () => ({ body: { events: 0, autofills: 0 } }),
  usage_take: () => ({ body: true }),
};

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
      const handler = { ...accountRpc, ...b.rpc }[name];
      if (!handler) return new Response('{}', { status: 404 });
      const { status = 200, body } = handler(args);
      return new Response(JSON.stringify(body), { status });
    }
    if (url === `${SB}/auth/v1/user`) {
      const token = headers.get('authorization')?.replace('Bearer ', '') ?? '';
      const email = (b.users ?? { 'user-token': 'ala@example.org' })[token];
      return email
        ? new Response(JSON.stringify({ id: `id-${token}`, email }), { status: 200 })
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
// URL autofill is off until the add form signs people in (M8 slice G); these tests switch it on.
const base = loadConfig();
const config = base;
const autofillOn = {
  ...base,
  app: { ...base.app, submissions: { ...base.app.submissions, autofill: 'account' as const } },
};
const withAutofill = (...[env, deps]: Parameters<typeof createApi>) =>
  createApi(env, { config: autofillOn, ...deps });

const allow = { rate_limit_hit: () => ({ body: true }) };

const auth = { authorization: 'Bearer user-token' };
const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: JSON.stringify(payload),
  });

describe('POST /api/autofill', () => {
  const goUrl = 'https://www.wroclaw.pl/go/wydarzenia/edukacja-i-rozwoj/1416880-cool-moms-club';

  it('prefills from JSON-LD, geocodes the place and rate-limits per account', async () => {
    const web = backend({ rpc: allow, pages: { [goUrl]: page('go-event-1.html') } });
    const api = withAutofill(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('autofill', { url: goUrl }, auth));
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
    expect(rl.args.p_actor).toBe('id-user-token');
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
        ageMin: 6,
        family: true,
        entry: 'fixed',
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
    const data = await (await api(post('autofill', { url }, auth))).json();
    expect(data.method).toBe('llm');
    expect(data.events[0]).toMatchObject({
      title: 'Pustynne portato',
      categoryIds: ['kids', 'music'],
      ageMin: 6,
      family: true,
      entry: 'fixed',
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
      await withAutofill(env, { ...deps, fetch: capped.fetch })(post('autofill', { url }, auth))
    ).json();
    expect(off).toMatchObject({ method: 'none', events: [] });
    expect(extract).not.toHaveBeenCalled();
    expect(capped.calls.find((c) => c.args.p_bucket === 'autofill-llm')!.args).toMatchObject({
      p_actor: 'global',
      p_window_seconds: 86_400,
    });

    const open = backend({ rpc: allow, pages: { [url]: page('nfm-event.html') } });
    const res = await withAutofill(env, { ...deps, fetch: open.fetch })(
      post('autofill', { url }, auth),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ method: 'none', events: [] });
    expect(extract).toHaveBeenCalledOnce();
  });

  it('refuses private addresses and reports unreachable pages', async () => {
    const web = backend({ rpc: allow });
    const api = withAutofill(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const bad = await api(
      post('autofill', { url: 'http://169.254.169.254/latest/meta-data' }, auth),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('unsafe_url');
    const gone = await api(post('autofill', { url: 'https://gone.example/event' }, auth));
    expect(gone.status).toBe(422);
  });

  it('answers 503 until the server is configured, and 429 when over the limit', async () => {
    const api503 = withAutofill({}, { now, geocoder, extractor: null });
    expect((await api503(post('autofill', { url: 'https://x.example' }, auth))).status).toBe(503);
    const web = backend({ rpc: { rate_limit_hit: () => ({ body: false }) } });
    const api = withAutofill(env, { fetch: web.fetch, now, geocoder, extractor: null });
    expect((await api(post('autofill', { url: 'https://x.example' }, auth))).status).toBe(429);
  });
});

describe('autofill quota (M8 §5)', () => {
  const goUrl = 'https://www.wroclaw.pl/go/wydarzenia/edukacja-i-rozwoj/1416880-cool-moms-club';
  const pages = { [goUrl]: page('go-event-1.html') };
  const run = (b: Backend, headers: Record<string, string> = auth, url = goUrl) => {
    const web = backend(b);
    const api = withAutofill(env, { fetch: web.fetch, now, geocoder, extractor: null });
    return { web, res: api(post('autofill', { url }, headers)) };
  };
  const fetchedPage = (web: ReturnType<typeof backend>) =>
    (web.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
      ([u]) => String(u) === goUrl,
    );

  it('needs an account', async () => {
    const { web, res } = run({ rpc: allow, pages }, {});
    expect((await res).status).toBe(401);
    expect(fetchedPage(web)).toBe(false);
    expect((await run({ rpc: allow, pages }, { authorization: 'Bearer forged' }).res).status).toBe(
      401,
    );
  });

  it('counts a fill that gave prefills, in this month, against the plan limit', async () => {
    const { web, res } = run({ rpc: allow, pages });
    expect((await res).status).toBe(200);
    const take = web.calls.find((c) => c.name === 'usage_take')!;
    // Early access: premium, 300 a month.
    expect(take.args).toEqual({
      p_user: 'id-user-token',
      p_month: '2026-10-01',
      p_kind: 'autofills',
      p_max: config.plans.plans.premium['autofill.perMonth'],
    });
  });

  it('counts nothing for a page with nothing to fill or a page that fails', async () => {
    const empty = run({ rpc: allow, pages: { [goUrl]: '<html><body>Nic</body></html>' } });
    expect(await (await empty.res).json()).toMatchObject({ method: 'none', events: [] });
    expect(empty.web.calls.some((c) => c.name === 'usage_take')).toBe(false);
    const gone = run({ rpc: allow }, auth, 'https://gone.example/event');
    expect((await gone.res).status).toBe(422);
    expect(gone.web.calls.some((c) => c.name === 'usage_take')).toBe(false);
  });

  it('refuses before fetching once the quota is used up, saying when it resets', async () => {
    const limit = config.plans.plans.premium['autofill.perMonth'];
    const { web, res } = run({
      rpc: { ...allow, usage_get: () => ({ body: { events: 0, autofills: limit } }) },
      pages,
    });
    const r = await res;
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({
      error: 'quota_exceeded',
      kind: 'autofill',
      limit,
      // 1 November 00:00 in Warsaw (CET).
      resetsAt: '2026-10-31T23:00:00.000Z',
    });
    expect(fetchedPage(web)).toBe(false);
  });

  it('refuses when another request took the last fill meanwhile', async () => {
    const { res } = run({ rpc: { ...allow, usage_take: () => ({ body: false }) }, pages });
    const r = await res;
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('quota_exceeded');
  });

  it('uses the account limit once the promotion is over', async () => {
    const after = { ...autofillOn, plans: { ...autofillOn.plans, earlyAccess: null } };
    const web = backend({
      rpc: { ...allow, usage_get: () => ({ body: { events: 0, autofills: 5 } }) },
      pages,
    });
    const api = createApi(env, { config: after, fetch: web.fetch, now, geocoder, extractor: null });
    const r = await api(post('autofill', { url: goUrl }, auth));
    expect(r.status).toBe(429);
    expect((await r.json()).limit).toBe(config.plans.plans.account['autofill.perMonth']);
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
      // Not given: no age data, and the category default decides the entry type.
      ageMin: null,
      family: null,
      entry: null,
      graceMin: null,
    });
    expect(n.event.h3r9).toMatch(/^89/);
    expect(n.event.densityCell).toMatch(/^88/);
  });

  it('passes the age choice, family toggle and entry type to the event', async () => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const event = { ...valid.event, ageMin: 0, family: true, entry: 'fixed' };
    const res = await api(post('submissions', { ...valid, event }));
    expect(res.status).toBe(201);
    const call = web.calls.find((c) => c.name === 'submit_event')!;
    const p = call.args.p as { normalized: { event: Record<string, unknown> } };
    expect(p.normalized.event).toMatchObject({ ageMin: 0, family: true, entry: 'fixed' });
  });

  it.each([
    ['outside the region', { point: { lat: 52.23, lng: 21.01 } }, 'outside_region'],
    ['in the past', { start: '2026-10-01T10:00', end: null }, 'invalid_input'],
    ['ending before it starts', { end: '2026-10-24T09:00' }, 'invalid_input'],
    ['with an unknown category', { categoryIds: ['nope'] }, 'invalid_input'],
    ['with a private link', { url: 'http://localhost/x' }, 'unsafe_url'],
    ['without a title', { title: ' ' }, 'invalid_input'],
    ['with an impossible age', { ageMin: 99 }, 'invalid_input'],
    ['with an unknown entry type', { entry: 'maybe' }, 'invalid_input'],
  ])('rejects an event %s', async (_name, change, error) => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('submissions', { ...valid, event: { ...valid.event, ...change } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(web.calls.some((c) => c.name === 'submit_event')).toBe(false);
  });

  it('counts an account submission against its quota, with an hourly guard instead of daily caps', async () => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    expect((await api(post('submissions', valid, auth))).status).toBe(201);
    const call = web.calls.find((c) => c.name === 'submit_event')!;
    expect(call.args).toMatchObject({
      p_user: 'id-user-token',
      p_month: '2026-10-01',
      p_max: config.plans.plans.premium['events.perMonth'],
    });
    const buckets = web.calls.filter((c) => c.name === 'rate_limit_hit').map((c) => c.args);
    expect(buckets).toEqual([
      expect.objectContaining({
        p_bucket: 'submit-account',
        p_actor: 'id-user-token',
        p_window_seconds: 3600,
        p_max: config.app.submissions.perHourPerAccount,
      }),
    ]);
  });

  it('counts nothing without an account, and keeps the device and IP caps', async () => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    expect((await api(post('submissions', valid))).status).toBe(201);
    const call = web.calls.find((c) => c.name === 'submit_event')!;
    expect(call.args).toMatchObject({ p_user: null, p_month: null, p_max: 0 });
    const buckets = web.calls
      .filter((c) => c.name === 'rate_limit_hit')
      .map((c) => c.args.p_bucket);
    expect(buckets).toEqual(['submit', 'submit-ip']);
  });

  it('answers 429 with the reset date when the events quota is used up', async () => {
    const web = backend({
      rpc: {
        ...allow,
        submit_event: () => ({
          status: 400,
          body: { code: 'HQ001', message: 'events quota used up' },
        }),
      },
    });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('submissions', valid, auth));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: 'quota_exceeded',
      kind: 'events',
      limit: config.plans.plans.premium['events.perMonth'],
      resetsAt: '2026-10-31T23:00:00.000Z',
    });
  });

  it('refuses a bad token, and anonymous events once accounts are required', async () => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const forged = await createApi(env, { fetch: web.fetch, now, geocoder, extractor: null })(
      post('submissions', valid, { authorization: 'Bearer forged' }),
    );
    expect(forged.status).toBe(401);
    const required = {
      ...config,
      app: {
        ...config.app,
        submissions: { ...config.app.submissions, account: 'required' as const },
      },
    };
    const api = createApi(env, {
      config: required,
      fetch: web.fetch,
      now,
      geocoder,
      extractor: null,
    });
    const anon = await api(post('submissions', valid));
    expect(anon.status).toBe(401);
    expect((await anon.json()).error).toBe('account_required');
    expect((await api(post('submissions', valid, auth))).status).toBe(201);
  });
});

describe('POST /api/reports', () => {
  it('accepts the status reasons that flag an event for everyone', async () => {
    const web = backend({ rpc: { ...allow, report_event: () => ({ body: true }) } });
    const api = createApi(env, { fetch: web.fetch, now, geocoder, extractor: null });
    for (const reason of ['venue_closed', 'weather', 'moved']) {
      const res = await api(
        post('reports', { deviceId: 'device-0123456789', eventId: 'seed:1', reason }),
      );
      expect(res.status).toBe(201);
    }
    expect(web.calls.filter((c) => c.name === 'report_event').map((c) => c.args.p_reason)).toEqual([
      'venue_closed',
      'weather',
      'moved',
    ]);
  });

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
    staff_role: (a: Record<string, unknown>) => ({
      body: a.p_email === 'mod@example.org' ? 'moderator' : null,
    }),
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

describe('GET /api/area', () => {
  const get = (q: string, headers: Record<string, string> = {}) =>
    new Request(`https://happow.example/api/area?${q}`, { headers });
  const at = () => new Date('2026-10-20T20:03:30Z');
  const rows = [{ id: 'seed:1', title: 'Gig', lat: 51.11, lng: 17.03 }];

  it('serves one public snapshot per grid square, radius and 5-minute step', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: rows }) } });
    const api = createApi(env, { fetch: web.fetch, now: at });
    const res = await api(get('lat=51.1&lng=17.05&r=5000'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      from: '2026-10-20T20:00:00.000Z',
      to: '2026-10-21T20:00:00.000Z',
      events: rows,
    });
    // Expires at the end of the step, for everyone at once.
    expect(res.headers.get('cache-control')).toBe('public, max-age=90');
    const call = web.calls.find((c) => c.name === 'events_area')!;
    expect(call.args).toMatchObject({
      lat: 51.1,
      lng: 17.05,
      from_ts: '2026-10-20T20:00:00.000Z',
      to_ts: '2026-10-21T20:00:00.000Z',
      max_events: 1000,
    });
    // The snapshot radius covers users anywhere in the grid square.
    expect(call.args.radius_m as number).toBeGreaterThan(5000 + 2500);

    // Revalidating an unchanged snapshot (Cloudflare's cache or a phone) costs a bodiless 304.
    const etag = res.headers.get('etag')!;
    const again = await api(get('lat=51.1&lng=17.05&r=5000', { 'if-none-match': etag }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });

  it('refuses keys off the grid, unknown radii and places outside every region', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: [] }) } });
    const api = createApi(env, { fetch: web.fetch, now: at });
    for (const q of [
      'lat=51.11&lng=17.05&r=5000', // off the grid
      'lat=51.1&lng=17.05&r=7000', // not a snapshot radius
      'lat=40&lng=-74&r=5000', // outside the regions
      'lat=x&lng=17.05&r=5000',
    ])
      expect((await api(get(q))).status).toBe(400);
    expect(web.calls).toEqual([]);
    expect((await createApi({}, { now: at })(get('lat=51.1&lng=17.05&r=5000'))).status).toBe(503);
  });

  it('serves the Week and Later ranges to local midnight across the DST change, for 30 minutes', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: rows }) } });
    const api = createApi(env, { fetch: web.fetch, now: at });
    // 22:03 on Tue 20 Oct in Wrocław (CEST); summer time ends on Sun 25 Oct.
    const week = await api(get('lat=51.1&lng=17.05&r=5000&range=week'));
    expect(week.status).toBe(200);
    expect(await week.json()).toMatchObject({
      from: '2026-10-20T20:00:00.000Z',
      // End of Mon 26 Oct, local midnight in CET (UTC+1), not 7 × 24 h later.
      to: '2026-10-26T22:59:59.999Z',
    });
    expect(week.headers.get('cache-control')).toBe('public, max-age=1590');
    const later = await api(get('lat=51.1&lng=17.05&r=5000&range=later'));
    expect(await later.json()).toMatchObject({ to: '2026-11-02T22:59:59.999Z' });
    expect(web.calls.filter((c) => c.name === 'events_area').map((c) => c.args.to_ts)).toEqual([
      '2026-10-26T22:59:59.999Z',
      '2026-11-02T22:59:59.999Z',
    ]);
  });

  it('refuses ranges that are not multi-day time windows', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: [] }) } });
    const api = createApi(env, { fetch: web.fetch, now: at });
    for (const range of ['today', '2h', 'month', ''])
      expect((await api(get(`lat=51.1&lng=17.05&r=5000&range=${range}`))).status).toBe(400);
    expect(web.calls).toEqual([]);
  });
});

describe('POST /api/route', () => {
  const from = { lat: 51.1085, lng: 17.03 };
  const to = { lat: 51.1101, lng: 17.0325 };
  const routed = { ...env, ORS_API_KEY: 'ors-key' };
  const orsBody = {
    type: 'FeatureCollection',
    features: [
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [17.03, 51.1085],
            [17.031, 51.109],
            [17.0325, 51.1101],
          ],
        },
        properties: { summary: { distance: 312.4, duration: 224.9 } },
      },
    ],
  };
  const withRouting = (status: number, body: unknown) => {
    const web = backend({ rpc: allow });
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (!url.includes('openrouteservice')) return web.fetch(input, init);
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as typeof globalThis.fetch;
    return { web, calls, fetch };
  };

  it('asks openrouteservice for a walking route with the key server-side', async () => {
    const { calls, fetch } = withRouting(200, orsBody);
    const res = await createApi(routed, { fetch, now, geocoder, extractor: null })(
      post('route', { from, to }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: [from, { lat: 51.109, lng: 17.031 }, to],
      distanceM: 312,
      durationS: 225,
      attribution: '© openrouteservice by HeiGIT | Data from OpenStreetMap',
    });
    expect(calls[0]!.url).toBe(
      'https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson',
    );
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('ors-key');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      coordinates: [
        [17.03, 51.1085],
        [17.0325, 51.1101],
      ],
    });
  });

  it('answers so the app can draw a direct line: no key, used-up quota, bad input', async () => {
    const api = (e: object, status = 200, body: unknown = orsBody) =>
      createApi(e, { fetch: withRouting(status, body).fetch, now, geocoder, extractor: null });
    expect((await api(env)(post('route', { from, to }))).status).toBe(503);
    expect((await api(routed, 403, {})(post('route', { from, to }))).status).toBe(429);
    expect((await api(routed, 500, {})(post('route', { from, to }))).status).toBe(503);
    expect((await api(routed)(post('route', { from, to: { lat: 40, lng: -74 } }))).status).toBe(
      400,
    );
  });
});
