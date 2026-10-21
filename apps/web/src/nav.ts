import type { LatLng } from '@happow/core';

/** Metres per degree around `lat` (flat approximation; fine for walking distances). */
function scale(lat: number): { kx: number; ky: number } {
  return { kx: 111_320 * Math.cos((lat * Math.PI) / 180), ky: 110_540 };
}

export function pathLength(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const { kx, ky } = scale(path[i]!.lat);
    total += Math.hypot(
      (path[i]!.lng - path[i - 1]!.lng) * kx,
      (path[i]!.lat - path[i - 1]!.lat) * ky,
    );
  }
  return total;
}

/**
 * Where the walker is relative to the route: how far off the line they are, and how much of the
 * route is left from the nearest point on it.
 */
export function progress(p: LatLng, path: LatLng[]): { offRouteM: number; remainingM: number } {
  if (path.length < 2) return { offRouteM: 0, remainingM: 0 };
  const { kx, ky } = scale(p.lat);
  let best = { d: Infinity, along: 0 };
  let along = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const ax = (a.lng - p.lng) * kx;
    const ay = (a.lat - p.lat) * ky;
    const dx = (b.lng - a.lng) * kx;
    const dy = (b.lat - a.lat) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    const seg = Math.sqrt(len2);
    if (d < best.d) best = { d, along: along + t * seg };
    along += seg;
  }
  return { offRouteM: best.d, remainingM: Math.max(0, along - best.along) };
}
