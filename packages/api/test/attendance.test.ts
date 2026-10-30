import { describe, expect, it, vi } from 'vitest';
import { attendanceBucket, loadConfig } from '@happow/core';
import { createApi } from '../src';

/** M9 slice E: "I'm going" and share links. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
const now = () => new Date('2026-10-30T12:00:00Z');
const config = loadConfig();

type Rpc = (args: Record<string, unknown>) => unknown;
function backend(rpc: Record<string, Rpc>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const all: Record<string, Rpc> = { rate_limit_hit: () => true, staff_role: () => null, ...rpc };
  const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
      const name = url.slice(`${SB}/rest/v1/rpc/`.length);
      const args = JSON.parse(String(init.body ?? '{}'));
      calls.push({ name, args });
      return Response.json(all[name]!(args));
    }
    if (url === `${SB}/auth/v1/user`) return Response.json({ id: 'u1', email: 'ala@example.org' });
    return new Response('not found', { status: 404 });
  });
  return { api: createApi(env, { fetch: f, now, config }), calls };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const raw = (going: number, over: object = {}) => ({
  categories: ['music'],
  counts: { going, looking: 2 },
  mine: ['going'],
  fromMyLinks: 3,
  ...over,
});

describe('attendance counts (M9 slice E)', () => {
  it('shows nothing below 5, then the highest bucket reached', () => {
    const cfg = config.app.attendance;
    expect([0, 4, 5, 9, 10, 24, 25, 300].map((n) => attendanceBucket(n, cfg))).toEqual([
      null,
      null,
      5,
      5,
      10,
      10,
      25,
      25,
    ]);
  });

  it("gives the card bucketed counts, this device's signals and its link count", async () => {
    const { api, calls } = backend({ attendance_get: () => raw(12) });
    const res = await api(post('attendance', { deviceId: 'device-123', eventId: 'e1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      counts: { going: 10, looking: null, onway: null, here: null },
      mine: { going: true, looking: false, onway: false, here: false },
      fromMyLinks: 3,
    });
    // The device leaves only as a salted hash.
    const p = calls.find((c) => c.name === 'attendance_get')!.args;
    expect(p.p_event).toBe('e1');
    expect(p.p_device).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shows no counts at all for a category with publicAttendance off', async () => {
    const { api } = backend({
      attendance_get: () => raw(40, { categories: ['religious'], counts: { going: 40, here: 30 } }),
    });
    const body = await (
      await api(post('attendance', { deviceId: 'device-123', eventId: 'e1' }))
    ).json();
    expect(body.counts).toEqual({ going: null, looking: null, onway: null, here: null });
    expect(body.fromMyLinks).toBeNull();
    // The person still sees their own mark.
    expect(body.mine.going).toBe(true);
  });

  it('marks going with the link it came from, keeps it till a day after, and limits the rate', async () => {
    const { api, calls } = backend({ attendance_set: () => raw(5) });
    const res = await api(
      post('attendance/set', {
        deviceId: 'device-123',
        eventId: 'e1',
        kind: 'going',
        on: true,
        token: 'tok-abcdefgh',
      }),
    );
    expect((await res.json()).counts.going).toBe(5);
    const p = calls.find((c) => c.name === 'attendance_set')!.args;
    expect(p).toMatchObject({
      p_event: 'e1',
      p_kind: 'going',
      p_on: true,
      p_token: 'tok-abcdefgh',
      p_keep_hours: 24,
      p_user: null,
      p_until: null,
    });
    expect(calls.find((c) => c.name === 'rate_limit_hit')!.args).toMatchObject({
      p_bucket: 'attendance',
      p_max: config.app.attendance.perHourPerDevice,
    });
  });

  it('keeps the signed-in account with the row (for M11), and refuses ended events', async () => {
    const { api, calls } = backend({ attendance_set: () => null });
    const res = await api(
      post(
        'attendance/set',
        { deviceId: 'device-123', eventId: 'old', kind: 'going', on: true },
        { authorization: 'Bearer user-token' },
      ),
    );
    expect(res.status).toBe(404);
    expect(calls.find((c) => c.name === 'attendance_set')!.args.p_user).toBe('u1');
  });

  it('makes a random share token per link, only for public events', async () => {
    const tokens: string[] = [];
    const { api } = backend({
      share_link_create: (a) => {
        tokens.push(a.p_token as string);
        return a.p_event === 'e1';
      },
    });
    const a = await (await api(post('share', { deviceId: 'device-123', eventId: 'e1' }))).json();
    const b = await (await api(post('share', { deviceId: 'device-123', eventId: 'e1' }))).json();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.token).not.toBe(b.token);
    expect((await api(post('share', { deviceId: 'device-123', eventId: 'hidden' }))).status).toBe(
      404,
    );
  });

  it('answers only POST on its own paths', async () => {
    const { api } = backend({});
    expect((await api(new Request('https://happow.example/api/attendance'))).status).toBe(404);
    expect((await api(post('attendance/other', {}))).status).toBe(404);
  });
});
