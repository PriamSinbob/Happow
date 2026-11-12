import { useEffect, useSyncExternalStore } from 'react';
import type { EventPost, EventUpdates } from '@happow/core';
import { api } from './api';
import { config } from './config';
import { storage } from './storage';

/**
 * News on the events you care about: an organiser's post, or a change of time or status made by
 * hand. Public events are asked about in one call (POST /api/events/updates) for what is saved
 * or marked "going"; private ones you accepted bring theirs with /api/private. Any other event
 * shows its updates when its card is opened, and needs no mark. What you have
 * seen is kept on this device, so an event with something new carries the "!" on its pin
 * and its row until its card is opened, and the newest one is announced once over the map.
 */

const { refresh } = config.app;
const SEEN = 'updatesSeen';
const TOLD = 'updatesTold';
/** Entries kept per device: old events drop off, newest first. */
const KEEP = 400;

export interface News {
  /** When the newest post or change happened (ms). */
  at: number;
  title: string;
  /** The newest posts, newest first; empty when only the time or status changed. */
  posts: EventPost[];
}

/** A private event's part of the news, as /api/private lists it. */
export interface PrivateNews {
  id: string;
  title: string;
  mine: boolean;
  changedAt: string | null;
  lastPostAt: string | null;
  invitation: { seenAt: string | null; status?: string } | null;
}

function load(key: string): Record<string, number> {
  try {
    const v: unknown = JSON.parse(storage.get(key) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function keep(key: string, map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map);
  const next =
    entries.length > KEEP
      ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, KEEP))
      : map;
  storage.set(key, JSON.stringify(next));
  return next;
}

let publicNews = new Map<string, News>();
let privateNews = new Map<string, News>();
/** When the account last opened a private event, as the server knows it (other devices). */
let remoteSeen = new Map<string, number>();
let seen = load(SEEN);
let told = load(TOLD);
let unread: ReadonlySet<string> = new Set();
let version = 0;
const listeners = new Set<() => void>();

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const newsOf = (id: string): News | null => publicNews.get(id) ?? privateNews.get(id) ?? null;
const seenAt = (id: string) => Math.max(seen[id] ?? 0, remoteSeen.get(id) ?? 0);

function emit() {
  const next = new Set<string>();
  for (const map of [publicNews, privateNews])
    for (const [id, n] of map) if (n.at > seenAt(id)) next.add(id);
  // The same set keeps its identity, so nothing redraws for a poll that found nothing new.
  if (next.size !== unread.size || [...next].some((id) => !unread.has(id))) unread = next;
  version++;
  for (const l of listeners) l();
}

export const updates = {
  /** Ids of the events with news not seen on this device. */
  unread: (): ReadonlySet<string> => unread,
  isUnread: (id: string): boolean => unread.has(id),
  newsOf,
  /** The answer for the public events asked about: those left out have no news. */
  setPublic(list: readonly EventUpdates[]) {
    publicNews = new Map(
      list.map((u) => [
        u.id,
        { at: Math.max(ms(u.lastPostAt), ms(u.changedAt)), title: u.title, posts: u.posts },
      ]),
    );
    emit();
  },
  /** The private events you are going to (invitation accepted); your own never count as news. */
  setPrivate(list: readonly PrivateNews[]) {
    privateNews = new Map();
    remoteSeen = new Map();
    for (const e of list) {
      if (e.mine || (e.invitation?.status ?? 'accepted') !== 'accepted') continue;
      const at = Math.max(ms(e.lastPostAt), ms(e.changedAt));
      if (!at) continue;
      privateNews.set(e.id, { at, title: e.title, posts: [] });
      remoteSeen.set(e.id, ms(e.invitation?.seenAt));
    }
    emit();
  },
  /** The card showed the event's updates: its mark goes. */
  markSeen(id: string) {
    const n = newsOf(id);
    if (!n || (seen[id] ?? 0) >= n.at) return;
    seen = keep(SEEN, { ...seen, [id]: Math.max(Date.now(), n.at) });
    emit();
  },
  /**
   * News not announced yet, newest first; each is handed out once per device, so the notice over
   * the map shows a given update a single time.
   */
  takeNew(): { id: string; news: News }[] {
    const out: { id: string; news: News }[] = [];
    for (const id of unread) {
      const n = newsOf(id);
      if (n && n.at > (told[id] ?? 0)) out.push({ id, news: n });
    }
    if (!out.length) return out;
    const next = { ...told };
    for (const { id, news } of out) next[id] = news.at;
    told = keep(TOLD, next);
    return out.sort((a, b) => b.news.at - a.news.at);
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Tests: start empty. */
  reset() {
    publicNews = new Map();
    privateNews = new Map();
    remoteSeen = new Map();
    seen = {};
    told = {};
    unread = new Set();
    emit();
  },
};

const unreadSnapshot = () => unread;
/** The events with unseen news; the same set until it changes. */
export function useUnread(): ReadonlySet<string> {
  return useSyncExternalStore(updates.subscribe, unreadSnapshot, unreadSnapshot);
}

const versionSnapshot = () => version;
/** Re-renders on every change of the news (a poll, a private read, a card opened). */
export function useUpdatesVersion(): number {
  return useSyncExternalStore(updates.subscribe, versionSnapshot, versionSnapshot);
}

/** Asks about the public events among `ids` now. */
export async function refreshUpdates(ids: readonly string[]): Promise<void> {
  if (!ids.length) {
    updates.setPublic([]);
    return;
  }
  const res = await api<{ updates: EventUpdates[] }>('events/updates', {
    body: { ids: ids.slice(0, config.app.organiser.updatesMaxIds) },
  });
  updates.setPublic(res.updates);
}

/**
 * Keeps the news of `ids` (saved and going) fresh: now, when the list changes, when the
 * app comes back to the front, and every `refresh.dataMinutes`. Without a backend there is none.
 */
export function useUpdatesSync(ids: readonly string[]): void {
  const key = [...ids].sort().join('\n');
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL) return;
    const list = key ? key.split('\n') : [];
    const run = () =>
      void refreshUpdates(list).catch(() => {
        /* offline: the marks stay as they were */
      });
    run();
    const id = setInterval(run, refresh.dataMinutes * 60_000);
    const onShow = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [key]);
}
