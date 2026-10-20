import type { DensityCluster, HappowEvent, LatLng } from './types.js';

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Initial great-circle bearing from `a` to `b`, 0–360° clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type CompassPoint = (typeof COMPASS)[number];

export function compassPoint(deg: number): CompassPoint {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/**
 * Group events (already filtered to the window and search radius, with distances from the user)
 * by density cell. Same rules as the `density_near` SQL function, for the offline repository.
 */
export function densityClusters(
  events: (HappowEvent & { distanceM: number })[],
  radiusM: number,
  cellOf: (e: HappowEvent) => string,
): DensityCluster[] {
  const groups = new Map<string, (HappowEvent & { distanceM: number })[]>();
  for (const e of events) {
    const cell = cellOf(e);
    groups.set(cell, [...(groups.get(cell) ?? []), e]);
  }
  const clusters: DensityCluster[] = [];
  for (const [cell, evs] of groups) {
    const outside = evs.filter((e) => e.distanceM > radiusM);
    const nearest = outside.reduce<(typeof outside)[number] | null>(
      (best, e) => (!best || e.distanceM < best.distanceM ? e : best),
      null,
    );
    const venues = new Map<string, number>();
    for (const e of evs)
      if (e.venue?.name) venues.set(e.venue.name, (venues.get(e.venue.name) ?? 0) + 1);
    const topVenue =
      [...venues.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    clusters.push({
      cell,
      center: {
        lat: evs.reduce((s, e) => s + e.point.lat, 0) / evs.length,
        lng: evs.reduce((s, e) => s + e.point.lng, 0) / evs.length,
      },
      count: evs.length,
      outsideCount: outside.length,
      nearestOutside: nearest ? { point: nearest.point, distanceM: nearest.distanceM } : null,
      topVenue,
    });
  }
  return clusters.sort((a, b) => b.count - a.count || a.cell.localeCompare(b.cell));
}

/** The busiest cell, if it has enough events to be worth pointing at. Ties go to the nearer one. */
export function hotspot(
  clusters: DensityCluster[],
  from: LatLng,
  minEvents: number,
  distance: (a: LatLng, b: LatLng) => number,
): DensityCluster | null {
  let best: DensityCluster | null = null;
  for (const c of clusters) {
    if (c.count < minEvents) continue;
    if (
      !best ||
      c.count > best.count ||
      (c.count === best.count && distance(from, c.center) < distance(from, best.center))
    )
      best = c;
  }
  return best;
}

/** Nearest matching event beyond the user's radius, across all clusters. */
export function nearestOutside(clusters: DensityCluster[]): DensityCluster['nearestOutside'] {
  let best: DensityCluster['nearestOutside'] = null;
  for (const c of clusters)
    if (c.nearestOutside && (!best || c.nearestOutside.distanceM < best.distanceM))
      best = c.nearestOutside;
  return best;
}
