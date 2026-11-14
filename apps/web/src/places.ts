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
  type PlacePhotoResult,
} from '@happow/core';
import { api, deviceId } from './api';
import { accessToken } from './auth';
import { config, region } from './config';
import type { ShrunkPhoto } from './photo';

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

/** A place whose opening hours are unknown: shown close in as a hollow pin, to be filled in. */
export interface UnknownPlace {
  id: string;
  name: string;
  kind: Kind;
  point: LatLng;
  address: string | null;
  website: string | null;
}

/** What a place listed at a spot has in common, with hours or without. */
export type ListedPlace = Pick<Place, 'id' | 'name' | 'kind' | 'point' | 'address' | 'website'>;

/** A place that is open at the time looked at. */
export interface OpenPlace extends Place {
  /** Null: it never closes. With a private party on: when the party ends. */
  closesAt: Date | null;
  /** Closed to the public for a private party. */
  privateParty: boolean;
  distanceM: number;
}

/** Rows of a configured kind whose hours are missing or can't be read. */
export function toUnknown(rows: readonly Omit<PlaceRow, 'opening_hours'>[]): UnknownPlace[] {
  const out: UnknownPlace[] = [];
  for (const r of rows) {
    const kind = kinds.get(r.kind);
    if (!kind || parseOpeningHours((r as PlaceRow).opening_hours)) continue;
    out.push({
      id: r.id,
      name: r.name,
      kind,
      point: { lat: r.lat, lng: r.lng },
      address: r.address,
      website: r.website,
    });
  }
  return out;
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
// After a change of your own, each area's next read goes past every cache (the browser keeps an
// area for `cacheMinutes`), and open maps read again. Per area: the add form reads the area at its
// pin, which may not be the map's.
let changed = false;
const reloaded = new Set<string>();
let version = 0;
const watchers = new Set<() => void>();

/** Reads the area again, past the caches: after adding or correcting a place. */
function refreshPlaces(): void {
  cache.clear();
  unknownCache.clear();
  changed = true;
  reloaded.clear();
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
        changed && !reloaded.has(key)
        ? read({ cache: 'reload' })
        : read().then((rows) => (rows.length ? rows : read({ cache: 'reload' })))
      : seedRows()
  ).then(toPlaces);
  if (changed) reloaded.add(key);
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

const unknownCache = new Map<string, { at: number; places: Promise<UnknownPlace[]> }>();

/**
 * The area's places whose hours are unknown (GET /api/places/unknown, the demo seed's places
 * without hours without a backend). Kept and refreshed like the open places.
 */
export function loadUnknown(center: LatLng, now: () => number = Date.now): Promise<UnknownPlace[]> {
  const k = areaKey(center, density.searchRadiusM, refresh);
  const key = `lat=${k.lat}&lng=${k.lng}&r=${k.radiusM}`;
  const hit = unknownCache.get(key);
  if (hit && now() < hit.at + cfg.cacheMinutes * 60_000) return hit.places;
  const reload = changed && !reloaded.has(`unknown:${key}`);
  if (changed) reloaded.add(`unknown:${key}`);
  const places = (
    import.meta.env.VITE_SUPABASE_URL
      ? fetch(`/api/places/unknown?${key}`, reload ? { cache: 'reload' } : undefined).then(
          async (res) => {
            if (!res.ok) throw new Error(`unknown places failed: ${res.status}`);
            return ((await res.json()) as { places: Omit<PlaceRow, 'opening_hours'>[] }).places;
          },
        )
      : seedRows()
  ).then(toUnknown);
  unknownCache.set(key, { at: now(), places });
  places.catch(() => unknownCache.delete(key));
  return places;
}

/** The places around `center` whose hours are unknown; empty while loading, off or failing. */
export function useUnknownPlaces(center: LatLng, on: boolean): UnknownPlace[] {
  const [places, setPlaces] = useState<UnknownPlace[]>([]);
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
    loadUnknown({ lat: k.lat, lng: k.lng }).then(
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

/**
 * Without an account, the pass from a photo read stands in for it (one place per photo). With
 * an account it is not needed and not sent.
 */
async function author(pass: string | null) {
  const token = await accessToken();
  return token || !pass ? { token } : { token, body: { deviceId: deviceId(), photoPass: pass } };
}

/** Adds a place (an account, or the pass from a photo); it is on the map at once. */
export async function addPlace(place: NewPlace, pass: string | null = null): Promise<string> {
  const by = await author(pass);
  const { id } = await api<{ id: string }>('places', {
    body: { regionId: region.id, ...place, ...by.body },
    token: by.token,
  });
  refreshPlaces();
  return id;
}

/** One correction: new hours, closed for good, or a private party until a time (null: over). */
export async function changePlace(
  id: string,
  change: { openingHours: string } | { closed: true } | { privateUntil: string | null },
  pass: string | null = null,
): Promise<void> {
  const by = await author(pass);
  await api('places/change', { body: { id, ...change, ...by.body }, token: by.token });
  refreshPlaces();
}

/** Reads a photo of a place's door into the add form, with a pass to add it without an account. */
export async function readPlacePhoto(photo: ShrunkPhoto): Promise<PlacePhotoResult> {
  return api<PlacePhotoResult>('places/photo', {
    body: {
      image: photo.data,
      mediaType: photo.mediaType,
      deviceId: deviceId(),
      regionId: region.id,
    },
    token: await accessToken(),
  });
}

/** Lower case, no accents, letters and digits only: "Kawiarnia Przykład!" → "kawiarniaprzyklad". */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]/gu, '');

/** Names as one: "Śluza bar cafe" and "Śluza" are the same place; "Bar" alone matches nothing. */
export function sameName(a: string, b: string): boolean {
  const x = fold(a);
  const y = fold(b);
  return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
}

/**
 * The places already listed at the pin, with hours or without: `named`, one whose name matches
 * within `places.sameWithinM` (the server merges those too), and `near`, the others within
 * `places.photo.listedWithinM`, nearest first, offered as "same place?" to compare by name. In a
 * city centre many places share an address, so nearness alone never decides.
 */
export function listedAt<P extends ListedPlace>(
  places: readonly P[],
  point: LatLng,
  name: string,
): { named: P | null; near: P[] } {
  const around = places
    .map((p) => ({ p, d: distanceM(point, p.point) }))
    .filter(({ d }) => d <= Math.max(cfg.sameWithinM, cfg.photo.listedWithinM))
    .sort((a, b) => a.d - b.d);
  const named = name.trim() ? (around.find(({ p }) => sameName(p.name, name))?.p ?? null) : null;
  const near = around
    .filter(({ p, d }) => p !== named && d <= cfg.photo.listedWithinM)
    .map(({ p }) => p);
  return { named, near };
}
