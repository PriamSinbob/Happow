import { useCallback, useEffect, useState } from 'react';

/** Screens that live in the URL hash, so they can be linked, shared and closed with Back. */
export type Route =
  | { name: 'event'; id: string }
  | { name: 'go'; id: string }
  /** `again`: one of the account's submissions to add for another date (M12 §4.4). */
  | { name: 'add'; again?: string }
  | { name: 'moderate' }
  | { name: 'about' };

/** Screens about one event: its detail, and "Going there". */
const WITH_ID = { event: '#/e/', go: '#/go/' } as const;
const AGAIN = '#/add?again=';

function read(): Route | null {
  const h = window.location.hash;
  for (const [name, prefix] of Object.entries(WITH_ID) as [keyof typeof WITH_ID, string][]) {
    if (!h.startsWith(prefix)) continue;
    try {
      const id = decodeURIComponent(h.slice(prefix.length));
      return id ? { name, id } : null;
    } catch {
      return null;
    }
  }
  if (h === '#/add') return { name: 'add' };
  if (h.startsWith(AGAIN)) {
    try {
      const again = decodeURIComponent(h.slice(AGAIN.length));
      return again ? { name: 'add', again } : { name: 'add' };
    } catch {
      return { name: 'add' };
    }
  }
  if (h === '#/moderate') return { name: 'moderate' };
  if (h === '#/about') return { name: 'about' };
  return null;
}

export function routeHref(route: Route): string {
  if (route.name === 'add' && route.again) return AGAIN + encodeURIComponent(route.again);
  return 'id' in route
    ? `${WITH_ID[route.name]}${encodeURIComponent(route.id)}`
    : `#/${route.name}`;
}

export function eventHref(id: string): string {
  return routeHref({ name: 'event', id });
}

/** This visit started from a shared /e/<id> link (for the iOS install hint, M9 §7). */
export let openedFromLink = false;

/**
 * A shared link /e/<id> (M9 §1; the Worker gave crawlers its preview tags) opens as the app's own
 * event route on the map's address, so closing the card leaves the map at "/". The query (a share
 * token) is kept. Runs once, before the app reads the URL.
 */
export function adoptEventPath(): void {
  const m = /^\/e\/([^/]+)\/?$/.exec(window.location.pathname);
  if (!m) return;
  openedFromLink = true;
  window.history.replaceState(null, '', `/${window.location.search}${WITH_ID.event}${m[1]}`);
}

/**
 * Absolute link to an event, for sharing: the clean /e/<id> form, which the Worker answers with
 * the event's preview tags (M9 §1) and the app opens as the event's card.
 */
export function eventUrl(id: string): string {
  return `${window.location.origin}/e/${encodeURIComponent(id)}`;
}

/**
 * The open screen. Opening pushes a history entry (Back closes it); closing a screen opened from
 * a shared link clears the hash instead of leaving the app. `replace` swaps the open screen.
 */
export function useRoute(): [Route | null, (next: Route | null, replace?: boolean) => void] {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const sync = () => setRoute(read());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  const go = useCallback((next: Route | null, replace = false) => {
    if (next) {
      // Replacing keeps the entry Back returns to (e.g. the map, not a finished form).
      if (replace) window.history.replaceState(window.history.state, '', routeHref(next));
      else window.history.pushState({ happow: true }, '', routeHref(next));
      setRoute(next);
      return;
    }
    if (window.history.state?.happow) window.history.back();
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setRoute(null);
  }, []);
  return [route, go];
}
