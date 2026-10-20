import { useCallback, useEffect, useState } from 'react';

const PREFIX = '#/e/';

function read(): string | null {
  const h = window.location.hash;
  if (!h.startsWith(PREFIX)) return null;
  try {
    return decodeURIComponent(h.slice(PREFIX.length)) || null;
  } catch {
    return null;
  }
}

export function eventHref(id: string): string {
  return `${PREFIX}${encodeURIComponent(id)}`;
}

/** Absolute link to an event's detail screen, for sharing. */
export function eventUrl(id: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${eventHref(id)}`;
}

/**
 * The event whose detail screen is open, kept in the URL hash (`#/e/<id>`) so details can be
 * shared and the back button closes them.
 */
export function useDetailRoute(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState(read);
  useEffect(() => {
    const sync = () => setId(read());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  const open = useCallback((next: string | null) => {
    if (next) {
      window.history.pushState({ happowDetail: true }, '', eventHref(next));
      setId(next);
      return;
    }
    // Opened inside the app: step back so Back doesn't reopen it. Opened from a shared link: clear.
    if (window.history.state?.happowDetail) window.history.back();
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setId(null);
  }, []);
  return [id, open];
}
