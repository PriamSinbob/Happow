import { useEffect, useMemo, useRef, useState } from 'react';
import {
  windowRange,
  type DensityCluster,
  type EventFilters,
  type LatLng,
  type NearbyEvent,
  type TimeWindow,
} from '@happow/core';
import type { EventRepository } from '../data';

export interface EventsState {
  events: NearbyEvent[];
  /** Matching events around the user per density cell; empty when the density query fails. */
  clusters: DensityCluster[];
  loading: boolean;
  error: boolean;
  now: Date;
}

/**
 * Events overlapping the time window (region timezone) within `radiusM` of `center`, filtered,
 * plus density clusters within `searchRadiusM` for hints beyond the circle.
 *
 * Re-evaluated when the query changes and when the minute clock moves. The repository decides
 * whether that needs the network: the area repository answers from its cached snapshot and
 * downloads only when the refresh step (5 min) has passed or the user left the area.
 */
export function useEvents(
  repo: EventRepository,
  center: LatLng,
  radiusM: number,
  timeZone: string,
  timeWindow: TimeWindow,
  filters: EventFilters,
  searchRadiusM: number,
  now: Date,
): EventsState {
  const [state, setState] = useState<EventsState>({
    events: [],
    clusters: [],
    loading: true,
    error: false,
    now,
  });

  const categoryKey = [...filters.categories].sort().join(',');
  const query = useMemo(
    () => ({
      center,
      radiusM,
      categories: categoryKey ? categoryKey.split(',') : [],
      price: filters.price,
    }),
    [center, radiusM, categoryKey, filters.price],
  );
  // A new question shows "loading"; the minute clock re-evaluating the same one does not.
  const shown = useRef<object | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const fresh = shown.current !== query || shown.current === null;
    const timer = setTimeout(async () => {
      if (fresh) setState((s) => ({ ...s, loading: true }));
      try {
        const q = { ...query, ...windowRange(timeWindow, now, timeZone) };
        const [events, clusters] = await Promise.all([
          repo.near(q, ctrl.signal),
          // Hints are a bonus: their failure must not hide the events.
          repo
            .density({ ...q, searchRadiusM: Math.max(searchRadiusM, radiusM) }, ctrl.signal)
            .catch((err) => {
              if (!ctrl.signal.aborted) console.error(err);
              return [] as DensityCluster[];
            }),
        ]);
        if (ctrl.signal.aborted) return;
        shown.current = query;
        setState({ events, clusters, loading: false, error: false, now });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setState((s) => ({ ...s, loading: false, error: true, now }));
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [repo, query, timeZone, timeWindow, searchRadiusM, radiusM, now]);

  return state;
}
