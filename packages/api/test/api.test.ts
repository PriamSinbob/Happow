import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Extractor, Geocoder } from '@happow/extract';
import { createApi } from '../src';
import { config as base, env, organiserRpc, SB, type Rpc } from './helpers';

const page = (name: string) =>
  readFileSync(new URL(`../../extract/test/fixtures/${name}`, import.meta.url), 'utf8');

const now = () => new Date('2026-10-20T20:00:00Z');

interface Backend {
  rpc: Record<string, Rpc>;
  pages?: Record<string, string>;
  users?: Record<string, string>;
}

/** What a signed-in request needs: no staff role, no grants, nothing used this month. */
const accountRpc: Backend['rpc'] = {
  staff_role: () => ({ body: null }),
  grants_active: () => ({ body: [] }),
  usage_get: () => ({ body: { events: 0, autofills: 0 } }),
  usage_take: () => ({ body: true }),
  // Nobody is trusted, nothing published by trusted accounts, rewards recorded.
  contributor_trusted: () => ({ body: false }),
  trusted_recent: () => ({ body: [] }),
  duplicate_candidates: () => ({ body: { title: 'x', others: [] } }),
  contribution_award: () => ({ body: { kind: 'verified', days: 3, startsAt: null } }),
  contribution_revoke_event: () => ({ body: 0 }),
  ...organiserRpc,
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
// The live config requires an account and turns autofill on with it. Most tests here cover the
// anonymous mode, which config still allows: accounts optional, autofill off.
const config = {
  ...base,
  app: {
    ...base.app,
    submissions: {
      ...base.app.submissions,
      account: 'optional' as const,
      autofill: false as const,
    },
  },
};
const autofillOn = {
  ...config,
  app: { ...config.app, submissions: { ...config.app.submissions, autofill: 'account' as const } },
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

describe('autofill quota', () => {
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('submissions', { ...valid, event: { ...valid.event, ...change } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(web.calls.some((c) => c.name === 'submit_event')).toBe(false);
  });

  it('counts an account submission against its quota, with an hourly guard instead of daily caps', async () => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
    const res = await api(post('submissions', valid, auth));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: 'quota_exceeded',
      kind: 'events',
      limit: config.plans.plans.premium['events.perMonth'],
      resetsAt: '2026-10-31T23:00:00.000Z',
    });
  });

  it('refuses a bad token, and anonymous events with the live config (accounts required)', async () => {
    const web = backend({ rpc: { ...allow, submit_event: () => ({ body: 'uuid' }) } });
    const forged = await createApi(env, {
      config,
      fetch: web.fetch,
      now,
      geocoder,
      extractor: null,
    })(post('submissions', valid, { authorization: 'Bearer forged' }));
    expect(forged.status).toBe(401);
    expect(base.app.submissions.account).toBe('required');
    const api = createApi(env, {
      config: base,
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
    expect((await api(get())).status).toBe(401);
    expect((await api(get('forged'))).status).toBe(401);
    expect((await api(get('user-token'))).status).toBe(403);
    const ok = await api(get('good-token'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      moderator: 'mod@example.org',
      submissions: [],
      reports: [],
      trusted: [],
      claims: [],
      edits: [],
      posts: [],
    });
  });

  it('approves submissions and resolves reports as the moderator', async () => {
    const web = backend({ rpc, users });
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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
  const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor: null });
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

it('answers 400, not 500, for a path with a broken escape', async () => {
  const api = createApi(env, { fetch: backend({ rpc: allow }).fetch, now });
  const res = await api(new Request('https://happow.example/api/events/%zz/posts'));
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: 'invalid_input' });
});

describe('GET /api/area', () => {
  const get = (q: string, headers: Record<string, string> = {}) =>
    new Request(`https://happow.example/api/area?${q}`, { headers });
  const at = () => new Date('2026-10-20T20:03:30Z');
  const rows = [{ id: 'seed:1', title: 'Gig', lat: 51.11, lng: 17.03 }];

  it('serves one public snapshot per grid square, radius and 5-minute step', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: rows }) } });
    const api = createApi(env, { config, fetch: web.fetch, now: at });
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
    const api = createApi(env, { config, fetch: web.fetch, now: at });
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

  it('serves the 14-day range to local midnight across the DST change, for 30 minutes', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: rows }) } });
    const api = createApi(env, { config, fetch: web.fetch, now: at });
    // 22:03 on Tue 20 Oct in Wrocław (CEST); summer time ends on Sun 25 Oct.
    const later = await api(get('lat=51.1&lng=17.05&r=5000&range=later'));
    expect(later.status).toBe(200);
    expect(await later.json()).toMatchObject({
      from: '2026-10-20T20:00:00.000Z',
      // End of Mon 2 Nov, local midnight in CET (UTC+1), not 14 × 24 h later.
      to: '2026-11-02T22:59:59.999Z',
    });
    expect(later.headers.get('cache-control')).toBe('public, max-age=1590');
    expect(web.calls.filter((c) => c.name === 'events_area').map((c) => c.args.to_ts)).toEqual([
      '2026-11-02T22:59:59.999Z',
    ]);
  });

  it('serves the future range from the end of the 14 days on, with no end', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: rows }) } });
    const api = createApi(env, { config, fetch: web.fetch, now: at });
    const future = await api(get('lat=51.1&lng=17.05&r=5000&range=future'));
    expect(future.status).toBe(200);
    // `from` stays the cache step the phone counts from; the query starts after the 14 days.
    expect(await future.json()).toMatchObject({ from: '2026-10-20T20:00:00.000Z' });
    expect(future.headers.get('cache-control')).toBe('public, max-age=1590');
    expect(web.calls.find((c) => c.name === 'events_area')?.args).toMatchObject({
      from_ts: '2026-11-02T23:00:00.000Z',
      to_ts: '9999-01-01T00:00:00.000Z',
    });
  });

  it('serves one month of the future on its own, and everything later as the last step', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: rows }) } });
    const api = createApi(env, { config, fetch: web.fetch, now: at });
    const q = 'lat=51.1&lng=17.05&r=5000&range=future';
    expect((await api(get(`${q}&step=1`))).status).toBe(200);
    expect((await api(get(`${q}&step=12`))).status).toBe(200);
    const args = web.calls.filter((c) => c.name === 'events_area').map((c) => c.args);
    // December 2026, whole, in local time (CET).
    expect(args[0]).toMatchObject({
      from_ts: '2026-11-30T23:00:00.000Z',
      to_ts: '2026-12-31T22:59:59.999Z',
    });
    expect(args[1]).toMatchObject({
      from_ts: '2027-10-31T23:00:00.000Z',
      to_ts: '9999-01-01T00:00:00.000Z',
    });
    for (const bad of ['13', '-1', '1.5', 'x'])
      expect((await api(get(`${q}&step=${bad}`))).status).toBe(400);
    // A step means nothing outside the future range.
    expect((await api(get('lat=51.1&lng=17.05&r=5000&range=later&step=1'))).status).toBe(400);
  });

  it('refuses ranges that are not multi-day time windows', async () => {
    const web = backend({ rpc: { events_area: () => ({ body: [] }) } });
    const api = createApi(env, { config, fetch: web.fetch, now: at });
    for (const range of ['today', '2h', 'week', 'month', ''])
      expect((await api(get(`lat=51.1&lng=17.05&r=5000&range=${range}`))).status).toBe(400);
    expect(web.calls).toEqual([]);
  });
});

describe('GET /api/places', () => {
  const get = (q: string, headers: Record<string, string> = {}) =>
    new Request(`https://happow.example/api/places?${q}`, { headers });
  const rows = [
    {
      id: 'node/1',
      name: 'Pod Latarnią',
      kind: 'amenity=pub',
      lat: 51.11,
      lng: 17.03,
      address: null,
      website: null,
      opening_hours: 'Mo-Su 16:00-24:00',
    },
  ];

  it("serves an area's places publicly, cached for half an hour, with an ETag", async () => {
    const web = backend({ rpc: { places_area: () => ({ body: rows }) } });
    const api = createApi(env, { config, fetch: web.fetch });
    const res = await api(get('lat=51.1&lng=17.05&r=5000'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ places: rows });
    expect(res.headers.get('cache-control')).toBe('public, max-age=1800');
    expect(res.headers.get('x-places')).toBe('some');
    expect(web.calls.find((c) => c.name === 'places_area')!.args).toMatchObject({
      lat: 51.1,
      lng: 17.05,
      max_places: 3000,
    });
    const again = await api(
      get('lat=51.1&lng=17.05&r=5000', { 'if-none-match': res.headers.get('etag')! }),
    );
    expect(again.status).toBe(304);
  });

  it('lets nothing keep an empty answer', async () => {
    const web = backend({ rpc: { places_area: () => ({ body: [] }) } });
    const api = createApi(env, { config, fetch: web.fetch });
    const res = await api(get('lat=51.1&lng=17.05&r=5000'));
    expect(await res.json()).toEqual({ places: [] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-places')).toBeNull();
  });

  it('refuses keys off the grid and places outside every region', async () => {
    const web = backend({ rpc: { places_area: () => ({ body: [] }) } });
    const api = createApi(env, { config, fetch: web.fetch });
    for (const q of ['lat=51.11&lng=17.05&r=5000', 'lat=40&lng=-74&r=5000', 'lat=x&lng=1&r=5000'])
      expect((await api(get(q))).status).toBe(400);
    expect(web.calls).toEqual([]);
    expect((await createApi({}, {})(get('lat=51.1&lng=17.05&r=5000'))).status).toBe(503);
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

describe('adding and correcting places', () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
    new Request(`https://happow.example/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const NOW = '2026-11-10T12:00:00.000Z';
  const place = {
    name: 'Pod Latarnią',
    kind: 'amenity=pub',
    point: { lat: 51.11, lng: 17.03 },
    openingHours: 'Mo-Su 16:00-02:00',
    address: 'Rynek 1',
    website: 'podlatarnia.example',
  };
  const rpc = {
    rate_limit_hit: () => ({ body: true }),
    place_add: () => ({ body: 'user/1' }),
    place_change: () => ({ body: null }),
  };
  const run = (path: string, body: unknown, headers?: Record<string, string>) => {
    const web = backend({ rpc });
    const api = createApi(env, { config, fetch: web.fetch, now: () => new Date(NOW) });
    return { web, res: api(post(path, body, headers)) };
  };

  it('adds a place for a signed-in account, at once, within its daily limit', async () => {
    const { web, res } = run('places', place);
    expect((await res).status).toBe(201);
    expect(await (await res).json()).toEqual({ id: 'user/1' });
    expect(web.calls.find((c) => c.name === 'place_add')!.args).toMatchObject({
      p_user: 'id-user-token',
      p_name: 'Pod Latarnią',
      p_kind: 'amenity=pub',
      p_hours: 'Mo-Su 16:00-02:00',
      p_website: 'https://podlatarnia.example/',
      p_same_m: 50,
    });
    expect(web.calls.find((c) => c.name === 'rate_limit_hit')!.args).toMatchObject({
      p_actor: 'id-user-token',
      p_max: 10,
    });
  });

  it('needs an account, a known kind, a spot in the region and hours it can read', async () => {
    expect((await run('places', place, {}).res).status).toBe(401);
    for (const bad of [
      { kind: 'amenity=bank' },
      { point: { lat: 52.2, lng: 21 } },
      { openingHours: 'Mo-Fr sunrise-sunset' },
      { openingHours: 'Mo-Su off' },
      { website: 'http://127.0.0.1/' },
    ]) {
      const { web, res } = run('places', { ...place, ...bad });
      expect((await res).status).toBe(400);
      expect(web.calls.some((c) => c.name === 'place_add')).toBe(false);
    }
  });

  it('takes one correction at a time: hours, closed for good, or a private party', async () => {
    const hours = run('places/change', { id: 'node/1', openingHours: 'Mo-Su 12:00-20:00' });
    expect((await hours.res).status).toBe(200);
    expect(hours.web.calls.find((c) => c.name === 'place_change')!.args).toEqual({
      p_user: 'id-user-token',
      p_place: 'node/1',
      p_hours: 'Mo-Su 12:00-20:00',
      p_closed: null,
      p_private: null,
      p_private_until: null,
    });
    const until = new Date(Date.parse(NOW) + 3 * 3_600_000).toISOString();
    const party = run('places/change', { id: 'node/1', privateUntil: until });
    expect((await party.res).status).toBe(200);
    expect(party.web.calls.find((c) => c.name === 'place_change')!.args).toMatchObject({
      p_private: true,
      p_private_until: until,
    });
    const over = run('places/change', { id: 'node/1', privateUntil: null });
    await over.res;
    expect(over.web.calls.find((c) => c.name === 'place_change')!.args).toMatchObject({
      p_private: false,
      p_private_until: null,
    });
    const closed = run('places/change', { id: 'node/1', closed: true });
    await closed.res;
    expect(closed.web.calls.find((c) => c.name === 'place_change')!.args).toMatchObject({
      p_closed: true,
    });
  });

  it('refuses no change, two changes, a party too far ahead and a signed-out caller', async () => {
    const far = new Date(Date.parse(NOW) + 30 * 3_600_000).toISOString();
    for (const bad of [
      { id: 'node/1' },
      { id: 'node/1', closed: true, openingHours: '24/7' },
      { id: 'node/1', privateUntil: far },
      { id: 'node/1', privateUntil: new Date(Date.parse(NOW) - 60_000).toISOString() },
    ])
      expect((await run('places/change', bad).res).status).toBe(400);
    expect((await run('places/change', { id: 'node/1', closed: true }, {}).res).status).toBe(401);
  });
});

describe('public event reads', () => {
  const row = { id: 'tm:1', title: 'Koncert', lat: 51.1, lng: 17.03 };
  const reads = {
    ...allow,
    event_by_id: (a: Record<string, unknown>) => ({ body: a.event_id === 'tm:1' ? [row] : [] }),
    events_by_ids: (a: Record<string, unknown>) => ({
      body: (a.ids as string[]).filter((id) => id === 'tm:1').map(() => row),
    }),
    event_credit: () => ({ body: { name: 'Ola', level: null } }),
    district_goal: () => ({ body: { id: 'rynek', name: 'Rynek', count: 4 } }),
  };
  const get = (path: string) => new Request(`https://happow.example/api/${path}`);

  it('answers one event, briefly cached and public, and 404 for one that is not listed', async () => {
    const web = backend({ rpc: reads });
    const api = createApi(env, { fetch: web.fetch, now });
    const res = await api(get('events/tm%3A1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      `public, max-age=${base.app.refresh.eventSeconds}`,
    );
    expect(await res.json()).toEqual({ event: row });
    // Never measured from a point: one cached answer serves everyone.
    expect(web.calls.find((c) => c.name === 'event_by_id')!.args).toEqual({ event_id: 'tm:1' });
    const gone = await api(get('events/nope'));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: 'unknown_event' });
  });

  it('looks up a device’s plans by id, up to 500', async () => {
    const api = createApi(env, { fetch: backend({ rpc: reads }).fetch, now });
    const res = await api(post('events/lookup', { ids: ['tm:1', 'gone'] }));
    expect(await res.json()).toEqual({ events: [row] });
    const tooMany = Array.from({ length: 501 }, (_, i) => `x:${i}`);
    expect((await api(post('events/lookup', { ids: tooMany }))).status).toBe(400);
  });

  it('gives the credit uncached and the district goal for a span', async () => {
    const web = backend({ rpc: reads });
    const api = createApi(env, { fetch: web.fetch, now });
    const credit = await api(get('events/tm%3A1/credit'));
    expect(credit.headers.get('cache-control')).toBe('no-store');
    expect(await credit.json()).toEqual({ credit: { name: 'Ola', level: null } });
    const q = 'lat=51.11&lng=17.03&from=2026-10-24T00:00:00Z&to=2026-10-26T00:00:00Z';
    const goal = await api(get(`district-goal?${q}`));
    expect(await goal.json()).toEqual({ goal: { id: 'rynek', name: 'Rynek', count: 4 } });
    expect(web.calls.find((c) => c.name === 'district_goal')!.args).toMatchObject({
      p_region: 'wroclaw',
      p_lat: 51.11,
    });
    expect((await api(get('district-goal?lat=x'))).status).toBe(400);
  });
});
