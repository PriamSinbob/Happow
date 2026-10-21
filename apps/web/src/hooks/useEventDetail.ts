import { useEffect, useState } from 'react';
import type { LatLng, NearbyEvent } from '@happow/core';
import type { EventRepository } from '../data';

/**
 * The event behind the detail screen. The copy from the loaded list shows at once; the event is
 * then read fresh by id (one small request when the screen opens), so a cancellation or a
 * community warning is never a refresh step late where someone decides whether to go, and the
 * long fields (description, image, links) the list leaves out are filled in.
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
    if (!id) return;
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
    // Once per opened event: `from` moves with location updates, which must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, id]);

  if (!id) return { ev: null, loading: false };
  const fresh = fetched?.id === id ? fetched : null;
  if (fresh?.ev) {
    // Keep the list's distance (measured from the current search centre).
    return { ev: inList ? { ...fresh.ev, distanceM: inList.distanceM } : fresh.ev, loading: false };
  }
  if (inList) return { ev: inList, loading: false };
  return fresh ? { ev: null, loading: false } : { ev: null, loading: true };
}
