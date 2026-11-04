import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';

/** M10 slice B: saved events synced across an account's devices. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
const now = () => new Date('2026-10-29T22:30:00Z');
const config = loadConfig();

type Rpc = (args: Record<string, unknown>) => { status?: number; body: unknown };
function backend(rpc: Record<string, Rpc>, cfg = config) {
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
  const api = createApi(env, { config: cfg, fetch: f as typeof fetch, now, extractor: null });
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

const merged = [{ id: 'e1', on: true, going: true, at: 1_793_000_000_000 }];

describe('POST /api/me/saved (M10 §2)', () => {
  it("merges the device's list into the account's and returns the result", async () => {
    const b = backend({ saved_sync: () => ({ body: merged }) });
    const items = [
      { id: 'e1', on: true, going: true, at: 1_793_000_000_000 },
      { id: 'e2', on: false, at: 1_792_000_000_000 },
    ];
    const res = await b.api(req('me/saved', { token: 'user-token', body: { items } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ items: merged });
    expect(b.call('saved_sync')[0]!.args).toEqual({
      p_user: 'u1',
      p_items: [items[0], { ...items[1], going: false }],
      p_keep_removed_days: config.app.agenda.keepRemovedDays,
      p_max: config.app.agenda.maxSaved,
    });
    // Rate-limited per account.
    expect(b.call('rate_limit_hit')[0]!.args).toMatchObject({ p_bucket: 'saved', p_actor: 'u1' });
  });

  it('needs a sign-in, a plan with saved.sync and a valid list', async () => {
    const b = backend({ saved_sync: () => ({ body: merged }) });
    expect((await b.api(req('me/saved', { body: { items: [] } }))).status).toBe(401);
    const bad = await b.api(
      req('me/saved', { token: 'user-token', body: { items: [{ id: '', on: true, at: 1 }] } }),
    );
    expect(bad.status).toBe(400);
    const tooMany = Array.from({ length: config.app.agenda.maxSaved * 3 + 1 }, (_, i) => ({
      id: `e${i}`,
      on: true,
      at: 1,
    }));
    expect(
      (await b.api(req('me/saved', { token: 'user-token', body: { items: tooMany } }))).status,
    ).toBe(400);
    expect((await b.api(req('me/saved', { token: 'user-token' }))).status).toBe(404);

    // A config where the free account has no sync and no promotion runs.
    const noSync = {
      ...config,
      plans: {
        ...config.plans,
        earlyAccess: null,
        plans: {
          ...config.plans.plans,
          account: { ...config.plans.plans.account, 'saved.sync': false },
        },
      },
    } satisfies typeof config;
    const c = backend({ saved_sync: () => ({ body: merged }) }, noSync);
    const res = await c.api(req('me/saved', { token: 'user-token', body: { items: [] } }));
    expect(res.status).toBe(403);
    expect(c.call('saved_sync')).toEqual([]);
  });
});
