import { useEffect, useState } from 'react';
import {
  areaKey,
  distanceM,
  matchesFilters,
  openState,
  parseOpeningHours,
  type EventFilters,
  type LatLng,
  type OpeningWeek,
} from '@happow/core';
import { config, region } from './config';

/**
 * Places to go to while they are open (restaurants, pubs, galleries). One snapshot of the area per
 * day at most: places change weekly, and "open now" is worked out here from the opening hours, so
 * a minute passing or the time line moving costs no request.
 */

const { places: cfg, refresh, density } = config.app;
type Kind = (typeof cfg.kinds)[number];
const kinds = new Map<string, Kind>(cfg.kinds.map((k) => [k.tag, k]));

/** A place as /api/places (and the demo seed) lists it. */
export interface PlaceRow {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  address: string | null;
  website: string | null;
  opening_hours: string | null;
}

export interface Place {
  id: string;
  name: string;
  kind: Kind;
  point: LatLng;
  address: string | null;
  website: string | null;
  week: OpeningWeek;
}

/** A place that is open at the time looked at. */
export interface OpenPlace extends Place {
  /** Null: it never closes. */
  closesAt: Date | null;
  distanceM: number;
}

/** Rows of a configured kind whose hours can be read; the rest can never show as open. */
export function toPlaces(rows: readonly PlaceRow[]): Place[] {
  const out: Place[] = [];
  for (const r of rows) {
    const kind = kinds.get(r.kind);
    const week = parseOpeningHours(r.opening_hours);
    if (!kind || !week) continue;
    out.push({
      id: r.id,
      name: r.name,
      kind,
      point: { lat: r.lat, lng: r.lng },
      address: r.address,
      website: r.website,
      week,
    });
  }
  return out;
}

/**
 * The places to show at `at`: open, passing the category filters their kind follows, and not at
 * the spot of a shown event (the event takes the place over while it lasts).
 */
export function openPlaces(
  places: readonly Place[],
  at: Date,
  timeZone: string,
  from: LatLng,
  filters: Partial<EventFilters>,
  eventPoints: readonly LatLng[],
): OpenPlace[] {
  const out: OpenPlace[] = [];
  for (const p of places) {
    if (
      !matchesFilters(
        { categoryIds: [p.kind.category], isFree: true },
        { ...filters, price: 'any' },
      )
    )
      continue;
    const s = openState(p.week, at, timeZone);
    if (!s.open) continue;
    if (eventPoints.some((e) => distanceM(e, p.point) <= cfg.nearEventM)) continue;
    out.push({ ...p, closesAt: s.closesAt, distanceM: distanceM(from, p.point) });
  }
  return out;
}

const seedFiles = import.meta.glob<{ default: { places: PlaceRow[] } }>(
  '../../../data/seed/*.places.json',
);

async function seedRows(): Promise<PlaceRow[]> {
  const file = region.seedPlacesFile;
  const key = Object.keys(seedFiles).find((k) => file && k.endsWith(file.split('/').pop()!));
  return key ? (await seedFiles[key]!()).default.places : [];
}

const cache = new Map<string, { at: number; places: Promise<Place[]> }>();

/** The area's places: the API with a backend, the demo seed without one. Kept `cacheHours`. */
export function loadPlaces(
  center: LatLng,
  doFetch: (url: string) => Promise<Response> = (url) => fetch(url),
  now: () => number = Date.now,
): Promise<Place[]> {
  const k = areaKey(center, density.searchRadiusM, refresh);
  const key = `lat=${k.lat}&lng=${k.lng}&r=${k.radiusM}`;
  const hit = cache.get(key);
  if (hit && now() < hit.at + cfg.cacheHours * 3_600_000) return hit.places;
  const places = (
    import.meta.env.VITE_SUPABASE_URL
      ? doFetch(`/api/places?${key}`).then(async (res) => {
          if (!res.ok) throw new Error(`places failed: ${res.status}`);
          return ((await res.json()) as { places: PlaceRow[] }).places;
        })
      : seedRows()
  ).then(toPlaces);
  cache.set(key, { at: now(), places });
  // A failed read is not kept: the next look tries again.
  places.catch(() => cache.delete(key));
  return places;
}

/** The places around `center`; empty while loading, when off, or when the read fails. */
export function usePlaces(center: LatLng, on: boolean): Place[] {
  const [places, setPlaces] = useState<Place[]>([]);
  const k = areaKey(center, density.searchRadiusM, refresh);
  useEffect(() => {
    if (!on) return;
    let live = true;
    loadPlaces({ lat: k.lat, lng: k.lng }).then(
      (p) => live && setPlaces(p),
      (err) => console.error(err),
    );
    return () => {
      live = false;
    };
  }, [on, k.lat, k.lng]);
  return on ? places : [];
}
