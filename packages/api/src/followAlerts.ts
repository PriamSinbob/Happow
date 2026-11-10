import appJson from '../../../config/app.json';
import type { AppConfig } from '@happow/core';
import { emailSender, type EmailSender } from './email.js';
import { cachedKey } from './reminders.js';
import type { ScheduleEnv } from './schedule.js';
import { NO_DATABASE, serviceDb } from './supabase.js';
import { sendPush, type PushOutcome } from './webpush.js';

/**
 * New-date alerts for followed artists. Each cron tick: make alerts for public
 * events first stored since the follow and the switch-on (follow_alerts_queue), then send a few
 * by web push to the account's subscribed devices (Workers Free CPU, as reminders). An alert with
 * nowhere to go is marked done and never retried.
 */

export interface DueAlert {
  id: number;
  eventId: string;
  title: string;
  venue: string | null;
  performer: string;
  startAt: string;
  timezone: string;
  hidden: boolean;
  status: string;
  /** The account's address when it asked for alerts by email. */
  email?: string | null;
  locale?: string;
  subscriptions: { endpoint: string; p256dh: string; auth: string; lang: string }[];
}

const TEXT = {
  pl: (who: string) => `Nowy termin: ${who}`,
  en: (who: string) => `New date: ${who}`,
} as const;

/** "New date: Dawid Podsiadło" · "Sat 14 Nov, 20:00 · Hala Stulecia"; tapping opens the event. */
export function alertMessage(a: DueAlert, lang: string) {
  const en = lang === 'en';
  const when = new Intl.DateTimeFormat(en ? 'en-GB' : 'pl-PL', {
    timeZone: a.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(a.startAt));
  return {
    title: (en ? TEXT.en : TEXT.pl)(a.performer),
    body: [a.title !== a.performer ? a.title : null, when, a.venue].filter(Boolean).join(' · '),
    url: `/e/${encodeURIComponent(a.eventId)}`,
    tag: `follow:${a.eventId}`,
  };
}

export interface AlertTickResult {
  queued: number;
  due: number;
  sent: number;
  gone: number;
  failed: number;
  reason?: string;
}

export interface AlertTickDeps {
  fetch?: typeof fetch;
  app?: Pick<typeof appJson, 'push' | 'follows' | 'legal' | 'site' | 'email'>;
  /** Instead of the sender named in config. */
  email?: EmailSender | null;
}

/** The same alert as an email: the push text, the link, and how to stop. */
export function alertEmail(a: DueAlert, siteUrl: string) {
  const lang = a.locale === 'en' ? 'en' : 'pl';
  const m = alertMessage(a, lang);
  const stop =
    lang === 'en'
      ? 'You get this because you follow this artist and asked for new dates by email. Switch it off in Happow: list → ♡ → alerts.'
      : 'Dostajesz tę wiadomość, bo obserwujesz tego artystę i prosisz o nowe terminy e-mailem. Wyłączysz to w Happow: lista → ♡ → powiadomienia.';
  return { subject: m.title, text: `${m.body}\n\n${siteUrl}${m.url}\n\n${stop}\n` };
}

export async function sendFollowAlerts(
  env: ScheduleEnv,
  now: Date,
  deps: AlertTickDeps = {},
): Promise<AlertTickResult> {
  const app = deps.app ?? appJson;
  const none = { queued: 0, due: 0, sent: 0, gone: 0, failed: 0 };
  const db = serviceDb(env, deps.fetch);
  if (!db) return { ...none, reason: NO_DATABASE };
  const secret = env[app.push.secret];
  if (typeof secret !== 'string' || !secret)
    return { ...none, reason: `${app.push.secret} not set` };
  const mail =
    deps.email !== undefined
      ? deps.email
      : emailSender(app.email as AppConfig['email'], env, deps.fetch);
  const queued = await db.rpc<number>('follow_alerts_queue', {
    p_lookback_hours: app.follows.alerts.lookbackHours,
  });
  const due = await db.rpc<DueAlert[]>('follow_alerts_due', {
    p_limit: app.follows.alerts.maxPerTick,
  });
  if (!due.length) return { ...none, queued };
  const key = await cachedKey(secret);
  const subject = app.legal.contactEmail ? `mailto:${app.legal.contactEmail}` : app.site.url;
  const done: number[] = [];
  const sentTo: string[] = [];
  const gone: string[] = [];
  let failed = 0;
  for (const a of due) {
    const byEmail = !!(a.email && mail);
    if (a.hidden || a.status === 'cancelled' || (!a.subscriptions.length && !byEmail)) {
      done.push(a.id);
      continue;
    }
    let emailed = false;
    if (byEmail) {
      try {
        const m = alertEmail(a, app.site.url);
        await mail!.send({ to: a.email!, subject: m.subject, text: m.text });
        emailed = true;
      } catch {
        failed++;
      }
    }
    const outcomes = await Promise.all(
      a.subscriptions.map(async (s): Promise<[string, PushOutcome]> => {
        try {
          return [
            s.endpoint,
            await sendPush(s, alertMessage(a, s.lang), key, {
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
    if (emailed || outcomes.some(([, o]) => o !== 'failed')) done.push(a.id);
  }
  await db.rpc('follow_alerts_done', {
    p_ids: done,
    p_sent_endpoints: sentTo,
    p_gone_endpoints: gone,
  });
  return { queued, due: due.length, sent: sentTo.length, gone: gone.length, failed };
}
