import { useCallback, useEffect, useState } from 'react';

/** Screens that live in the URL hash, so they can be linked, shared and closed with Back. */
export type Route =
  | { name: 'event'; id: string }
  | { name: 'go'; id: string }
  | { name: 'add' }
  | { name: 'moderate' }
  | { name: 'about' }
  | { name: 'atlas' };

/** Screens about one event: its detail, and "Going there". */
const WITH_ID = { event: '#/e/', go: '#/go/' } as const;

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
  if (h === '#/moderate') return { name: 'moderate' };
  if (h === '#/about') return { name: 'about' };
  if (h === '#/atlas') return { name: 'atlas' };
  return null;
}

export function routeHref(route: Route): string {
  return 'id' in route
    ? `${WITH_ID[route.name]}${encodeURIComponent(route.id)}`
    : `#/${route.name}`;
}

export function eventHref(id: string): string {
  return routeHref({ name: 'event', id });
}

/** Absolute link to an event's detail screen, for sharing. */
export function eventUrl(id: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${eventHref(id)}`;
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
