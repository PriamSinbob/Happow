import appJson from '../../../config/app.json';
import { cachedKey } from './reminders.js';
import type { ScheduleEnv } from './schedule.js';
import { Supabase } from './supabase.js';
import { sendPush, type PushOutcome } from './webpush.js';

/**
 * Push notices to everyone interested in an event (M11 §7, owner 2026-11-04): an organiser's
 * schedule change or important post, and a private event's change or cancellation. The audience
 * is fixed when the notice is made (notice_enqueue: devices that allowed notifications and set a
 * reminder, marked going / on the way / here, saved it on a synced account, or accepted an
 * invitation). A few go out with the request; the Cron Trigger sends the rest, a few per tick
 * (Workers Free CPU, as reminders).
 */

export type NoticeKind = 'schedule' | 'important' | 'cancelled';

interface DueNotice {
  id: number;
  eventId: string;
  kind: NoticeKind;
  body: string;
  title: string;
  status: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: string;
}

const LABEL = {
  pl: { schedule: 'Zmiana', important: 'Ważne', cancelled: 'Odwołane' },
  en: { schedule: 'Changed', important: 'Important', cancelled: 'Cancelled' },
} as const;

/** What a notice says: "Ważne: Koncert" and the organiser's words; tapping opens the event. */
export function noticeMessage(
  n: Pick<DueNotice, 'eventId' | 'kind' | 'body' | 'title'>,
  lang: string,
) {
  const l = LABEL[lang === 'en' ? 'en' : 'pl'];
  return {
    title: `${l[n.kind]}: ${n.title}`,
    body: n.body,
    url: `/e/${encodeURIComponent(n.eventId)}`,
    tag: `notice:${n.eventId}`,
  };
}

export interface NoticeSendResult {
  sent: number;
  gone: number;
  failed: number;
  reason?: string;
}

interface App {
  push: { secret: string; ttlSeconds: number };
  notices: { maxPerTick: number };
  legal: { contactEmail: string | null };
}

/** Sends up to `max` queued notices (one event's only, when given). */
export async function sendNotices(
  db: Supabase,
  secret: string | undefined,
  app: App,
  now: Date,
  max: number,
  eventId: string | null = null,
  fetchImpl?: typeof fetch,
): Promise<NoticeSendResult> {
  const none = { sent: 0, gone: 0, failed: 0 };
  if (!secret) return { ...none, reason: `${app.push.secret} not set` };
  if (max <= 0) return none;
  const due = await db.rpc<DueNotice[]>('notices_due', { p_limit: max, p_event: eventId });
  if (!due.length) return none;
  const key = await cachedKey(secret);
  const subject = app.legal.contactEmail
    ? `mailto:${app.legal.contactEmail}`
    : 'https://happow.app';
  const done: number[] = [];
  const gone: string[] = [];
  let sent = 0;
  let failed = 0;
  await Promise.all(
    due.map(async (n) => {
      let o: PushOutcome;
      try {
        o = await sendPush(n, noticeMessage(n, n.lang), key, {
          subject,
          ttlSeconds: app.push.ttlSeconds,
          now,
          fetch: fetchImpl,
        });
      } catch {
        o = 'failed';
      }
      // A failed one is dropped rather than retried forever: a notice is about now.
      done.push(n.id);
      if (o === 'sent') sent++;
      else if (o === 'gone') gone.push(n.endpoint);
      else failed++;
    }),
  );
  await db.rpc('notices_done', { p_ids: done, p_gone_endpoints: gone });
  return { sent, gone: gone.length, failed };
}

/** Cron Trigger: queued notices, and the private events' retention (M11 §9). */
export async function sendDueNotices(
  env: ScheduleEnv,
  now: Date,
  deps: { fetch?: typeof fetch; app?: App & { private: { keepAfterEndDays: number } } } = {},
): Promise<NoticeSendResult & { cleaned?: number }> {
  const app = deps.app ?? appJson;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    return {
      sent: 0,
      gone: 0,
      failed: 0,
      reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set',
    };
  const db = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, deps.fetch);
  const cleaned = await db.rpc<number>('private_cleanup', {
    p_keep_days: app.private.keepAfterEndDays,
  });
  const secret = env[app.push.secret];
  const r = await sendNotices(
    db,
    typeof secret === 'string' && secret ? secret : undefined,
    app,
    now,
    app.notices.maxPerTick,
    null,
    deps.fetch,
  );
  return { ...r, cleaned };
}
