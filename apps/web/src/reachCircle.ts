import type maplibregl from 'maplibre-gl';
import { circleRing, type LatLng } from '@happow/core';
import { canVeil } from './atlas/veil';
import { config } from './config';

export const RADIUS_SOURCE = 'radius';

/**
 * Day ink in both themes: the raster tiles stay light at night, so the night ink (near white)
 * would not show on them. The theme does not recolour the circle.
 */
export const RADIUS_COLOUR = config.theme.themes.day.ink;

export function radiusFeature(center: LatLng, radiusM: number) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [circleRing(center, radiusM)] },
  };
}

/**
 * The dashed reach circle, only where no veil shows the reach: the raster fallback (M8 §1).
 * On the vector map the veil's lit disc marks the reach instead.
 */
export function addReachCircle(m: maplibregl.Map, center: LatLng, radiusM: number) {
  if (canVeil(m) || m.getSource(RADIUS_SOURCE)) return;
  m.addSource(RADIUS_SOURCE, { type: 'geojson', data: radiusFeature(center, radiusM) });
  m.addLayer({
    id: 'radius-fill',
    type: 'fill',
    source: RADIUS_SOURCE,
    paint: { 'fill-color': RADIUS_COLOUR, 'fill-opacity': 0.07 },
  });
  m.addLayer({
    id: 'radius-line',
    type: 'line',
    source: RADIUS_SOURCE,
    paint: { 'line-color': RADIUS_COLOUR, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  });
}
