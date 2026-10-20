import { useEffect, useMemo, useState } from 'react';
import { dayBounds, type LatLng, type NearbyEvent } from '@happow/core';
import type { EventRepository } from '../data';

export interface EventsState {
  events: NearbyEvent[];
  loading: boolean;
  error: boolean;
  now: Date;
}

const REFRESH_MS = 60_000;

/** Events overlapping the rest of today (region timezone) within `radiusM` of `center`. */
export function useEvents(
  repo: EventRepository,
  center: LatLng,
  radiusM: number,
  timeZone: string,
): EventsState {
  const [state, setState] = useState<EventsState>({
    events: [],
    loading: true,
    error: false,
    now: new Date(),
  });
  const [tick, setTick] = useState(0);

  // GPS jitters; only refetch when the user has moved ~20 m.
  const lat = Math.round(center.lat * 5000) / 5000;
  const lng = Math.round(center.lng * 5000) / 5000;
  const query = useMemo(() => ({ center: { lat, lng }, radiusM }), [lat, lng, radiusM]);

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
        const events = await repo.near(
          { ...query, from: now, to: dayBounds(now, timeZone).end },
          ctrl.signal,
        );
        setState({ events, loading: false, error: false, now });
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
  }, [repo, query, timeZone, tick]);

  return state;
}
