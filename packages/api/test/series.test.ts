import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';

/** M12 slice I: a weekly repeat stored as one submission and one event per date. */

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
  };
  const all: Record<string, Rpc> = {
    rate_limit_hit: () => ({ body: true }),
    staff_role: (a) => ({ body: a.p_email === 'mod@example.org' ? 'moderator' : null }),
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
const req = (path: string, init: { token?: string; body?: unknown } = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });

const SERIES = '5d1c7a3e-2f4d-4e5a-9b6c-7d8e9f0a1b2c';
const event = {
  title: 'Pchli targ na Ruskiej',
  categoryIds: ['garage-sale'],
  venueName: 'Podwórko Ruska 46',
  address: 'ul. Ruska 46',
  point: { lat: 51.1105, lng: 17.0255 },
  start: '2026-11-07T10:00',
  end: '2026-11-07T14:00',
  isFree: true,
  url: null,
};
type Item = {
  id: string;
  form: { start: string; end: string };
  normalized: { event: { startAt: string }; venue: { id: string } };
};
const send = (b: ReturnType<typeof backend>, repeat?: object, token = 'user-token') =>
  b.api(req('submissions', { token, body: { deviceId: 'device-0123456789', event, repeat } }));
const stored = (b: ReturnType<typeof backend>) =>
  b.call('submit_series')[0]!.args as { p_series: string; p_items: Item[] };
const series: Record<string, Rpc> = {
  submit_series: (a) => ({
    body: (a.p_items as Item[]).map((i) => ({ id: i.id, eventId: `submissions:${i.id}` })),
  }),
};
const fail =
  (code: string): Rpc =>
  () => ({ status: 400, body: { code, message: code } });

describe('POST /api/submissions with a weekly repeat (M12 §4.5)', () => {
  it('stores one submission per date in one call, each with its own times on the region clock', async () => {
    const b = backend(series);
    const res = await send(b, { days: [6], until: '2026-11-28' });
    expect(res.status).toBe(201);
    const out = await res.json();
    const { p_series, p_items } = stored(b);
    expect(p_items.map((i) => [i.form.start, i.form.end])).toEqual([
      ['2026-11-07T10:00', '2026-11-07T14:00'],
      ['2026-11-14T10:00', '2026-11-14T14:00'],
      ['2026-11-21T10:00', '2026-11-21T14:00'],
      ['2026-11-28T10:00', '2026-11-28T14:00'],
    ]);
    // Winter time in Warsaw: 10:00 is 09:00 UTC.
    expect(p_items[0]!.normalized.event.startAt).toBe('2026-11-07T09:00:00.000Z');
    expect(new Set(p_items.map((i) => i.id)).size).toBe(4);
    // One place for the whole series.
    expect(new Set(p_items.map((i) => i.normalized.venue.id)).size).toBe(1);
    expect(out).toMatchObject({ seriesId: p_series, id: p_items[0]!.id, status: 'published' });
    expect(out.dates).toHaveLength(4);
    expect(b.call('submit_event')).toHaveLength(0);
  });

  it('refuses too many dates, none, or a repeat without an account', async () => {
    const b = backend(series);
    const many = await send(b, { days: [1, 2, 3, 4, 5, 6, 7], until: '2027-01-30' });
    expect(many.status).toBe(400);
    expect((await many.json()).message).toBe('repeat');
    expect((await send(b, { days: [6], until: '2026-11-01' })).status).toBe(400);
    expect((await send(b, { days: [6], until: '2026-11-28' }, '')).status).toBe(401);
    expect(b.call('submit_series')).toHaveLength(0);
  });

  it('stores nothing when the dates would pass the monthly quota', async () => {
    const b = backend({ submit_series: fail('HQ001') });
    const res = await send(b, { days: [6], until: '2026-11-28' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('quota_exceeded');
  });

  it('rewards a trusted series once, on its first date', async () => {
    const b = backend({ ...series, contributor_trusted: () => ({ body: true }) });
    const out = await (await send(b, { days: [6], until: '2026-11-28' })).json();
    expect(b.call('contribution_award').map((c) => c.args.p_submission)).toEqual([out.id]);
    expect(out.reward).toMatchObject({ kind: 'verified' });
  });
});

describe('moderating a series (M12 §4.5)', () => {
  const path = `moderation/series/${SERIES}`;

  it('approves every pending date at once and rewards the first', async () => {
    const dates = [
      { id: 'a1', eventId: 'submissions:a1', action: 'approve' },
      { id: 'a2', eventId: 'submissions:a2', action: 'approve' },
    ];
    const b = backend({ moderate_series: () => ({ body: dates }) });
    const res = await b.api(req(path, { token: 'mod-token', body: { action: 'approve' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seriesId: SERIES, dates });
    expect(b.call('moderate_series')[0]!.args).toMatchObject({
      p_series: SERIES,
      p_action: 'approve',
      p_moderator: 'mod@example.org',
    });
    expect(b.call('contribution_award').map((c) => c.args.p_submission)).toEqual(['a1']);
  });

  it('rejects without a reward, and answers 409, 404 and 403 as for one submission', async () => {
    const b = backend({
      moderate_series: () => ({ body: [{ id: 'a1', eventId: null, action: 'reject' }] }),
    });
    const reject = { token: 'mod-token', body: { action: 'reject' } };
    expect((await b.api(req(path, reject))).status).toBe(200);
    expect(b.call('contribution_award')).toHaveLength(0);
    const done = backend({ moderate_series: fail('P0001') });
    expect((await done.api(req(path, reject))).status).toBe(409);
    expect((await b.api(req('moderation/series/nope', reject))).status).toBe(404);
    expect(
      (await b.api(req(path, { token: 'user-token', body: { action: 'reject' } }))).status,
    ).toBe(403);
  });
});
