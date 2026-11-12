import { describe, expect, it } from 'vitest';
import { attendanceBucket } from '@happow/core';
import { createApi } from '../src';
import { config, env, req, supabase, type Rpc } from './helpers';

/** "I'm going" and share links. */

const now = () => new Date('2026-10-30T12:00:00Z');

function backend(rpc: Record<string, Rpc>) {
  const sb = supabase(rpc);
  return { ...sb, api: createApi(env, { fetch: sb.fetch, now, config }) };
}

const raw = (going: number, over: object = {}) => ({
  categories: ['music'],
  counts: { going, looking: 2 },
  mine: ['going'],
  fromMyLinks: 3,
  ...over,
});

describe('attendance counts', () => {
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
    const { api, calls } = backend({ attendance_get: () => ({ body: raw(12) }) });
    const res = await api(req('attendance', { body: { deviceId: 'device-123', eventId: 'e1' } }));
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
      attendance_get: () => ({
        body: raw(40, { categories: ['religious'], counts: { going: 40, here: 30 } }),
      }),
    });
    const body = await (
      await api(req('attendance', { body: { deviceId: 'device-123', eventId: 'e1' } }))
    ).json();
    expect(body.counts).toEqual({ going: null, looking: null, onway: null, here: null });
    expect(body.fromMyLinks).toBeNull();
    // The person still sees their own mark.
    expect(body.mine.going).toBe(true);
  });

  it('marks going with the link it came from, keeps it till a day after, and limits the rate', async () => {
    const { api, calls } = backend({ attendance_set: () => ({ body: raw(5) }) });
    const res = await api(
      req('attendance/set', {
        body: {
          deviceId: 'device-123',
          eventId: 'e1',
          kind: 'going',
          on: true,
          token: 'tok-abcdefgh',
        },
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

  it('keeps the signed-in account with the row, and refuses ended events', async () => {
    const { api, calls } = backend({ attendance_set: () => ({ body: null }) });
    const res = await api(
      req('attendance/set', {
        token: 'user-token',
        body: { deviceId: 'device-123', eventId: 'old', kind: 'going', on: true },
      }),
    );
    expect(res.status).toBe(404);
    expect(calls.find((c) => c.name === 'attendance_set')!.args.p_user).toBe('u1');
  });

  it('makes a random share token per link, only for public events', async () => {
    const tokens: string[] = [];
    const { api } = backend({
      share_link_create: (a) => {
        tokens.push(a.p_token as string);
        return { body: a.p_event === 'e1' };
      },
    });
    const body = { deviceId: 'device-123', eventId: 'e1' };
    const a = await (await api(req('share', { body }))).json();
    const b = await (await api(req('share', { body }))).json();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.token).not.toBe(b.token);
    expect(
      (await api(req('share', { body: { deviceId: 'device-123', eventId: 'hidden' } }))).status,
    ).toBe(404);
  });
});
