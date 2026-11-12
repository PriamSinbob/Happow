import appJson from '../../../config/app.json';
import { cachedKey } from './reminders.js';
import type { ScheduleEnv } from './schedule.js';
import { Supabase, NO_DATABASE, serviceDb } from './supabase.js';
import { sendPush, type PushOutcome } from './webpush.js';

/**
 * Push notices to everyone interested in an event: an organiser's
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
function noticeMessage(n: Pick<DueNotice, 'eventId' | 'kind' | 'body' | 'title'>, lang: string) {
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
  site: { url: string };
}

/**
 * Queues a notice for everyone interested in an event (but `except`, who caused it) and sends
 * the first few now; the cron sends the rest. Returns how many were queued. Never throws: a
 * notice that fails must not undo what it follows.
 */
export async function announce(
  db: Supabase,
  secret: string | undefined,
  app: App & { notices: { maxAudience: number; inline: number; maxPerTick: number } },
  now: Date,
  notice: { event: string; kind: NoticeKind; body: string; except: string },
  fetchImpl?: typeof fetch,
): Promise<number> {
  try {
    const queued = await db.rpc<number>('notice_enqueue', {
      p_event: notice.event,
      p_kind: notice.kind,
      p_body: notice.body.slice(0, 200),
      p_except: notice.except,
      p_max: app.notices.maxAudience,
    });
    if (queued)
      await sendNotices(db, secret, app, now, app.notices.inline, notice.event, fetchImpl);
    return queued;
  } catch (err) {
    console.error(JSON.stringify({ notice: notice.event, error: String(err) }));
    return 0;
  }
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
  const subject = app.legal.contactEmail ? `mailto:${app.legal.contactEmail}` : app.site.url;
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

/** Cron Trigger: queued notices, and the private events' retention. */
export async function sendDueNotices(
  env: ScheduleEnv,
  now: Date,
  deps: {
    fetch?: typeof fetch;
    app?: App & {
      private: { keepAfterEndDays: number };
      auth: { pending: { keepDays: number; cleanupPerTick: number } };
    };
  } = {},
): Promise<NoticeSendResult & { cleaned?: number; expired?: number }> {
  const app = deps.app ?? appJson;
  const db = serviceDb(env, deps.fetch);
  if (!db)
    return {
      sent: 0,
      gone: 0,
      failed: 0,
      reason: NO_DATABASE,
    };
  const cleaned = await db.rpc<number>('private_cleanup', {
    p_keep_days: app.private.keepAfterEndDays,
  });
  // Accounts that waited for a code nobody typed: gone after `auth.pending.keepDays`.
  let expired = 0;
  try {
    const ids = await db.rpc<string[]>('pending_expired', {
      p_keep_days: app.auth.pending.keepDays,
      p_limit: app.auth.pending.cleanupPerTick,
    });
    for (const id of ids ?? []) {
      await db.deleteUser(id);
      expired++;
    }
  } catch (err) {
    console.error(JSON.stringify({ pending: 'cleanup', error: String(err) }));
  }
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
  return { ...r, cleaned, expired };
}
