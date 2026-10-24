import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi, type GrantChange, type PremiumProvider } from '../src';
import { ApiError } from '../src/http.js';

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
const config = loadConfig();
const REQ = '0b7a3c1e-2f4d-4e5a-9b6c-7d8e9f0a1b2c';

type Rpc = (args: Record<string, unknown>) => { status?: number; body: unknown };

/** Fake Supabase: PostgREST RPC, GoTrue's /user and its admin endpoints. Records every call. */
function supabase(rpc: Record<string, Rpc> = {}, opts: { userExists?: boolean } = {}) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const users: Record<string, { id: string; email: string }> = {
    'user-token': { id: 'u1', email: 'Ala@Example.org' },
    'mod-token': { id: 'u2', email: 'mod@example.org' },
    'admin-token': { id: 'u3', email: 'owner@example.org' },
  };
  const roles: Record<string, string> = {
    'mod@example.org': 'moderator',
    'owner@example.org': 'admin',
  };
  const all: Record<string, Rpc> = {
    rate_limit_hit: () => ({ body: true }),
    staff_role: (a) => ({ body: roles[a.p_email as string] ?? null }),
    profile_get: () => ({ body: { displayName: null, locale: 'pl', termsVersion: null } }),
    grants_active: () => ({ body: [] }),
    usage_get: () => ({ body: { events: 3, autofills: 1 } }),
    ...rpc,
  };
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const path = url.slice(SB.length);
    calls.push({ path, method, body });
    if (path.startsWith('/rest/v1/rpc/')) {
      const handler = all[path.slice('/rest/v1/rpc/'.length)];
      if (!handler) return new Response('{}', { status: 404 });
      const { status = 200, body: out } = handler(body);
      return new Response(JSON.stringify(out), { status });
    }
    if (path === '/auth/v1/user') {
      const token = new Headers(init.headers).get('authorization')?.replace('Bearer ', '') ?? '';
      const u = users[token];
      return u ? Response.json(u) : new Response('{}', { status: 401 });
    }
    if (path === '/auth/v1/admin/users' && method === 'POST')
      return opts.userExists
        ? new Response('{"error_code":"email_exists"}', { status: 422 })
        : Response.json({ id: 'new', email: body.email });
    if (path === '/auth/v1/admin/generate_link')
      return Response.json({
        id: 'new',
        email: body.email,
        email_otp: '123456',
        action_link: `${SB}/auth/v1/verify?token=abc&type=magiclink&redirect_to=${body.redirect_to}`,
      });
    if (path.startsWith('/auth/v1/admin/users/') && method === 'DELETE')
      return new Response('{}', { status: 200 });
    return new Response('not found', { status: 404 });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

const now = () => new Date('2026-10-24T12:00:00Z');
const api = (sb: ReturnType<typeof supabase>, cfg = config, premiumProviders?: PremiumProvider[]) =>
  createApi(env, { fetch: sb.fetch, now, config: cfg, extractor: null, premiumProviders });
const req = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
const rpcCalls = (sb: ReturnType<typeof supabase>, name: string) =>
  sb.calls.filter((c) => c.path === `/rest/v1/rpc/${name}`);

describe('/api/me', () => {
  it('needs a valid token', async () => {
    const sb = supabase();
    expect((await api(sb)(req('me'))).status).toBe(401);
    expect((await api(sb)(req('me', { token: 'forged' }))).status).toBe(401);
  });

  it('returns the profile, never cached', async () => {
    const sb = supabase();
    const res = await api(sb)(req('me', { token: 'user-token' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({
      id: 'u1',
      email: 'ala@example.org',
      role: null,
      displayName: null,
      locale: 'pl',
      termsVersion: null,
      // Early access: premium through 30 Nov, Warsaw time.
      plan: 'premium',
      planSource: 'early_access',
      planEndsAt: '2026-11-30T23:00:00.000Z',
      entitlements: config.plans.plans.premium,
      // This month in Warsaw, and when it ends there.
      usage: {
        month: '2026-10',
        resetsAt: '2026-10-31T23:00:00.000Z',
        events: { used: 3, limit: 300 },
        autofill: { used: 1, limit: 300 },
      },
    });
    expect(rpcCalls(sb, 'usage_get')[0]!.body).toEqual({ p_user: 'u1', p_month: '2026-10-01' });
    expect(rpcCalls(sb, 'grants_active')[0]!.body).toEqual({ p_user: 'u1' });
    expect(rpcCalls(sb, 'profile_get')[0]!.body).toEqual({ p_user: 'u1' });
  });

  it('checks a token with Supabase once while it is cached', async () => {
    const sb = supabase();
    const a = api(sb);
    await a(req('me', { token: 'user-token' }));
    await a(req('me', { token: 'user-token' }));
    expect(sb.calls.filter((c) => c.path === '/auth/v1/user')).toHaveLength(1);
  });

  it('accepts only the current terms version and a known language', async () => {
    const sb = supabase({ profile_update: () => ({ body: {} }) });
    const a = api(sb);
    const put = (body: unknown) => a(req('me', { method: 'PUT', token: 'user-token', body }));
    expect((await put({ termsVersion: 'old' })).status).toBe(400);
    expect((await put({ locale: 'de' })).status).toBe(400);
    expect((await put({ locale: 'en', termsVersion: config.app.legal.termsVersion })).status).toBe(
      200,
    );
    expect(rpcCalls(sb, 'profile_update')[0]!.body).toEqual({
      p_user: 'u1',
      p_locale: 'en',
      p_terms_version: config.app.legal.termsVersion,
    });
  });

  it('exports the account as a file', async () => {
    const sb = supabase({ account_export: () => ({ body: { profile: { locale: 'pl' } } }) });
    const res = await api(sb)(req('me/export', { token: 'user-token' }));
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="happow-account-2026-10-24.json"',
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({
      format: 'happow-account',
      email: 'ala@example.org',
      profile: { locale: 'pl' },
    });
  });

  it('deletes the account: own data first, then the auth user', async () => {
    const sb = supabase({ account_forget: () => ({ body: null }) });
    const a = api(sb);
    const res = await a(req('me', { method: 'DELETE', token: 'user-token' }));
    expect(res.status).toBe(204);
    const order = sb.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('POST /rest/v1/rpc/account_forget')).toBeLessThan(
      order.indexOf('DELETE /auth/v1/admin/users/u1'),
    );
    expect(rpcCalls(sb, 'account_forget')[0]!.body).toEqual({
      p_user: 'u1',
      p_email: 'ala@example.org',
    });
    // The cached token is forgotten with the account.
    await a(req('me', { token: 'user-token' }));
    expect(sb.calls.filter((c) => c.path === '/auth/v1/user')).toHaveLength(2);
  });
});

describe('POST /api/auth/code-request', () => {
  it('files the request with a lowercased email and answers the same whatever the email', async () => {
    const sb = supabase({ request_code: () => ({ body: null }) });
    const a = api(sb);
    const res = await a(
      req('auth/code-request', {
        method: 'POST',
        body: { email: ' Ala@Example.org ', locale: 'pl' },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    const call = rpcCalls(sb, 'request_code')[0]!.body;
    expect(call).toMatchObject({ p_email: 'ala@example.org', p_locale: 'pl' });
    // Hashed client, never the raw IP.
    expect(call.p_client).toMatch(/^[0-9a-f]{64}$/);
    expect(sb.calls.some((c) => c.path.startsWith('/auth/v1'))).toBe(false);
  });

  it('is rate-limited per client and per email', async () => {
    const sb = supabase({
      request_code: () => ({ body: null }),
      rate_limit_hit: (a) => ({ body: a.p_bucket !== 'code-request-email' }),
    });
    const res = await api(sb)(
      req('auth/code-request', { method: 'POST', body: { email: 'a@example.org', locale: 'en' } }),
    );
    expect(res.status).toBe(429);
    const buckets = rpcCalls(sb, 'rate_limit_hit').map((c) => c.body);
    expect(buckets).toEqual([
      expect.objectContaining({
        p_bucket: 'code-request',
        p_max: config.app.auth.codeRequestsPerHourPerClient,
      }),
      expect.objectContaining({
        p_bucket: 'code-request-email',
        p_max: config.app.auth.codeRequestsPerDayPerEmail,
      }),
    ]);
    expect(rpcCalls(sb, 'request_code')).toHaveLength(0);
  });

  it('rejects a bad email and is off when Supabase sends the codes', async () => {
    const sb = supabase();
    const bad = await api(sb)(
      req('auth/code-request', { method: 'POST', body: { email: 'nope', locale: 'pl' } }),
    );
    expect(bad.status).toBe(400);
    const supabaseMode = {
      ...config,
      app: { ...config.app, auth: { ...config.app.auth, emailDelivery: 'supabase' as const } },
    };
    const off = await api(
      sb,
      supabaseMode,
    )(req('auth/code-request', { method: 'POST', body: { email: 'a@example.org', locale: 'pl' } }));
    expect(off.status).toBe(404);
  });
});

describe('/api/admin/code-requests', () => {
  const rpc: Record<string, Rpc> = {
    code_requests_list: () => ({ body: [{ id: REQ, email: 'ala@example.org' }] }),
    code_request_get: (a) => ({
      body: a.p_id === REQ ? { id: REQ, email: 'ala@example.org', locale: 'pl' } : null,
    }),
    code_request_mark: () => ({ body: true }),
    code_request_delete: (a) => ({ body: a.p_id === REQ }),
  };

  it('is for the admin only', async () => {
    const sb = supabase(rpc);
    expect((await api(sb)(req('admin/code-requests'))).status).toBe(401);
    expect((await api(sb)(req('admin/code-requests', { token: 'user-token' }))).status).toBe(403);
    expect((await api(sb)(req('admin/code-requests', { token: 'mod-token' }))).status).toBe(403);
    const ok = await api(sb)(req('admin/code-requests', { token: 'admin-token' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([{ id: REQ, email: 'ala@example.org' }]);
    expect(rpcCalls(sb, 'code_requests_list')[0]!.body).toEqual({
      p_retention_days: config.app.auth.codeRequestRetentionDays,
    });
  });

  it('creates the user, gets a code without Supabase sending mail, and fills the email', async () => {
    const sb = supabase(rpc);
    const res = await api(sb)(
      req(`admin/code-requests/${REQ}/generate`, { method: 'POST', token: 'admin-token' }),
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ email: 'ala@example.org', locale: 'pl', code: '123456' });
    expect(out.subject).toBe('Twój kod do Happow: 123456');
    expect(out.body).toContain('123456');
    expect(out.body).toContain(out.link);
    expect(out.body).toContain(`${config.app.auth.codeValidHours} godz.`);
    expect(out.mailto).toMatch(/^mailto:ala%40example\.org\?subject=Tw%C3%B3j/);
    expect(out.mailto).toContain('%0D%0A');
    const paths = sb.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain('POST /auth/v1/admin/users');
    expect(sb.calls.find((c) => c.path === '/auth/v1/admin/generate_link')!.body).toEqual({
      type: 'magiclink',
      email: 'ala@example.org',
      redirect_to: 'https://happow.example/',
    });
    // Marked only after the code exists.
    expect(paths.indexOf('POST /rest/v1/rpc/code_request_mark')).toBeGreaterThan(
      paths.indexOf('POST /auth/v1/admin/generate_link'),
    );
    expect(sb.calls.some((c) => c.path === '/auth/v1/otp')).toBe(false);
  });

  it('works for an existing user too', async () => {
    const sb = supabase(rpc, { userExists: true });
    const res = await api(sb)(
      req(`admin/code-requests/${REQ}/generate`, { method: 'POST', token: 'admin-token' }),
    );
    expect(res.status).toBe(200);
  });

  it('dismisses a request and answers 404 for unknown ids', async () => {
    const sb = supabase(rpc);
    const a = api(sb);
    const del = (id: string) =>
      a(req(`admin/code-requests/${id}`, { method: 'DELETE', token: 'admin-token' }));
    expect((await del(REQ)).status).toBe(204);
    expect((await del('11111111-2222-4333-8444-555555555555')).status).toBe(404);
    expect((await del('not-a-uuid')).status).toBe(404);
    const gen = await a(
      req('admin/code-requests/11111111-2222-4333-8444-555555555555/generate', {
        method: 'POST',
        token: 'admin-token',
      }),
    );
    expect(gen.status).toBe(404);
  });
});

describe('plans on /api/me', () => {
  const withPromo = (earlyAccess: typeof config.plans.earlyAccess) => ({
    ...config,
    plans: { ...config.plans, earlyAccess },
  });
  const me = async (sb: ReturnType<typeof supabase>, cfg = config) =>
    (await api(sb, cfg)(req('me', { token: 'user-token' }))).json();

  it('is the account plan once the promotion is over', async () => {
    const ended = withPromo({ plan: 'premium', until: '2026-10-23' });
    expect(await me(supabase(), ended)).toMatchObject({
      plan: 'account',
      planSource: 'account',
      planEndsAt: null,
      entitlements: { 'events.perMonth': 15, 'autofill.perMonth': 5, 'presets.premium': false },
      usage: { events: { used: 3, limit: 15 }, autofill: { used: 1, limit: 5 } },
    });
  });

  it('takes premium from an active grant', async () => {
    const sb = supabase({
      grants_active: () => ({
        body: [
          { plan: 'premium', source: 'manual', startsAt: '2026-10-01T00:00:00Z', endsAt: null },
          // Not started yet: ignored.
          {
            plan: 'premium',
            source: 'purchase',
            startsAt: '2027-01-01T00:00:00Z',
            endsAt: '2027-02-01T00:00:00Z',
          },
        ],
      }),
    });
    expect(await me(sb, withPromo(null))).toMatchObject({
      plan: 'premium',
      planSource: 'manual',
      planEndsAt: null,
      entitlements: { 'events.perMonth': 300 },
    });
  });
});

describe('/api/admin/grants', () => {
  const GRANT = '9c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';
  const rpc: Record<string, Rpc> = {
    grants_list: () => ({ body: [{ id: GRANT, email: 'ala@example.org', active: true }] }),
    grant_add: (a) => ({ body: { id: GRANT, plan: a.p_plan, endsAt: a.p_ends_at } }),
    grant_end: (a) => ({ body: a.p_id === GRANT }),
  };
  const post = (sb: ReturnType<typeof supabase>, body: unknown, token = 'admin-token') =>
    api(sb)(req('admin/grants', { method: 'POST', token, body }));

  it('is for the admin only', async () => {
    const sb = supabase(rpc);
    expect((await api(sb)(req('admin/grants', { token: 'mod-token' }))).status).toBe(403);
    const asUser = await post(sb, { email: 'x@example.org', endsAt: null }, 'user-token');
    expect(asUser.status).toBe(403);
    const ok = await api(sb)(req('admin/grants', { token: 'admin-token' }));
    expect(await ok.json()).toEqual([{ id: GRANT, email: 'ala@example.org', active: true }]);
  });

  it('creates the account if needed, then grants premium, with or without an end', async () => {
    const sb = supabase(rpc);
    const res = await post(sb, { email: ' New@Example.org ', endsAt: null, note: 'organiser' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: GRANT, plan: 'premium', endsAt: null });
    const paths = sb.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.indexOf('POST /auth/v1/admin/users')).toBeLessThan(
      paths.indexOf('POST /rest/v1/rpc/grant_add'),
    );
    expect(rpcCalls(sb, 'grant_add')[0]!.body).toEqual({
      p_email: 'new@example.org',
      p_plan: 'premium',
      p_ends_at: null,
      p_note: 'organiser',
      p_created_by: 'owner@example.org',
    });
    const dated = await post(sb, { email: 'ala@example.org', endsAt: '2027-01-31T23:00:00Z' });
    expect(dated.status).toBe(201);
  });

  it('rejects an end in the past, an unknown plan and a missing end', async () => {
    const sb = supabase(rpc);
    const past = await post(sb, { email: 'a@example.org', endsAt: '2026-10-01T00:00:00Z' });
    expect(past.status).toBe(400);
    const gold = await post(sb, { email: 'a@example.org', endsAt: null, plan: 'gold' });
    expect(gold.status).toBe(400);
    expect((await post(sb, { email: 'a@example.org' })).status).toBe(400);
    expect(rpcCalls(sb, 'grant_add')).toHaveLength(0);
  });

  it('ends a grant now, and answers 404 for unknown ids', async () => {
    const sb = supabase(rpc);
    const del = (id: string) =>
      api(sb)(req(`admin/grants/${id}`, { method: 'DELETE', token: 'admin-token' }));
    expect((await del(GRANT)).status).toBe(204);
    expect(rpcCalls(sb, 'grant_end')[0]!.body).toEqual({ p_id: GRANT });
    expect((await del(REQ)).status).toBe(404);
    expect((await del('nope')).status).toBe(404);
  });
});

describe('/api/premium', () => {
  const change = (endsAt: string, providerRef = 'sub_1'): GrantChange => ({
    userId: 'u1',
    plan: 'premium',
    providerRef,
    startsAt: '2026-10-24T12:00:00Z',
    endsAt,
  });

  /** Stands in for a real provider (Stripe, a store…), through the interface only. */
  function fakeProvider() {
    const p: PremiumProvider & { pending: GrantChange[] } = {
      id: 'fake',
      pending: [],
      offers: async () => [
        { id: 'monthly', plan: 'premium', period: 'month', price: 4.99, currency: 'PLN' },
      ],
      checkout: async (user, offerId, returnUrl) => ({
        url: `https://pay.example/${offerId}?u=${user.id}&back=${encodeURIComponent(returnUrl)}`,
      }),
      // Whatever user the store says, only the sender gets the plan.
      verify: async (_user, receipt) => [
        { ...change('2026-11-24T12:00:00Z', receipt), userId: 'x' },
      ],
      webhook: async (r) => {
        if (r.headers.get('x-signature') !== 'good') throw new ApiError(401, 'bad_signature');
        return p.pending;
      },
    };
    return p;
  }

  it('offers nothing and has no provider endpoints when none is configured', async () => {
    const sb = supabase();
    expect(config.app.premium.providers).toEqual([]);
    const offers = await api(sb)(req('premium/offers'));
    expect(offers.status).toBe(200);
    expect(await offers.json()).toEqual({ offers: [] });
    const body = { provider: 'fake', offerId: 'monthly' };
    const checkout = await api(sb)(
      req('premium/checkout', { method: 'POST', token: 'user-token', body }),
    );
    expect(checkout.status).toBe(404);
    const hook = await api(sb)(req('premium/webhook/fake', { method: 'POST', body: {} }));
    expect(hook.status).toBe(404);
  });

  it('lists offers and starts a checkout that returns to the app', async () => {
    const a = api(supabase(), config, [fakeProvider()]);
    expect(await (await a(req('premium/offers'))).json()).toEqual({
      offers: [
        {
          id: 'monthly',
          plan: 'premium',
          period: 'month',
          price: 4.99,
          currency: 'PLN',
          provider: 'fake',
        },
      ],
    });
    const body = { provider: 'fake', offerId: 'monthly' };
    expect((await a(req('premium/checkout', { method: 'POST', body }))).status).toBe(401);
    const res = await a(req('premium/checkout', { method: 'POST', token: 'user-token', body }));
    expect(await res.json()).toEqual({
      url: 'https://pay.example/monthly?u=u1&back=https%3A%2F%2Fhappow.example%2F',
    });
  });

  it('turns webhook events into grants: paid, cancelled to the period end, refunded now', async () => {
    const sb = supabase({ grant_apply: () => ({ body: {} }) });
    const provider = fakeProvider();
    const a = api(sb, config, [provider]);
    const hook = (signature: string) =>
      a(
        new Request('https://happow.example/api/premium/webhook/fake', {
          method: 'POST',
          headers: { 'x-signature': signature },
          body: '{}',
        }),
      );
    const ends = ['2026-11-24T12:00:00Z', '2026-11-24T12:00:00Z', '2026-10-30T09:00:00Z'];
    for (const end of ends) {
      provider.pending = [change(end)];
      expect((await hook('good')).status).toBe(200);
    }
    expect(rpcCalls(sb, 'grant_apply').map((c) => c.body)).toEqual(
      ends.map((end) => ({
        p_user: 'u1',
        p_plan: 'premium',
        p_provider: 'fake',
        p_ref: 'sub_1',
        p_starts_at: '2026-10-24T12:00:00Z',
        p_ends_at: end,
      })),
    );
    // A bad signature writes nothing; an unknown provider is 404.
    expect((await hook('forged')).status).toBe(401);
    expect(rpcCalls(sb, 'grant_apply')).toHaveLength(3);
    expect((await a(req('premium/webhook/other', { method: 'POST', body: {} }))).status).toBe(404);
  });

  it('verifies a store receipt for the user who sent it and answers with their plan', async () => {
    const sb = supabase({ grant_apply: () => ({ body: {} }) });
    const a = api(sb, config, [fakeProvider()]);
    const body = { provider: 'fake', receipt: 'token-1' };
    const res = await a(req('premium/verify', { method: 'POST', token: 'user-token', body }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      plan: 'premium',
      entitlements: { 'events.perMonth': 300 },
    });
    expect(rpcCalls(sb, 'grant_apply')[0]!.body).toMatchObject({
      p_user: 'u1',
      p_ref: 'token-1',
    });
  });
});
