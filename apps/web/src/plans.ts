import { useEffect, useRef, useSyncExternalStore } from 'react';
import { can, mergePlans, setPlan, type PlanEntry } from '@happow/core';
import { useAccount } from './account';
import { api } from './api';
import { accessToken } from './auth';
import { config } from './config';
import { storage } from './storage';

/**
 * Your plans (M10 §1, §2): the events saved on this device, with "I'm going" marks and recent
 * removals. One store for the whole app, so the bookmark, "I'm going", the views and the agenda
 * agree. Signed in with `saved.sync`, it follows the account (see `usePlanSync`).
 */

const KEY = 'plans';
const { agenda, refresh } = config.app;

function isEntry(v: unknown): v is PlanEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.on === 'boolean' &&
    typeof e.going === 'boolean' &&
    typeof e.at === 'number'
  );
}

function load(): PlanEntry[] {
  try {
    const v: unknown = JSON.parse(storage.get(KEY) ?? 'null');
    if (Array.isArray(v)) return v.filter(isEntry);
    // Before M10: a plain list of saved ids, oldest first.
    const old: unknown = JSON.parse(storage.get('saved') ?? '[]');
    if (!Array.isArray(old)) return [];
    const t = Date.now() - old.length;
    return old
      .filter((x): x is string => typeof x === 'string')
      .map((id, i) => ({ id, on: true, going: false, at: t + i }));
  } catch {
    return [];
  }
}

let list: PlanEntry[] = load();
const listeners = new Set<() => void>();

function commit(next: PlanEntry[]) {
  list = mergePlans([], next, Date.now(), agenda);
  storage.set(KEY, JSON.stringify(list));
  for (const l of listeners) l();
}

export const plans = {
  list: () => list,
  isSaved: (id: string) => list.some((e) => e.id === id && e.on),
  isGoing: (id: string) => list.some((e) => e.id === id && e.on && e.going),
  /** The bookmark on the card. */
  toggle: (id: string) => commit(setPlan(list, id, { on: !plans.isSaved(id) }, Date.now())),
  /** "I'm going" also saves; taking it back keeps the bookmark (owner, 2026-11-04). */
  setGoing: (id: string, going: boolean) => commit(setPlan(list, id, { going }, Date.now())),
  /** Takes events off the list (ended long ago); a removal, so other devices drop them too. */
  remove: (ids: readonly string[]) => {
    if (!ids.some((id) => plans.isSaved(id))) return;
    let next = list;
    for (const id of ids) next = setPlan(next, id, { on: false }, Date.now());
    commit(next);
  },
  /** An event marked "going" before M10, or on a device that didn't save it: save it once. */
  adoptGoing: (id: string) => {
    if (!list.some((e) => e.id === id)) plans.setGoing(id, true);
  },
  /** The account's list merged with this device's (the server's on a tie). */
  merge: (server: readonly PlanEntry[]) => commit(mergePlans(list, server, Date.now(), agenda)),
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Tests: start from a given list. */
  reset: (next: PlanEntry[] = load()) => {
    list = next;
    for (const l of listeners) l();
  },
};

/** The list, re-rendering on every change. */
export function usePlans(): PlanEntry[] {
  return useSyncExternalStore(plans.subscribe, plans.list, plans.list);
}

/**
 * Keeps the list in step with the account (§2): on sign-in, after each change (batched) and every
 * `refresh.dataMinutes`. Without an account or `saved.sync`, nothing leaves the device.
 */
export function usePlanSync(): void {
  const { status, entitlements } = useAccount();
  const on = status === 'signedIn' && can(entitlements, 'saved.sync');
  const busy = useRef(false);
  const again = useRef(false);
  // The list as the server last answered it: a reply changes nothing to send back.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!on) {
      sent.current = null;
      return;
    }
    const sync = async () => {
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      try {
        const token = await accessToken();
        if (!token) return;
        const res = await api<{ items: PlanEntry[] }>('me/saved', {
          token,
          body: { items: plans.list() },
        });
        plans.merge(res.items);
        sent.current = JSON.stringify(plans.list());
      } catch {
        /* offline or a server error: the next change or the next step tries again */
      } finally {
        busy.current = false;
        if (again.current) {
          again.current = false;
          void sync();
        }
      }
    };
    void sync();
    const id = setInterval(() => void sync(), refresh.dataMinutes * 60_000);
    const changed = () => {
      if (JSON.stringify(plans.list()) === sent.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => void sync(), 1500);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = plans.subscribe(changed);
    return () => {
      clearInterval(id);
      clearTimeout(timer);
      off();
    };
  }, [on]);
}
