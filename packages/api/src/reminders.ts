import type { HappowConfig } from '@happow/core';
import { z } from 'zod';
import appJson from '../../../config/app.json';
import { ApiError, body, json, sha256 } from './http.js';
import type { ScheduleEnv } from './schedule.js';
import { Supabase } from './supabase.js';
import { sendPush, vapidKey, type PushOutcome, type VapidKey } from './webpush.js';

/**
 * Web push and reminders (M10 §4, §5). A device subscribes with its push endpoint (anonymous: its
 * salted hash, as for "I'm going"); a reminder is one event and a lead time. The Worker's Cron
 * Trigger sends what's due before the next tick. With an account, a reminder reaches all of the
 * account's subscribed devices. No account is needed (owner, 2026-11-04).
 */

export interface ReminderDeps {
  config: HappowConfig;
  need: () => { db: Supabase; salt: string };
  limit: (bucket: string, actor: string, windowSeconds: number, max: number) => Promise<void>;
  userOf: (req: Request) => Promise<{ id: string } | null>;
  /** The VAPID private key (the secret named by push.secret), or undefined when not set. */
  pushSecret: string | undefined;
}

const deviceId = z.string().min(8).max(100);
const b64 = z.string().regex(/^[A-Za-z0-9_-]+=*$/);
const subscribeSchema = z.object({
  deviceId,
  subscription: z.object({
    endpoint: z.string().url().max(1000).startsWith('https://'),
    keys: z.object({ p256dh: b64.min(40).max(200), auth: b64.min(10).max(100) }),
  }),
  lang: z.string().min(2).max(5),
});
const unsubscribeSchema = z.object({ deviceId, endpoint: z.string().max(1000) });
const listSchema = z.object({ deviceId });

let keyCache: { secret: string; key: Promise<VapidKey> } | null = null;
export function cachedKey(secret: string): Promise<VapidKey> {
  if (keyCache?.secret !== secret) keyCache = { secret, key: vapidKey(secret) };
  return keyCache.key;
}

export function reminderRoutes({ config, need, limit, userOf, pushSecret }: ReminderDeps) {
  const cfg = config.app.reminders;
  const langs = new Set<string>(config.app.languages);
  const setSchema = z.object({
    deviceId,
    eventId: z.string().min(1).max(300),
    lead: z
      .string()
      .refine((l) => cfg.leads.includes(l))
      .nullable(),
  });
  const device = (salt: string, id: string) => sha256(`${salt}:device:${id}`);

  /** GET /api/push/key: the applicationServerKey; 503 until the secret is set. */
  async function key(): Promise<Response> {
    if (!pushSecret) throw new ApiError(503, 'not_configured');
    return json({ key: (await cachedKey(pushSecret)).publicKey }, 200, {
      'cache-control': 'public, max-age=3600',
    });
  }

  /** POST /api/push/subscribe and /api/push/unsubscribe. */
  async function push(req: Request, path: string[]): Promise<Response> {
    if (req.method === 'GET' && path.join('/') === 'key') return key();
    if (req.method !== 'POST' || path.length !== 1) throw new ApiError(404, 'not_found');
    const { db, salt } = need();
    if (path[0] === 'subscribe') {
      const input = await body(req, subscribeSchema);
      const hash = await device(salt, input.deviceId);
      await limit('push', hash, 3600, config.app.push.subscribePerHourPerDevice);
      const user = await userOf(req);
      await db.rpc('push_subscribe', {
        p_device: hash,
        p_user: user?.id ?? null,
        p_endpoint: input.subscription.endpoint,
        p_p256dh: input.subscription.keys.p256dh,
        p_auth: input.subscription.keys.auth,
        p_lang: langs.has(input.lang) ? input.lang : config.app.languages[0],
      });
      return json({ ok: true });
    }
    if (path[0] === 'unsubscribe') {
      const input = await body(req, unsubscribeSchema);
      await db.rpc('push_unsubscribe', {
        p_device: await device(salt, input.deviceId),
        p_endpoint: input.endpoint,
      });
      return json({ ok: true });
    }
    throw new ApiError(404, 'not_found');
  }

  /** POST /api/reminders {deviceId, eventId, lead | null}, POST /api/reminders/list {deviceId}. */
  async function reminders(req: Request, path: string[]): Promise<Response> {
    if (req.method !== 'POST') throw new ApiError(404, 'not_found');
    const { db, salt } = need();
    const user = await userOf(req);
    if (path.join('/') === 'list') {
      const input = await body(req, listSchema);
      const list = await db.rpc<Record<string, string>>('reminders_list', {
        p_device: await device(salt, input.deviceId),
        p_user: user?.id ?? null,
      });
      return json({ reminders: list }, 200, { 'cache-control': 'private, no-store' });
    }
    if (path.length) throw new ApiError(404, 'not_found');
    const input = await body(req, setSchema);
    const hash = await device(salt, input.deviceId);
    await limit('reminders', hash, 3600, cfg.perHourPerDevice);
    const ok = await db.rpc<boolean>('reminder_set', {
      p_device: hash,
      p_user: user?.id ?? null,
      p_event: input.eventId,
      p_lead: input.lead,
      p_max: cfg.maxPerDevice,
    });
    // The event has started or isn't listed, or the device has the most reminders already.
    if (!ok) throw new ApiError(409, 'reminder_refused', undefined, { max: cfg.maxPerDevice });
    return json({ ok: true });
  }

  return { push, reminders };
}

/** The notification texts, in the subscription's language. */
const TEXT = {
  pl: {
    startsIn: (m: number) => `Za ${m} min`,
    startsAt: (t: string) => `Dziś o ${t}`,
    tomorrowAt: (t: string) => `Jutro o ${t}`,
    changed: (t: string) => `Zmiana godziny: teraz ${t}`,
    cancelled: 'Odwołane',
  },
  en: {
    startsIn: (m: number) => `Starting in ${m} min`,
    startsAt: (t: string) => `Today at ${t}`,
    tomorrowAt: (t: string) => `Tomorrow at ${t}`,
    changed: (t: string) => `Time changed: now ${t}`,
    cancelled: 'Cancelled',
  },
} as const;

export interface DueReminder {
  id: number;
  eventId: string;
  title: string;
  venue: string | null;
  startAt: string;
  setStartAt: string;
  timezone: string;
  status: string;
  hidden: boolean;
  subscriptions: { endpoint: string; p256dh: string; auth: string; lang: string }[];
}

/**
 * What a reminder says (§5): the real time left when it's sent (owner, 2026-11-04), not the lead
 * chosen; "Time changed" when the start moved since it was set; "Cancelled" for a cancelled one.
 */
export function reminderMessage(r: DueReminder, lang: string, now: Date) {
  const t = TEXT[lang === 'en' ? 'en' : 'pl'];
  const start = new Date(r.startAt);
  const time = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'pl-PL', {
    timeZone: r.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: r.timezone, dateStyle: 'short' }).format(d);
  const minutes = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60_000));
  const when =
    minutes <= 180
      ? t.startsIn(minutes)
      : day(start) === day(now)
        ? t.startsAt(time)
        : t.tomorrowAt(time);
  const moved = Math.abs(start.getTime() - new Date(r.setStartAt).getTime()) >= 60_000;
  const lead =
    r.status === 'cancelled' ? t.cancelled : moved ? `${t.changed(time)} · ${when}` : when;
  return {
    title: r.status === 'cancelled' ? `${t.cancelled}: ${r.title}` : r.title,
    body: [lead, r.venue].filter(Boolean).join(' · '),
    url: `/e/${encodeURIComponent(r.eventId)}`,
    tag: `reminder:${r.eventId}`,
  };
}

export interface ReminderTickResult {
  due: number;
  sent: number;
  gone: number;
  failed: number;
  reason?: string;
}

export interface ReminderTickDeps {
  fetch?: typeof fetch;
  app?: Pick<typeof appJson, 'push' | 'reminders' | 'legal' | 'site'>;
}

/**
 * Cron Trigger → reminders due before the next tick (§5). Read straight from the JSON, like the
 * ingest schedule. A reminder whose sending failed everywhere stays due and is tried next tick.
 */
export async function sendDueReminders(
  env: ScheduleEnv,
  now: Date,
  deps: ReminderTickDeps = {},
): Promise<ReminderTickResult> {
  const app = deps.app ?? appJson;
  const none = { due: 0, sent: 0, gone: 0, failed: 0 };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    return { ...none, reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' };
  const secret = env[app.push.secret];
  if (typeof secret !== 'string' || !secret)
    return { ...none, reason: `${app.push.secret} not set` };
  const db = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, deps.fetch);
  const until = new Date(now.getTime() + app.reminders.cronMinutes * 60_000);
  const due = await db.rpc<DueReminder[]>('reminders_due', {
    p_until: until.toISOString(),
    p_day_before: app.reminders.dayBeforeAt,
    p_limit: app.reminders.maxPerTick,
  });
  if (!due.length) return none;
  const key = await cachedKey(secret);
  const subject = app.legal.contactEmail
    ? `mailto:${app.legal.contactEmail}`
    : app.site.url;
  const done: number[] = [];
  const sentTo: string[] = [];
  const gone: string[] = [];
  let failed = 0;
  for (const r of due) {
    // Hidden by moderation, or nowhere to send: nothing goes, and it isn't tried again.
    if (r.hidden || !r.subscriptions.length) {
      done.push(r.id);
      continue;
    }
    const outcomes = await Promise.all(
      r.subscriptions.map(async (s): Promise<[string, PushOutcome]> => {
        try {
          return [
            s.endpoint,
            await sendPush(s, reminderMessage(r, s.lang, now), key, {
              subject,
              ttlSeconds: app.push.ttlSeconds,
              now,
              fetch: deps.fetch,
            }),
          ];
        } catch {
          return [s.endpoint, 'failed'];
        }
      }),
    );
    for (const [endpoint, o] of outcomes) {
      if (o === 'sent') sentTo.push(endpoint);
      else if (o === 'gone') gone.push(endpoint);
      else failed++;
    }
    if (outcomes.some(([, o]) => o !== 'failed')) done.push(r.id);
  }
  await db.rpc('reminders_done', {
    p_ids: done,
    p_sent_endpoints: sentTo,
    p_gone_endpoints: gone,
  });
  return { due: due.length, sent: sentTo.length, gone: gone.length, failed };
}
