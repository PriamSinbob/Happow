import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';

/** M12 slice E: rewards after moderation, trusted publishing, counts and the contributor's side. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
// Thu 29 Oct 2026, 23:30 in Warsaw: still October there, while UTC is already 22:30 the same day.
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
    usage_take: () => ({ body: true }),
    profile_get: () => ({ body: { displayName: null, locale: 'pl', termsVersion: null } }),
    contributor_trusted: () => ({ body: false }),
    trusted_recent: () => ({ body: [] }),
    moderation_queue: () => ({ body: { submissions: [], reports: [] } }),
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
  return { api, calls, call };
}
const req = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });

const SUB = '0b7a3c1e-2f4d-4e5a-9b6c-7d8e9f0a1b2c';
const approve = (b: ReturnType<typeof backend>, id = SUB) =>
  b.api(req(`moderation/submissions/${id}`, { token: 'mod-token', body: { action: 'approve' } }));
const decided = {
  moderate_submission: () => ({ body: { id: SUB, eventId: 'submissions:e1', action: 'approve' } }),
};

describe('rewards after moderation (M12 §5)', () => {
  it('records the reward on approval, with the configured days, the cap and the region month', async () => {
    const b = backend(decided);
    const res = await approve(b);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      action: 'approve',
      reward: { kind: 'verified', days: 3 },
    });
    expect(b.call('contribution_award')[0]!.args).toEqual({
      p_submission: SUB,
      p_duplicate_of: null,
      p_per_event: 3,
      p_cap: 30,
      p_month: '2026-10-01',
      // Earned during the promotion: the days start when it ends (midnight, 1 Dec, Warsaw).
      p_not_before: '2026-11-30T23:00:00.000Z',
    });
  });

  it('gives nothing for a rejection, and marks an event already listed elsewhere as a duplicate', async () => {
    const reject = backend({
      moderate_submission: () => ({
        body: { id: SUB, eventId: 'submissions:e1', action: 'reject' },
      }),
    });
    await reject.api(
      req(`moderation/submissions/${SUB}`, { token: 'mod-token', body: { action: 'reject' } }),
    );
    expect(reject.call('contribution_award')).toHaveLength(0);

    const dup = backend({
      ...decided,
      duplicate_candidates: () => ({
        body: {
          title: 'Pchli targ na Ruskiej',
          others: [
            { id: 'wroclaw-go:1', title: 'Koncert jazzowy' },
            { id: 'ticketmaster:9', title: 'Pchli Targ na Ruskiej 46' },
          ],
        },
      }),
    });
    await approve(dup);
    expect(dup.call('duplicate_candidates')[0]!.args).toEqual({
      p_event: 'submissions:e1',
      p_radius_m: config.app.dedup.radiusM,
      p_minutes: config.app.dedup.startToleranceMin,
    });
    expect(dup.call('contribution_award')[0]!.args.p_duplicate_of).toBe('ticketmaster:9');
  });

  it('keeps the approval when recording the reward fails', async () => {
    const b = backend({ ...decided, contribution_award: () => ({ status: 500, body: {} }) });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await approve(b)).status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lets moderators reject what a trusted account published, and revokes on hide', async () => {
    const b = backend({
      moderate_trusted: (a) => ({
        body: { id: a.p_id, eventId: 'submissions:e1', action: 'reject' },
      }),
      resolve_reports: () => ({ body: 1 }),
      contribution_revoke_event: () => ({ body: 3 }),
      trusted_recent: () => ({ body: [{ id: SUB }] }),
    });
    const q = await b.api(req('moderation', { token: 'mod-token' }));
    expect((await q.json()).trusted).toEqual([{ id: SUB }]);
    const r = await b.api(
      req(`moderation/trusted/${SUB}`, { token: 'mod-token', body: { action: 'reject' } }),
    );
    expect(r.status).toBe(200);
    expect(b.call('moderate_trusted')[0]!.args).toMatchObject({
      p_id: SUB,
      p_moderator: 'mod@example.org',
    });
    await b.api(
      req('moderation/reports/submissions:e1', { token: 'mod-token', body: { action: 'hide' } }),
    );
    expect(b.call('contribution_revoke_event')[0]!.args).toEqual({ p_event: 'submissions:e1' });
    await b.api(
      req('moderation/reports/submissions:e1', { token: 'mod-token', body: { action: 'dismiss' } }),
    );
    expect(b.call('contribution_revoke_event')).toHaveLength(1);
  });
});

describe('trusted publishing (M12 §5.3)', () => {
  const event = {
    deviceId: 'device-0123456789',
    event: {
      title: 'Pchli targ na Ruskiej',
      categoryIds: ['garage-sale'],
      venueName: 'Podwórko Ruska 46',
      address: 'ul. Ruska 46',
      point: { lat: 51.1105, lng: 17.0255 },
      start: '2026-10-31T10:00',
      end: null,
      isFree: true,
      url: null,
    },
  };

  it('publishes a trusted account’s event verified, and records its reward at once', async () => {
    const b = backend({
      contributor_trusted: () => ({ body: true }),
      submit_event: () => ({ body: 'x' }),
    });
    const res = await b.api(req('submissions', { token: 'user-token', body: event }));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out).toMatchObject({ status: 'published', trusted: true, reward: { days: 3 } });
    expect(b.call('contributor_trusted')[0]!.args).toEqual({ p_user: 'u1', p_after: 5 });
    expect(b.call('submit_event')[0]!.args.p_trusted).toBe(true);
    expect(b.call('contribution_award')[0]!.args.p_submission).toBe(out.id);
  });

  it('sends anyone else’s event to the queue with no reward yet', async () => {
    const b = backend({ submit_event: () => ({ body: 'x' }) });
    const out = await (
      await b.api(req('submissions', { token: 'user-token', body: event }))
    ).json();
    expect(out.trusted).toBe(false);
    expect(b.call('submit_event')[0]!.args.p_trusted).toBe(false);
    expect(b.call('contribution_award')).toHaveLength(0);
  });
});

describe('POST /api/counts (M12 §5.1)', () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ eventId: `e${i % 2}`, kind: i % 3 ? 'open' : 'route' }));

  it('adds totals per event on the region day, without storing the device', async () => {
    const b = backend({ counts_add: () => ({ body: 2 }) });
    const res = await b.api(
      req('counts', {
        body: {
          deviceId: 'device-0123456789',
          items: [
            { eventId: 'e1', kind: 'open' },
            { eventId: 'e1', kind: 'open' },
            { eventId: 'e1', kind: 'arrival' },
            { eventId: 'e2', kind: 'route' },
          ],
        },
      }),
    );
    expect(res.status).toBe(202);
    expect(b.call('counts_add')[0]!.args).toEqual({
      p_items: [
        { eventId: 'e1', opens: 2, routes: 0, arrivals: 1 },
        { eventId: 'e2', opens: 0, routes: 1, arrivals: 0 },
      ],
      // 23:30 in Warsaw on the 29th, though the server's clock could say otherwise.
      p_day: '2026-10-29',
    });
    const limited = b.call('rate_limit_hit').find((c) => c.args.p_bucket === 'counts')!;
    expect(String(limited.args.p_actor)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a batch over the limit and a device over its hourly limit', async () => {
    const big = backend({ counts_add: () => ({ body: 0 }) });
    const over = config.app.counts.maxBatch + 1;
    expect(
      (
        await big.api(
          req('counts', { body: { deviceId: 'device-0123456789', items: items(over) } }),
        )
      ).status,
    ).toBe(400);
    const busy = backend({ rate_limit_hit: () => ({ body: false }) });
    expect(
      (await busy.api(req('counts', { body: { deviceId: 'device-0123456789', items: items(2) } })))
        .status,
    ).toBe(429);
  });
});

describe('the contributor’s side of the account', () => {
  const data = (verified: number, opens: number, level: string | null) => ({
    contributions_get: () => ({
      body: { verified, opens, level, trusted: false, monthDays: 6, events: [] },
    }),
    contributor_level_set: () => ({ body: null }),
  });

  it('stores a newly reached level; levels never go down', async () => {
    const up = backend(data(5, 0, 'neighbour'));
    const res = await up.api(req('me/contributions', { token: 'user-token' }));
    expect(await res.json()).toMatchObject({
      level: 'local',
      monthDays: 6,
      premiumDaysPerMonth: 30,
    });
    expect(up.call('contributor_level_set')[0]!.args).toEqual({
      p_user: 'u1',
      p_level: 'local',
      p_order: ['neighbour', 'local', 'guide', 'cityGuide'],
    });
    // An event removed later: the count drops below Guide, the level stays.
    const kept = backend(data(19, 150, 'guide'));
    expect(
      await (await kept.api(req('me/contributions', { token: 'user-token' }))).json(),
    ).toMatchObject({
      level: 'guide',
    });
    expect(kept.call('contributor_level_set')).toHaveLength(0);
    expect((await kept.api(req('me/contributions'))).status).toBe(401);
  });

  it('turns the public credit on and names it; the admin restores trust', async () => {
    const b = backend({
      profile_update: () => ({ body: {} }),
      profile_prefs: () => ({ body: null }),
      trust_restore: (a) => ({ body: a.p_email === 'ala@example.org' }),
    });
    const put = await b.api(
      req('me', {
        method: 'PUT',
        token: 'user-token',
        body: { showName: true, displayName: 'Ala' },
      }),
    );
    expect(put.status).toBe(200);
    expect(b.call('profile_prefs')[0]!.args).toEqual({
      p_user: 'u1',
      p_show_name: true,
      p_display_name: 'Ala',
    });
    const trust = (email: string, token = 'admin-token') =>
      b.api(req('admin/trust', { token, body: { email } }));
    expect((await trust('Ala@Example.org')).status).toBe(200);
    expect((await trust('nobody@example.org')).status).toBe(404);
    expect((await trust('ala@example.org', 'mod-token')).status).toBe(403);
  });
});
