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
import { api } from './api';
import { accessToken } from './auth';
import { config, region } from './config';

/**
 * Places to go to while they are open (restaurants, pubs, galleries). One snapshot of the area,
 * kept `places.cacheMinutes`; "open now" is worked out here from the opening hours, so a minute
 * passing or the time line moving costs no request. People add places and correct them; the one
 * who did reads the area again at once.
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
  /** A private party is on until then. */
  private_until?: string | null;
}

export interface Place {
  id: string;
  name: string;
  kind: Kind;
  point: LatLng;
  address: string | null;
  website: string | null;
  week: OpeningWeek;
  privateUntil: Date | null;
}

/** A place that is open at the time looked at. */
export interface OpenPlace extends Place {
  /** Null: it never closes. With a private party on: when the party ends. */
  closesAt: Date | null;
  /** Closed to the public for a private party. */
  privateParty: boolean;
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
      privateUntil: r.private_until ? new Date(r.private_until) : null,
    });
  }
  return out;
}

/**
 * The places to show at `at`: open (or with a private party on, which shows as such), passing the
 * category filters their kind follows, and not at the spot of a shown event (the event takes the
 * place over while it lasts).
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
    const party = p.privateUntil !== null && p.privateUntil > at;
    if (!s.open && !party) continue;
    if (eventPoints.some((e) => distanceM(e, p.point) <= cfg.nearEventM)) continue;
    out.push({
      ...p,
      closesAt: party ? p.privateUntil : s.open ? s.closesAt : null,
      privateParty: party,
      distanceM: distanceM(from, p.point),
    });
  }
  return out;
}

/**
 * The place holding a private party at `at` right where an event is: the event took the place's
 * pin over, so its card says the place is closed to the public.
 */
export function partyAt(
  places: readonly Place[],
  at: Date,
  point: LatLng,
  from: LatLng,
): OpenPlace | null {
  for (const p of places) {
    if (p.privateUntil === null || p.privateUntil <= at) continue;
    if (distanceM(point, p.point) > cfg.nearEventM) continue;
    return {
      ...p,
      closesAt: p.privateUntil,
      privateParty: true,
      distanceM: distanceM(from, p.point),
    };
  }
  return null;
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
// After a change of your own: the next read goes past every cache, and open maps read again.
let fresh = false;
let version = 0;
const watchers = new Set<() => void>();

/** Reads the area again, past the caches: after adding or correcting a place. */
function refreshPlaces(): void {
  cache.clear();
  fresh = true;
  version++;
  for (const w of watchers) w();
}

/** The area's places: the API with a backend, the demo seed without one. Kept `cacheMinutes`. */
export function loadPlaces(
  center: LatLng,
  doFetch: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  now: () => number = Date.now,
): Promise<Place[]> {
  const k = areaKey(center, density.searchRadiusM, refresh);
  const key = `lat=${k.lat}&lng=${k.lng}&r=${k.radiusM}`;
  const hit = cache.get(key);
  if (hit && now() < hit.at + cfg.cacheMinutes * 60_000) return hit.places;
  const read = async (init?: RequestInit) => {
    const res = await doFetch(`/api/places?${key}`, init);
    if (!res.ok) throw new Error(`places failed: ${res.status}`);
    return ((await res.json()) as { places: PlaceRow[] }).places;
  };
  const places = (
    import.meta.env.VITE_SUPABASE_URL
      ? // An empty answer may be a copy kept from before the first import: ask past the caches.
        fresh
        ? read({ cache: 'reload' })
        : read().then((rows) => (rows.length ? rows : read({ cache: 'reload' })))
      : seedRows()
  ).then(toPlaces);
  fresh = false;
  cache.set(key, { at: now(), places });
  // A failed or empty read is not kept: the next look tries again.
  places.then(
    (p) => p.length || cache.delete(key),
    () => cache.delete(key),
  );
  return places;
}

/** The places around `center`; empty while loading, when off, or when the read fails. */
export function usePlaces(center: LatLng, on: boolean): Place[] {
  const [places, setPlaces] = useState<Place[]>([]);
  const k = areaKey(center, density.searchRadiusM, refresh);
  const [seen, setSeen] = useState(version);
  useEffect(() => {
    const w = () => setSeen(version);
    watchers.add(w);
    return () => void watchers.delete(w);
  }, []);
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
  }, [on, k.lat, k.lng, seen]);
  return on ? places : [];
}

export interface NewPlace {
  name: string;
  kind: string;
  point: LatLng;
  openingHours: string;
  address: string;
  website: string;
}

/** Adds a place (an account is needed); it is on the map at once. */
export async function addPlace(place: NewPlace): Promise<string> {
  const { id } = await api<{ id: string }>('places', {
    body: { regionId: region.id, ...place },
    token: await accessToken(),
  });
  refreshPlaces();
  return id;
}

/** One correction: new hours, closed for good, or a private party until a time (null: over). */
export async function changePlace(
  id: string,
  change: { openingHours: string } | { closed: true } | { privateUntil: string | null },
): Promise<void> {
  await api('places/change', { body: { id, ...change }, token: await accessToken() });
  refreshPlaces();
}
