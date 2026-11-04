import { useSyncExternalStore } from 'react';
import { api, deviceId } from './api';
import { accessToken } from './auth';
import { isIosBrowser } from './components/InstallHint';
import { config } from './config';
import { plans } from './plans';
import { storage } from './storage';

/**
 * Reminders on this device (M10 §4, §5): web push from the installed app. Permission is asked
 * only when someone sets their first reminder. The server keeps the reminders and sends them; this
 * device keeps a copy (event id → lead) so the bell shows at once.
 */

const { reminders: cfg } = config.app;
const KEY = 'reminders';
const LEAD = 'reminderLead';
const ENDPOINT = 'pushEndpoint';

export type PushSupport =
  /** Push works here. */
  | 'ok'
  /** iPhone or iPad in Safari: works from the Home Screen only. */
  | 'install'
  /** Notifications are blocked for this site. */
  | 'blocked'
  /** No web push in this browser. */
  | 'none';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'none';
  if (isIosBrowser()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'none';
  return Notification.permission === 'denied' ? 'blocked' : 'ok';
}

function load(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(storage.get(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let map = load();
const listeners = new Set<() => void>();
function commit(next: Record<string, string>) {
  map = next;
  storage.set(KEY, JSON.stringify(map));
  for (const l of listeners) l();
}

const token = () => accessToken().catch(() => null);

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Asks for permission (once), subscribes this browser and tells the server. Throws 'denied' when
 * the person says no, 'unavailable' when push can't work here.
 */
export async function ensurePush(lang: string): Promise<void> {
  if (pushSupport() !== 'ok') throw new Error('unavailable');
  if (
    Notification.permission !== 'granted' &&
    (await Notification.requestPermission()) !== 'granted'
  )
    throw new Error('denied');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api<{ key: string }>('push/key');
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(key),
    });
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const known = `${json.endpoint} ${lang}`;
  if (storage.get(ENDPOINT) === known) return;
  await api('push/subscribe', {
    token: await token(),
    body: { deviceId: deviceId(), subscription: json, lang },
  });
  storage.set(ENDPOINT, known);
}

export const reminders = {
  get: (id: string): string | null => map[id] ?? null,
  /** The lead the bell offers first: the last one chosen, else config (60 minutes). */
  defaultLead: (): string => {
    const last = storage.get(LEAD);
    if (last && cfg.leads.includes(last)) return last;
    return cfg.leads.includes(cfg.defaultLead) ? cfg.defaultLead : cfg.leads[0]!;
  },
  /** Sets or (null) removes a reminder; push is set up first when needed. */
  set: async (id: string, lead: string | null, lang: string): Promise<void> => {
    if (lead) {
      await ensurePush(lang);
      storage.set(LEAD, lead);
    }
    await api('reminders', {
      token: await token(),
      body: { deviceId: deviceId(), eventId: id, lead },
    });
    const next = { ...map };
    if (lead) next[id] = lead;
    else delete next[id];
    commit(next);
  },
  /** The server's pending reminders (sent ones drop off; the account's other devices add). */
  refresh: async (): Promise<void> => {
    if (!storage.get(ENDPOINT) && !Object.keys(map).length) return;
    const res = await api<{ reminders: Record<string, string> }>('reminders/list', {
      token: await token(),
      body: { deviceId: deviceId() },
    });
    commit(res.reminders);
  },
  /**
   * After a sign-in or out, or a language change: tells the server again, so reminders reach the
   * account's devices and arrive in the right language. Only where permission was given already.
   */
  relink: async (lang: string): Promise<void> => {
    if (!storage.get(ENDPOINT) || pushSupport() !== 'ok' || Notification.permission !== 'granted')
      return;
    storage.set(ENDPOINT, '');
    await ensurePush(lang);
  },
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Tests. */
  reset: (next: Record<string, string> = {}) => commit(next),
};

const snapshot = () => map;
export function useReminders(): Record<string, string> {
  return useSyncExternalStore(reminders.subscribe, snapshot, snapshot);
}

// Removing an event from your plans removes its reminder (§5).
plans.subscribe(() => {
  const drop = Object.keys(map).filter((id) => !plans.isSaved(id));
  if (!drop.length) return;
  commit(Object.fromEntries(Object.entries(map).filter(([id]) => !drop.includes(id))));
  for (const id of drop)
    void token()
      .then((t) =>
        api('reminders', { token: t, body: { deviceId: deviceId(), eventId: id, lead: null } }),
      )
      .catch(() => {
        /* offline: the next refresh shows it again, and the next change tries again */
      });
});
