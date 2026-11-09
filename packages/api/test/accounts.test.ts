import { describe, expect, it } from 'vitest';
import { createApi } from '../src';
import { config, env, req, SB, supabase as fake, users, type Rpc } from './helpers';

const REQ = '0b7a3c1e-2f4d-4e5a-9b6c-7d8e9f0a1b2c';

/** Fake Supabase with a profile, some usage this month and GoTrue's admin endpoints. */
function supabase(rpc: Record<string, Rpc> = {}, opts: { userExists?: boolean } = {}) {
  return fake(
    {
      profile_get: () => ({ body: { displayName: null, locale: 'pl', termsVersion: null } }),
      usage_get: () => ({ body: { events: 3, autofills: 1 } }),
      ...rpc,
    },
    {
      users: { ...users, 'user-token': { id: 'u1', email: 'Ala@Example.org' } },
      other: (url, init) => {
        const path = url.slice(SB.length);
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : {};
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
        return undefined;
      },
    },
  );
}

const now = () => new Date('2026-10-24T12:00:00Z');
const api = (sb: ReturnType<typeof supabase>, cfg = config) =>
  createApi(env, { fetch: sb.fetch, now, config: cfg, extractor: null });

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
        private: { used: 0, limit: 300 },
      },
    });
    expect(sb.call('usage_get')[0]!.args).toEqual({ p_user: 'u1', p_month: '2026-10-01' });
    expect(sb.call('grants_active')[0]!.args).toEqual({ p_user: 'u1' });
    expect(sb.call('profile_get')[0]!.args).toEqual({ p_user: 'u1' });
  });

  it('checks a token with Supabase once while it is cached', async () => {
    const sb = supabase();
    const a = api(sb);
    await a(req('me', { token: 'user-token' }));
    await a(req('me', { token: 'user-token' }));
    expect(sb.requests.filter((c) => c.path === '/auth/v1/user')).toHaveLength(1);
  });

  it('accepts only the current terms version and a known language', async () => {
    const sb = supabase({ profile_update: () => ({ status: 204, body: null }) });
    const a = api(sb);
    const put = (body: unknown) => a(req('me', { method: 'PUT', token: 'user-token', body }));
    expect((await put({ termsVersion: 'old' })).status).toBe(400);
    expect((await put({ locale: 'de' })).status).toBe(400);
    expect((await put({ locale: 'en', termsVersion: config.app.legal.termsVersion })).status).toBe(
      200,
    );
    expect(sb.call('profile_update')[0]!.args).toEqual({
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
    const order = sb.requests.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('POST /rest/v1/rpc/account_forget')).toBeLessThan(
      order.indexOf('DELETE /auth/v1/admin/users/u1'),
    );
    expect(sb.call('account_forget')[0]!.args).toEqual({
      p_user: 'u1',
      p_email: 'ala@example.org',
    });
    // The cached token is forgotten with the account.
    await a(req('me', { token: 'user-token' }));
    expect(sb.requests.filter((c) => c.path === '/auth/v1/user')).toHaveLength(2);
  });
});

describe('POST /api/auth/code-request', () => {
  it('files the request with a lowercased email and answers the same whatever the email', async () => {
    const sb = supabase({ request_code: () => ({ status: 204, body: null }) });
    const a = api(sb);
    const res = await a(
      req('auth/code-request', {
        method: 'POST',
        body: { email: ' Ala@Example.org ', locale: 'pl' },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    const call = sb.call('request_code')[0]!.args;
    expect(call).toMatchObject({ p_email: 'ala@example.org', p_locale: 'pl' });
    // Hashed client, never the raw IP.
    expect(call.p_client).toMatch(/^[0-9a-f]{64}$/);
    expect(sb.requests.some((c) => c.path.startsWith('/auth/v1'))).toBe(false);
  });

  it('is rate-limited per client and per email', async () => {
    const sb = supabase({
      request_code: () => ({ status: 204, body: null }),
      rate_limit_hit: (a) => ({ body: a.p_bucket !== 'code-request-email' }),
    });
    const res = await api(sb)(
      req('auth/code-request', { method: 'POST', body: { email: 'a@example.org', locale: 'en' } }),
    );
    expect(res.status).toBe(429);
    const buckets = sb.call('rate_limit_hit').map((c) => c.args);
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
    expect(sb.call('request_code')).toHaveLength(0);
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
    expect(sb.call('code_requests_list')[0]!.args).toEqual({
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
    const paths = sb.requests.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain('POST /auth/v1/admin/users');
    expect(sb.requests.find((c) => c.path === '/auth/v1/admin/generate_link')!.body).toEqual({
      type: 'magiclink',
      email: 'ala@example.org',
      redirect_to: 'https://happow.example/',
    });
    // Marked only after the code exists.
    expect(paths.indexOf('POST /rest/v1/rpc/code_request_mark')).toBeGreaterThan(
      paths.indexOf('POST /auth/v1/admin/generate_link'),
    );
    expect(sb.requests.some((c) => c.path === '/auth/v1/otp')).toBe(false);
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
    const paths = sb.requests.map((c) => `${c.method} ${c.path}`);
    expect(paths.indexOf('POST /auth/v1/admin/users')).toBeLessThan(
      paths.indexOf('POST /rest/v1/rpc/grant_add'),
    );
    expect(sb.call('grant_add')[0]!.args).toEqual({
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
    expect(sb.call('grant_add')).toHaveLength(0);
  });

  it('ends a grant now, and answers 404 for unknown ids', async () => {
    const sb = supabase(rpc);
    const del = (id: string) =>
      api(sb)(req(`admin/grants/${id}`, { method: 'DELETE', token: 'admin-token' }));
    expect((await del(GRANT)).status).toBe(204);
    expect(sb.call('grant_end')[0]!.args).toEqual({ p_id: GRANT });
    expect((await del(REQ)).status).toBe(404);
    expect((await del('nope')).status).toBe(404);
  });
});

describe('/api/admin/sources', () => {
  const rpc: Record<string, Rpc> = {
    source_candidates_list: () => ({
      body: [{ id: 7, status: 'new', url: 'https://klub.example/k.ics' }],
    }),
    source_candidate_decide: (a) =>
      a.p_id === 7
        ? a.p_action === 'restore'
          ? { status: 400, body: { code: 'HQ002', message: 'cannot restore a new candidate' } }
          : { body: { id: 7, status: a.p_action === 'accept' ? 'accepted' : 'rejected' } }
        : { body: null },
  };
  const decide = (
    sb: ReturnType<typeof supabase>,
    id: string,
    body: unknown,
    token = 'admin-token',
  ) => api(sb)(req(`admin/sources/${id}`, { method: 'POST', token, body }));

  it('is for the admin only', async () => {
    const sb = supabase(rpc);
    expect((await api(sb)(req('admin/sources', { token: 'mod-token' }))).status).toBe(403);
    expect((await decide(sb, '7', { action: 'accept' }, 'user-token')).status).toBe(403);
    const ok = await api(sb)(req('admin/sources', { token: 'admin-token' }));
    expect(await ok.json()).toEqual([{ id: 7, status: 'new', url: 'https://klub.example/k.ics' }]);
  });

  it('records who decided, and answers 404 for unknown ids', async () => {
    const sb = supabase(rpc);
    const res = await decide(sb, '7', { action: 'accept' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, status: 'accepted' });
    expect(sb.call('source_candidate_decide')[0]!.args).toEqual({
      p_id: 7,
      p_action: 'accept',
      p_by: 'owner@example.org',
    });
    expect((await decide(sb, '8', { action: 'accept' })).status).toBe(404);
    expect((await decide(sb, 'abc', { action: 'accept' })).status).toBe(404);
  });

  it('refuses an unknown action, and says when the status changed meanwhile', async () => {
    const sb = supabase(rpc);
    expect((await decide(sb, '7', { action: 'delete' })).status).toBe(400);
    const stale = await decide(sb, '7', { action: 'restore' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'already_reviewed' });
  });
});
