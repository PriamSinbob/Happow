import { useEffect, useMemo, useState } from 'react';
import type { LatLng, NearbyEvent } from '@happow/core';
import { config } from '../config';
import type { EventRepository } from '../data';

export interface MyEvents {
  /** The events on your list that are still listed, any day and distance. */
  events: NearbyEvent[];
  /** Ids the server no longer lists (hidden, or dropped); empty until a read succeeds. */
  gone: string[];
  loading: boolean;
}

const { agenda, refresh } = config.app;

/**
 * The events on your list (M10 §1), read by id so plans beyond the map's 14 days and outside the
 * reach show too. Events the map already loaded fill in at once and when a read fails; the read
 * runs again when the list or the search point changes, and every `refresh.dataMinutes`.
 */
export function useMyEvents(
  repo: EventRepository,
  ids: readonly string[],
  center: LatLng,
  known: readonly NearbyEvent[],
  enabled: boolean,
): MyEvents {
  const key = [...ids].sort().join('\n');
  const [read, setRead] = useState<{ key: string; events: NearbyEvent[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((n) => n + 1), refresh.dataMinutes * 60_000);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !key) return;
    const ctrl = new AbortController();
    setLoading(true);
    const want = key.split('\n');
    const reads: Promise<NearbyEvent[]>[] = [];
    for (let i = 0; i < want.length; i += agenda.maxPerRead)
      reads.push(repo.byIds(want.slice(i, i + agenda.maxPerRead), center, ctrl.signal));
    Promise.all(reads)
      .then((parts) => !ctrl.signal.aborted && setRead({ key, events: parts.flat() }))
      .catch(() => {
        /* offline, or the server has no events_by_ids yet: the map's events stand in */
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [repo, key, center, enabled, tick]);

  return useMemo(() => {
    const want = new Set(key ? key.split('\n') : []);
    const byId = new Map<string, NearbyEvent>();
    for (const e of known) if (want.has(e.id)) byId.set(e.id, e);
    // A fresh read wins over the map's copy (a moved start, a cancellation).
    for (const e of read?.events ?? []) if (want.has(e.id)) byId.set(e.id, e);
    const gone = read && read.key === key ? [...want].filter((id) => !byId.has(id)) : [];
    return { events: [...byId.values()], gone, loading };
  }, [key, known, read, loading]);
}
