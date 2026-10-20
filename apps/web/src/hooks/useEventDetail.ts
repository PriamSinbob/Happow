import { useEffect, useState } from 'react';
import type { LatLng, NearbyEvent } from '@happow/core';
import type { EventRepository } from '../data';

/**
 * The event behind the detail screen: taken from the loaded list when it is there (instant),
 * otherwise fetched by id (shared links, events outside the current filters).
 */
export function useEventDetail(
  repo: EventRepository,
  id: string | null,
  loaded: NearbyEvent[],
  from: LatLng,
): { ev: NearbyEvent | null; loading: boolean } {
  const inList = id ? (loaded.find((e) => e.id === id) ?? null) : null;
  const [fetched, setFetched] = useState<{ id: string; ev: NearbyEvent | null } | null>(null);

  useEffect(() => {
    if (!id || inList) return;
    const ctrl = new AbortController();
    repo
      .byId(id, from, ctrl.signal)
      .then((ev) => setFetched({ id, ev }))
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setFetched({ id, ev: null });
      });
    return () => ctrl.abort();
    // `from` changes with GPS jitter; the distance is refreshed when the list reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, id, inList === null]);

  if (!id) return { ev: null, loading: false };
  if (inList) return { ev: inList, loading: false };
  return fetched?.id === id ? { ev: fetched.ev, loading: false } : { ev: null, loading: true };
}
