import { describe, expect, it } from 'vitest';
import { createApi } from '../src';
import { config, env, fail, organiserRpc, req, submitRpc, supabase, type Rpc } from './helpers';

/** A weekly repeat stored as one submission and one event per date. */

const now = () => new Date('2026-10-29T22:30:00Z');

function backend(rpc: Record<string, Rpc>) {
  const sb = supabase({ ...submitRpc, ...organiserRpc, ...rpc });
  return { ...sb, api: createApi(env, { config, fetch: sb.fetch, now, extractor: null }) };
}

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

describe('POST /api/submissions with a weekly repeat', () => {
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

describe('moderating a series', () => {
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
