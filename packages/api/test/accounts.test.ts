import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';

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
const api = (sb: ReturnType<typeof supabase>, cfg = config) =>
  createApi(env, { fetch: sb.fetch, now, config: cfg, extractor: null });
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
    });
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
