import type { LatLng } from './types.js';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point reached from `origin` after `distance` metres on initial bearing `bearingDeg`. */
export function destination(origin: LatLng, distance: number, bearingDeg: number): LatLng {
  const δ = distance / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin.lat);
  const λ1 = toRad(origin.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Closed GeoJSON ring ([lng, lat] pairs) approximating a circle. */
export function circleRing(center: LatLng, radius: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destination(center, radius, (i * 360) / steps);
    ring.push([p.lng, p.lat]);
  }
  ring.push(ring[0]!);
  return ring;
}

/** Bounding box [west, south, east, north] of a circle. */
export function circleBounds(center: LatLng, radius: number): [number, number, number, number] {
  const n = destination(center, radius, 0);
  const e = destination(center, radius, 90);
  const s = destination(center, radius, 180);
  const w = destination(center, radius, 270);
  return [w.lng, s.lat, e.lng, n.lat];
}

export function walkingMinutes(distance: number, speedMPerMin: number): number {
  return Math.max(1, Math.round(distance / speedMPerMin));
}

export function isInBbox(
  p: LatLng,
  bbox: { west: number; south: number; east: number; north: number },
): boolean {
  return p.lng >= bbox.west && p.lng <= bbox.east && p.lat >= bbox.south && p.lat <= bbox.north;
}
