import { useEffect, useState } from 'react';
import type { LatLng } from '@happow/core';
import { track } from './analytics';
import { config, region } from './config';

/** A search hit (GET /api/search, M7 §2). */
export interface SearchHit {
  id: string;
  title: string;
  categoryIds: string[];
  startAt: string;
  endAt: string;
  venueName: string | null;
  point: LatLng;
  distanceM: number | null;
  isFree: boolean;
  status: string;
  performers: string[];
  matchedPerformer: string | null;
  matchedExternalId?: string | null;
  match?: 'performer' | 'performer_similar' | 'title';
}

export type SearchState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; results: SearchHit[] }
  | { state: 'error'; code: 'network' | 'rate_limited' | 'server_error' };

const { search: cfg } = config.app;

/**
 * Debounced search (300 ms, at least 2 characters); a newer query cancels the one in flight.
 * Plausible counts a "Search" event without the text (§2).
 */
export function useSearch(q: string, center: LatLng | null): SearchState {
  const [s, setS] = useState<SearchState>({ state: 'idle' });
  const query = q.trim().replace(/\s+/g, ' ');
  const lat = center ? center.lat.toFixed(3) : '';
  const lng = center ? center.lng.toFixed(3) : '';
  useEffect(() => {
    if (query.length < cfg.minChars) {
      setS({ state: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setS({ state: 'loading' });
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: query.slice(0, cfg.maxChars), region: region.id });
      if (lat && lng) {
        params.set('lat', lat);
        params.set('lng', lng);
      }
      try {
        const res = await fetch(`/api/search?${params}`, { signal: ctrl.signal });
        if (res.status === 429) return setS({ state: 'error', code: 'rate_limited' });
        if (!res.ok) return setS({ state: 'error', code: 'server_error' });
        const body = (await res.json()) as { results: SearchHit[] };
        setS({ state: 'done', results: body.results });
        track('Search');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setS({ state: 'error', code: 'network' });
      }
    }, cfg.debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, lat, lng]);
  return s;
}
