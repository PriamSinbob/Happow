import { describe, expect, it } from 'vitest';
import { createApi } from '../src';
import { config, env, req, submitRpc, supabase, type Rpc } from './helpers';

/** Saved events synced across an account's devices. */

const now = () => new Date('2026-10-29T22:30:00Z');

function backend(rpc: Record<string, Rpc>, cfg = config) {
  const sb = supabase({ ...submitRpc, ...rpc });
  return { ...sb, api: createApi(env, { config: cfg, fetch: sb.fetch, now, extractor: null }) };
}

const merged = [{ id: 'e1', on: true, going: true, at: 1_793_000_000_000 }];

describe('POST /api/me/saved', () => {
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
