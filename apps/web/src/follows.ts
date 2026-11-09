import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { can, normName, type LatLng } from '@happow/core';
import { useAccount } from './account';
import { api } from './api';
import { accessToken } from './auth';
import { config, region } from './config';
import { storage } from './storage';

/**
 * Followed artists. Kept on the device with no account: `{ name, norm,
 * tmAttractionId? }`, at most `follows.max`. A removal stays a while as a tombstone, so an
 * account's other devices drop it too (follows sync, premium). Never throws: storage may be off.
 */

export interface Follow {
  name: string;
  norm: string;
  tmAttractionId?: string | null;
  /** ISO time of the last change on any device. */
  changedAt: string;
  removed?: boolean;
}

const KEY = 'follows';
const MATCH_KEY = 'followMatches';
const { follows: cfg } = config.app;
const KEEP_REMOVED_MS = 60 * 86_400_000;

function isFollow(v: unknown): v is Follow {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.name === 'string' && typeof f.norm === 'string' && typeof f.changedAt === 'string'
  );
}

function load(): Follow[] {
  try {
    const v: unknown = JSON.parse(storage.get(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isFollow) : [];
  } catch {
    return [];
  }
}

/** Latest change per name wins; old tombstones go; the newest `max` active ones stay. */
export function mergeFollows(
  a: readonly Follow[],
  b: readonly Follow[],
  now = Date.now(),
): Follow[] {
  const by = new Map<string, Follow>();
  for (const f of [...a, ...b]) {
    const had = by.get(f.norm);
    if (!had || f.changedAt > had.changedAt) by.set(f.norm, f);
  }
  const all = [...by.values()].filter(
    (f) => !f.removed || now - Date.parse(f.changedAt) < KEEP_REMOVED_MS,
  );
  const active = all
    .filter((f) => !f.removed)
    .sort((x, y) => y.changedAt.localeCompare(x.changedAt));
  const keep = new Set(active.slice(0, cfg.max).map((f) => f.norm));
  return all
    .filter((f) => f.removed || keep.has(f.norm))
    .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
}

let list: Follow[] = load();
let active: Follow[] = list.filter((f) => !f.removed);
const listeners = new Set<() => void>();

function commit(next: Follow[]) {
  list = mergeFollows([], next);
  active = list.filter((f) => !f.removed);
  storage.set(KEY, JSON.stringify(list));
  for (const l of listeners) l();
}

const clean = (name: string) => name.replace(/\s+/g, ' ').trim();

export const follows = {
  /** Everything, tombstones included (what sync sends). */
  all: () => list,
  /** The followed names. */
  list: () => active,
  isFollowed: (name: string) => {
    const n = normName(name);
    return active.some((f) => f.norm === n);
  },
  /** Adds names (bulk paste: one per line); a known Ticketmaster id is kept. Returns how many were new. */
  add: (items: { name: string; tmAttractionId?: string | null }[]) => {
    const at = new Date().toISOString();
    const known = new Set(active.map((f) => f.norm));
    const add: Follow[] = [];
    for (const i of items) {
      const name = clean(i.name);
      const norm = normName(name);
      if (norm.length < 2 || name.length > 120 || known.has(norm)) continue;
      known.add(norm);
      add.push({ name, norm, tmAttractionId: i.tmAttractionId ?? null, changedAt: at });
    }
    if (add.length) commit([...list.filter((f) => !add.some((a) => a.norm === f.norm)), ...add]);
    return add.length;
  },
  remove: (name: string) => {
    const n = normName(name);
    const at = new Date().toISOString();
    if (!active.some((f) => f.norm === n)) return;
    commit(list.map((f) => (f.norm === n ? { ...f, removed: true, changedAt: at } : f)));
  },
  /** ♡ on a chip or a search result. */
  toggle: (name: string, tmAttractionId?: string | null) => {
    if (follows.isFollowed(name)) follows.remove(name);
    else follows.add([{ name, tmAttractionId }]);
  },
  merge: (server: readonly Follow[]) => commit(mergeFollows(list, server)),
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Tests. */
  reset: (next: Follow[] = load()) => {
    list = next;
    active = list.filter((f) => !f.removed);
    for (const l of listeners) l();
  },
};

/** "Kult\nHey, Mela Koteluk" → names: one per line (commas too, as the add form). */
export function parseNames(text: string): string[] {
  return text
    .split(/[\n,;]/)
    .map(clean)
    .filter((n) => normName(n).length >= 2 && n.length <= 120);
}

export function useFollows(): Follow[] {
  return useSyncExternalStore(follows.subscribe, follows.list, follows.list);
}

/** An upcoming event with a followed performer in the region (from /api/follows/match). */
export interface FollowMatch {
  id: string;
  title: string;
  categoryIds: string[];
  startAt: string;
  endAt: string;
  venueName: string | null;
  point: LatLng;
  distanceM: number | null;
  matchedPerformer: string | null;
}

/** A Ticketmaster date elsewhere in the country: in the list with its city, never on the map. */
export interface NationwideDate {
  id: string;
  performer: string;
  title: string;
  startAt: string | null;
  localDate: string | null;
  city: string | null;
  venueName: string | null;
  url: string | null;
}

export interface Matches {
  matches: FollowMatch[];
  nationwide: NationwideDate[];
}

interface Stored extends Matches {
  key: string;
  at: number;
}

const EMPTY: Matches = { matches: [], nationwide: [] };

function storedMatches(key: string): Stored | null {
  try {
    const v = JSON.parse(storage.get(MATCH_KEY) ?? 'null') as Stored | null;
    return v && v.key === key && Array.isArray(v.matches) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Matches for the followed names: asked on open and then at most every
 * `follows.matchEveryMinutes`; the last answer is kept for that long, also across reloads.
 * The server keeps no copy of the list.
 */
export function useFollowMatches(center: LatLng | null): Matches & { loading: boolean } {
  const list = useFollows();
  const key = list
    .map((f) => `${f.norm}|${f.tmAttractionId ?? ''}`)
    .sort()
    .join(',');
  const [state, setState] = useState<Matches>(() => storedMatches(key) ?? EMPTY);
  const [loading, setLoading] = useState(false);
  const where = useRef(center);
  where.current = center;

  useEffect(() => {
    if (!list.length) {
      setState(EMPTY);
      return;
    }
    let stop = false;
    const ask = async () => {
      const kept = storedMatches(key);
      if (kept && Date.now() - kept.at < cfg.matchEveryMinutes * 60_000) {
        setState(kept);
        return;
      }
      setLoading(true);
      try {
        const res = await api<Matches>('follows/match', {
          body: {
            follows: follows
              .list()
              .map((f) => ({ name: f.name, tmAttractionId: f.tmAttractionId ?? null })),
            regionId: region.id,
            lat: where.current?.lat ?? null,
            lng: where.current?.lng ?? null,
          },
        });
        if (stop) return;
        setState(res);
        storage.set(MATCH_KEY, JSON.stringify({ ...res, key, at: Date.now() }));
      } catch {
        /* offline or rate-limited: keep what we have */
      } finally {
        if (!stop) setLoading(false);
      }
    };
    void ask();
    const id = setInterval(() => void ask(), cfg.matchEveryMinutes * 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
    // The list changing (a ♡) asks again; moving the map does not.
  }, [key]);
  return { ...state, loading };
}

/**
 * Follows across an account's devices (premium `follows.sync`): on sign-in, after each change
 * (batched) and every `refresh.dataMinutes`. Otherwise nothing leaves the device but the match.
 */
export function useFollowSync(): void {
  const { status, entitlements } = useAccount();
  const on = status === 'signedIn' && can(entitlements, 'follows.sync');
  const busy = useRef(false);
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!on) {
      sent.current = null;
      return;
    }
    const sync = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const token = await accessToken();
        if (!token) return;
        const res = await api<{ items: Follow[] }>('me/follows', {
          token,
          body: {
            items: follows.all().map((f) => ({
              name: f.name,
              tmAttractionId: f.tmAttractionId ?? null,
              changedAt: f.changedAt,
              removed: !!f.removed,
            })),
          },
        });
        follows.merge(res.items.filter(isFollow));
        sent.current = JSON.stringify(follows.all());
      } catch {
        /* the next change or the next step tries again */
      } finally {
        busy.current = false;
      }
    };
    void sync();
    const id = setInterval(() => void sync(), config.app.refresh.dataMinutes * 60_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = follows.subscribe(() => {
      if (JSON.stringify(follows.all()) === sent.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => void sync(), 1500);
    });
    return () => {
      clearInterval(id);
      clearTimeout(timer);
      off();
    };
  }, [on]);
}
