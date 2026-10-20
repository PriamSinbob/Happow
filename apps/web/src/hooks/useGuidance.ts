import { useMemo } from 'react';
import {
  bearing,
  compassPoint,
  distanceM,
  hotspot,
  nearestOutside,
  snapRadiusUp,
  type CompassPoint,
  type DensityCluster,
  type LatLng,
} from '@happow/core';
import { config } from '../config';

export interface Pointer {
  point: LatLng;
  distanceM: number;
  direction: CompassPoint;
}

export interface Guidance {
  /** Busiest cell within the search radius, if it has enough events. */
  hotspot: (DensityCluster & Pointer) | null;
  /** Nearest matching event beyond the user's circle. */
  nearest: Pointer | null;
  /** Smallest radius that would include the nearest event, if the slider can reach it. */
  expandTo: number | null;
}

const { minM, maxM } = config.app.radius;

export function pointerTo(from: LatLng, to: LatLng, distance = distanceM(from, to)): Pointer {
  return { point: to, distanceM: distance, direction: compassPoint(bearing(from, to)) };
}

/** Where to send the user when the circle is empty, and what to mark as the hotspot. */
export function useGuidance(clusters: DensityCluster[], center: LatLng, radiusM: number): Guidance {
  return useMemo(() => {
    const top = hotspot(clusters, center, config.app.density.hotspotMinEvents, distanceM);
    const near = nearestOutside(clusters);
    const expandTo = near ? snapRadiusUp(near.distanceM + 10, minM, maxM) : null;
    return {
      hotspot: top ? { ...top, ...pointerTo(center, top.center) } : null,
      nearest: near ? pointerTo(center, near.point, near.distanceM) : null,
      expandTo: expandTo !== null && expandTo > radiusM ? expandTo : null,
    };
  }, [clusters, center, radiusM]);
}
