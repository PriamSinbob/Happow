import { createECDH, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../src';
import { reminderMessage, sendDueReminders, type DueReminder } from '../src/reminders';
import { b64url, fromB64url } from '../src/webpush';
import { config, env, req, SB, submitRpc, supabase, type Rpc } from './helpers';

/** Push subscriptions, reminders and the cron that sends them. */

const jwk = JSON.stringify(
  generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }),
);
const now = () => new Date('2026-10-29T22:30:00Z');

function backend(rpc: Record<string, Rpc>, e: Record<string, string> = env) {
  const sb = supabase({ ...submitRpc, ...rpc });
  return { ...sb, api: createApi(e, { config, fetch: sb.fetch, now, extractor: null }) };
}

const withKey = { ...env, VAPID_PRIVATE_KEY: jwk };
const ua = createECDH('prime256v1');
ua.generateKeys();
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(new Uint8Array(16).fill(7)) },
};

describe('push subscriptions', () => {
  it('serves the public key worked out from the secret, or 503 without it', async () => {
    const res = await backend({}, withKey).api(req('push/key'));
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    expect(fromB64url(key)).toHaveLength(65);
    expect((await backend({}).api(req('push/key'))).status).toBe(503);
  });

  it('stores a subscription under the hashed device, with the account when signed in', async () => {
    const b = backend({ push_subscribe: () => ({ body: null }) }, withKey);
    const res = await b.api(
      req('push/subscribe', {
        token: 'user-token',
        body: { deviceId: 'device-123456', subscription, lang: 'en' },
      }),
    );
    expect(res.status).toBe(200);
    const args = b.call('push_subscribe')[0]!.args;
    expect(args).toMatchObject({ p_user: 'u1', p_endpoint: subscription.endpoint, p_lang: 'en' });
    expect(args.p_device).toMatch(/^[0-9a-f]{64}$/);
    // Plain http endpoints are refused.
    const bad = await b.api(
      req('push/subscribe', {
        body: {
          deviceId: 'device-123456',
          subscription: { ...subscription, endpoint: 'http://x.example/1' },
          lang: 'pl',
        },
      }),
    );
    expect(bad.status).toBe(400);
  });
});

describe('reminders', () => {
  it('sets one with a configured lead, and refuses a lead not in config', async () => {
    const b = backend({ reminder_set: () => ({ body: true }) });
    const ok = await b.api(
      req('reminders', { body: { deviceId: 'device-123456', eventId: 'tm:1', lead: '60' } }),
    );
    expect(ok.status).toBe(200);
    expect(b.call('reminder_set')[0]!.args).toMatchObject({
      p_user: null,
      p_event: 'tm:1',
      p_lead: '60',
      p_max: config.app.reminders.maxPerDevice,
    });
    const bad = await b.api(
      req('reminders', { body: { deviceId: 'device-123456', eventId: 'tm:1', lead: '7' } }),
    );
    expect(bad.status).toBe(400);
  });

  it('says why when the database refuses, and removes with lead null', async () => {
    const b = backend({ reminder_set: (a) => ({ body: a.p_lead === null }) });
    const refused = await b.api(
      req('reminders', { body: { deviceId: 'device-123456', eventId: 'tm:1', lead: '15' } }),
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'reminder_refused' });
    const off = await b.api(
      req('reminders', { body: { deviceId: 'device-123456', eventId: 'tm:1', lead: null } }),
    );
    expect(off.status).toBe(200);
  });

  it('lists the pending ones', async () => {
    const b = backend({ reminders_list: () => ({ body: { 'tm:1': '60' } }) });
    const res = await b.api(req('reminders/list', { body: { deviceId: 'device-123456' } }));
    expect(await res.json()).toEqual({ reminders: { 'tm:1': '60' } });
  });
});

const due = (over: Partial<DueReminder> = {}): DueReminder => ({
  id: 1,
  eventId: 'tm:1',
  title: 'Koncert',
  venue: 'Klub',
  startAt: '2026-11-06T18:12:00Z',
  setStartAt: '2026-11-06T18:12:00Z',
  timezone: 'Europe/Warsaw',
  status: 'scheduled',
  hidden: false,
  subscriptions: [],
  ...over,
});
const NOW = new Date('2026-11-06T17:00:00Z');

describe('what a reminder says', () => {
  it('the real time left, the venue and the link', () => {
    expect(reminderMessage(due(), 'en', NOW)).toEqual({
      title: 'Koncert',
      body: 'Starting in 72 min · Klub',
      url: '/e/tm%3A1',
      tag: 'reminder:tm:1',
    });
    expect(reminderMessage(due(), 'pl', NOW).body).toBe('Za 72 min · Klub');
  });

  it('the evening before, a moved start and a cancellation', () => {
    const next = due({ startAt: '2026-11-07T18:00:00Z', setStartAt: '2026-11-07T18:00:00Z' });
    expect(reminderMessage(next, 'en', NOW).body).toBe('Tomorrow at 19:00 · Klub');
    const moved = due({ setStartAt: '2026-11-06T19:00:00Z' });
    expect(reminderMessage(moved, 'en', NOW).body).toBe(
      'Time changed: now 19:12 · Starting in 72 min · Klub',
    );
    const off = reminderMessage(due({ status: 'cancelled' }), 'pl', NOW);
    expect(off.title).toBe('Odwołane: Koncert');
  });
});

describe('the cron tick', () => {
  const sub = (endpoint: string) => ({
    endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    lang: 'pl',
  });

  function tick(rows: DueReminder[], pushStatus: Record<string, number>) {
    const rpc: { name: string; args: Record<string, unknown> }[] = [];
    const pushed: string[] = [];
    const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
        const name = url.slice(`${SB}/rest/v1/rpc/`.length);
        rpc.push({ name, args: JSON.parse(String(init.body)) });
        return Response.json(name === 'reminders_due' ? rows : null);
      }
      pushed.push(url);
      return new Response(null, { status: pushStatus[url] ?? 201 });
    });
    return { f: f as typeof fetch, rpc, pushed };
  }

  it('sends what is due, deletes gone subscriptions, retries ones that failed', async () => {
    const t = tick(
      [
        due({
          id: 1,
          subscriptions: [sub('https://push.example/a'), sub('https://push.example/gone')],
        }),
        due({ id: 2, eventId: 'tm:2', subscriptions: [sub('https://push.example/down')] }),
        due({
          id: 3,
          eventId: 'tm:3',
          hidden: true,
          subscriptions: [sub('https://push.example/a')],
        }),
        due({ id: 4, eventId: 'tm:4' }),
      ],
      { 'https://push.example/gone': 410, 'https://push.example/down': 503 },
    );
    const result = await sendDueReminders(
      { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'k', VAPID_PRIVATE_KEY: jwk },
      NOW,
      { fetch: t.f },
    );
    expect(result).toEqual({ due: 4, sent: 1, gone: 1, failed: 1 });
    expect(t.rpc[0]).toMatchObject({
      name: 'reminders_due',
      args: { p_until: '2026-11-06T17:15:00.000Z', p_day_before: '18:00' },
    });
    // The hidden one and the one with nowhere to go are done without a push.
    expect(t.pushed.sort()).toEqual([
      'https://push.example/a',
      'https://push.example/down',
      'https://push.example/gone',
    ]);
    expect(t.rpc[1]).toEqual({
      name: 'reminders_done',
      args: {
        p_ids: [1, 3, 4],
        p_sent_endpoints: ['https://push.example/a'],
        p_gone_endpoints: ['https://push.example/gone'],
      },
    });
  });

  it('does nothing without the key, and makes no push calls when nothing is due', async () => {
    const t = tick([], {});
    expect(
      await sendDueReminders({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'k' }, NOW, {
        fetch: t.f,
      }),
    ).toMatchObject({ due: 0, reason: 'VAPID_PRIVATE_KEY not set' });
    expect(t.rpc).toEqual([]);
    const r = await sendDueReminders(
      { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'k', VAPID_PRIVATE_KEY: jwk },
      NOW,
      { fetch: t.f },
    );
    expect(r).toEqual({ due: 0, sent: 0, gone: 0, failed: 0 });
    expect(t.rpc.map((c) => c.name)).toEqual(['reminders_due']);
  });
});
