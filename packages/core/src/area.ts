import type { LatLng } from './types.js';

/**
 * The shared snapshot behind the map: events within `radiusM` of a grid point, for the next
 * hours. Everyone in the same grid square with a similar radius asks for the same snapshot, so
 * the server and Cloudflare can cache it; the phone filters it locally (radius, time window,
 * categories, price) without another request.
 */
export interface AreaKey {
  lat: number;
  lng: number;
  radiusM: number;
}

export interface AreaSettings {
  areaGridDeg: number;
  areaRadiiM: number[];
}

const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));

/** Grid point nearest to `center`, and the smallest snapshot radius that covers `needM` from it. */
export function areaKey(center: LatLng, needM: number, s: AreaSettings): AreaKey {
  const lat = round(center.lat, s.areaGridDeg);
  const lng = round(center.lng, s.areaGridDeg);
  const radii = [...s.areaRadiiM].sort((a, b) => a - b);
  return { lat, lng, radiusM: radii.find((r) => r >= needM) ?? radii[radii.length - 1]! };
}

/** Is this a key the client could have produced (on the grid, a configured radius)? */
export function isAreaKey(k: AreaKey, s: AreaSettings): boolean {
  const onGrid = (v: number) => Math.abs(round(v, s.areaGridDeg) - v) < 1e-6;
  return onGrid(k.lat) && onGrid(k.lng) && s.areaRadiiM.includes(k.radiusM);
}

/** Farthest a user can be from their grid point: half the cell diagonal, in metres. */
export function areaSlackM(lat: number, s: AreaSettings): number {
  const half = s.areaGridDeg / 2;
  const dLat = half * 111_320;
  const dLng = half * 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.ceil(Math.hypot(dLat, dLng));
}

/** Start of the snapshot's time span: now, rounded down to the refresh step. */
export function areaFrom(now: Date, stepMinutes: number): Date {
  const step = stepMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / step) * step);
}
