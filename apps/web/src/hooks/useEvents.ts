import { useEffect, useMemo, useState } from 'react';
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

const REFRESH_MS = 60_000;

/**
 * Events overlapping the time window (region timezone) within `radiusM` of `center`, filtered,
 * plus density clusters within `searchRadiusM` for hints beyond the circle.
 */
export function useEvents(
  repo: EventRepository,
  center: LatLng,
  radiusM: number,
  timeZone: string,
  timeWindow: TimeWindow,
  filters: EventFilters,
  searchRadiusM: number,
): EventsState {
  const [state, setState] = useState<EventsState>({
    events: [],
    clusters: [],
    loading: true,
    error: false,
    now: new Date(),
  });
  const [tick, setTick] = useState(0);

  // GPS jitters; only refetch when the user has moved ~20 m.
  const lat = Math.round(center.lat * 5000) / 5000;
  const lng = Math.round(center.lng * 5000) / 5000;
  const categoryKey = [...filters.categories].sort().join(',');
  const query = useMemo(
    () => ({
      center: { lat, lng },
      radiusM,
      categories: categoryKey ? categoryKey.split(',') : [],
      price: filters.price,
    }),
    [lat, lng, radiusM, categoryKey, filters.price],
  );

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const now = new Date();
      setState((s) => ({ ...s, loading: true }));
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
  }, [repo, query, timeZone, timeWindow, searchRadiusM, radiusM, tick]);

  return state;
}
