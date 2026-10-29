import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';

/** M12 slice L: calendar feeds an account imports its events from. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
const now = () => new Date('2026-10-29T22:30:00Z');
const config = loadConfig();

type Rpc = (args: Record<string, unknown>) => { status?: number; body: unknown };
function backend(rpc: Record<string, Rpc>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const users: Record<string, { id: string; email: string }> = {
    'user-token': { id: 'u1', email: 'ala@example.org' },
    'mod-token': { id: 'u2', email: 'mod@example.org' },
    'admin-token': { id: 'u3', email: 'owner@example.org' },
  };
  const all: Record<string, Rpc> = {
    rate_limit_hit: () => ({ body: true }),
    staff_role: (a) => ({
      body:
        { 'mod@example.org': 'moderator', 'owner@example.org': 'admin' }[a.p_email as string] ??
        null,
    }),
    grants_active: () => ({ body: [] }),
    usage_get: () => ({ body: { events: 0, autofills: 0 } }),
    contributor_trusted: () => ({ body: false }),
    duplicate_candidates: () => ({ body: { title: 'Pchli targ na Ruskiej', others: [] } }),
    contribution_award: () => ({ body: { kind: 'verified', days: 3, startsAt: null } }),
    ...rpc,
  };
  const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
      const name = url.slice(`${SB}/rest/v1/rpc/`.length);
      const args = JSON.parse(String(init.body ?? '{}'));
      calls.push({ name, args });
      const h = all[name];
      if (!h) return new Response('{}', { status: 404 });
      const { status = 200, body } = h(args);
      return new Response(JSON.stringify(body), { status });
    }
    if (url === `${SB}/auth/v1/user`) {
      const token = new Headers(init.headers).get('authorization')?.replace('Bearer ', '') ?? '';
      const u = users[token];
      return u ? Response.json(u) : new Response('{}', { status: 401 });
    }
    return new Response('not found', { status: 404 });
  });
  const api = createApi(env, { config, fetch: f as typeof fetch, now, extractor: null });
  const call = (name: string) => calls.filter((c) => c.name === name);
  return { api, call };
}
const req = (path: string, init: { token?: string; body?: unknown; method?: string } = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });

const feed = { id: 1, url: 'https://kalendarz.example/moje.ics', status: 'active' };
const fail =
  (code: string): Rpc =>
  () => ({ status: 400, body: { code, message: code } });

describe('GET/POST/DELETE /api/me/feeds (M12 §4.6)', () => {
  it("lists the account's feeds with the most it may add", async () => {
    const b = backend({ feeds_list: () => ({ body: [feed] }) });
    const res = await b.api(req('me/feeds', { token: 'user-token' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      feeds: [feed],
      max: config.plans.contributions.feedsPerAccount,
    });
    expect(b.call('feeds_list')[0]!.args).toEqual({ p_user: 'u1' });
  });

  it('adds a feed, reading webcal:// as https, within the account limit', async () => {
    const b = backend({ feed_add: () => ({ body: feed }), feeds_list: () => ({ body: [feed] }) });
    const res = await b.api(
      req('me/feeds', {
        token: 'user-token',
        body: { url: 'webcal://kalendarz.example/moje.ics' },
      }),
    );
    expect(res.status).toBe(200);
    expect(b.call('feed_add')[0]!.args).toEqual({
      p_user: 'u1',
      p_url: 'https://kalendarz.example/moje.ics',
      p_region: 'wroclaw',
      p_max: config.plans.contributions.feedsPerAccount,
    });
  });

  it('refuses a private address, too many feeds, and one an admin stopped', async () => {
    const b = backend({ feed_add: () => ({ body: feed }) });
    const local = await b.api(
      req('me/feeds', { token: 'user-token', body: { url: 'http://127.0.0.1/x.ics' } }),
    );
    expect(local.status).toBe(400);
    expect((await local.json()).error).toBe('unsafe_url');
    expect(b.call('feed_add')).toHaveLength(0);
    const full = backend({ feed_add: fail('HQ002') });
    const r = await full.api(req('me/feeds', { token: 'user-token', body: { url: feed.url } }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'too_many_feeds', max: 2 });
    const stopped = backend({ feed_add: fail('HQ003') });
    const s = await stopped.api(req('me/feeds', { token: 'user-token', body: { url: feed.url } }));
    expect((await s.json()).error).toBe('feed_stopped');
  });

  it('removes only its own active feed, and needs an account', async () => {
    const b = backend({
      feed_remove: (a) => ({ body: a.p_id === 1 }),
      feeds_list: () => ({ body: [] }),
    });
    expect((await b.api(req('me/feeds/1', { token: 'user-token', method: 'DELETE' }))).status).toBe(
      200,
    );
    expect(b.call('feed_remove')[0]!.args).toEqual({ p_user: 'u1', p_id: 1 });
    expect((await b.api(req('me/feeds/2', { token: 'user-token', method: 'DELETE' }))).status).toBe(
      404,
    );
    expect((await b.api(req('me/feeds/x', { token: 'user-token', method: 'DELETE' }))).status).toBe(
      404,
    );
    expect((await b.api(req('me/feeds'))).status).toBe(401);
  });
});

describe('POST /api/admin/feeds/:id (M12 §4.6)', () => {
  it('lets an admin stop a feed or start it again, and nobody else', async () => {
    const b = backend({ feed_set_status: (a) => ({ body: { ...feed, status: a.p_status } }) });
    const stop = await b.api(
      req('admin/feeds/1', { token: 'admin-token', body: { action: 'stop' } }),
    );
    expect(stop.status).toBe(200);
    expect(b.call('feed_set_status')[0]!.args).toEqual({
      p_feed: 1,
      p_status: 'stopped',
      p_by: 'owner@example.org',
    });
    await b.api(req('admin/feeds/1', { token: 'admin-token', body: { action: 'resume' } }));
    expect(b.call('feed_set_status')[1]!.args.p_status).toBe('active');
    expect(
      (await b.api(req('admin/feeds/1', { token: 'mod-token', body: { action: 'stop' } }))).status,
    ).toBe(403);
    const none = backend({ feed_set_status: fail('P0002') });
    expect(
      (await none.api(req('admin/feeds/9', { token: 'admin-token', body: { action: 'stop' } })))
        .status,
    ).toBe(404);
  });
});

describe('GET /api/admin/coverage (M12 §3)', () => {
  it('gives the admin the region’s coverage now, and nobody else', async () => {
    const body = { now: {}, districts: [], weeks: [] };
    const b = backend({ coverage: () => ({ body }) });
    const res = await b.api(req('admin/coverage?region=wroclaw', { token: 'admin-token' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual(body);
    expect(b.call('coverage')[0]!.args).toEqual({
      p_region: 'wroclaw',
      p_at: now().toISOString(),
      p_evening_hour: config.app.metrics.eveningFromHour,
    });
    expect((await b.api(req('admin/coverage', { token: 'mod-token' }))).status).toBe(403);
    const unknown = backend({ coverage: fail('P0002') });
    expect(
      (await unknown.api(req('admin/coverage?region=x', { token: 'admin-token' }))).status,
    ).toBe(404);
  });
});
