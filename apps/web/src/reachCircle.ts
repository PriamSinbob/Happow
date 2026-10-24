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

const DRAG_SOURCE = 'reach-drag';
export const DRAG_LAYER = 'reach-drag';

/**
 * The drag ring's colour: bright on the night map, grey on the light day map, where white would
 * vanish into the roads (owner, 2026-10-24: "a bright grey/white dashed ring").
 */
export const dragRingColour = (theme: keyof typeof config.theme.themes) =>
  theme === 'night' ? config.theme.themes.night.ink : config.theme.themes.day.muted;

/**
 * The dashed ring shown on the vector map only while the reach rail is dragged: the veil redraws
 * at the rail's stops, so between them the ring shows the reach under the finger (owner,
 * 2026-10-24). Hidden until the first drag. The raster fallback has its circle instead.
 */
export function addDragRing(m: maplibregl.Map, colour: string) {
  if (!canVeil(m) || m.getSource(DRAG_SOURCE)) return;
  m.addSource(DRAG_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  m.addLayer({
    id: DRAG_LAYER,
    type: 'line',
    source: DRAG_SOURCE,
    layout: { visibility: 'none' },
    paint: { 'line-color': colour, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  });
}

/** Shows the drag ring at `radiusM`, or hides it when the drag ends (null). */
export function showDragRing(m: maplibregl.Map, center: LatLng, radiusM: number | null) {
  if (!m.getLayer(DRAG_LAYER)) return;
  if (radiusM !== null)
    (m.getSource(DRAG_SOURCE) as maplibregl.GeoJSONSource).setData(radiusFeature(center, radiusM));
  m.setLayoutProperty(DRAG_LAYER, 'visibility', radiusM === null ? 'none' : 'visible');
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
