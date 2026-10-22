import type maplibregl from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import type { ThemePreset, ThemeName, ThemeTokens } from '@happow/core';
import { addPinSprites, PIN_PX } from './pinSprites';

/** Event pins: one GeoJSON source, a few symbol layers (§4.3). */
export const PIN_SOURCE = 'pins';
/** Layers a tap can hit, top first. */
export const PIN_HIT_LAYERS = ['pin-disc', 'pin-ring'];

const FONT = ['Noto Sans Bold'];
const get = (p: string): ExpressionSpecification => ['get', p];
const isKind = (k: string): ExpressionSpecification => ['==', get('kind'), k];
const notCluster: ExpressionSpecification = ['!', get('cluster')];

/** §4.1 sizes: live 34 px, soon 26 px, later 10 px; outside ×0.85; selected ×1.2. */
const scale = (base: ExpressionSpecification | number): ExpressionSpecification => [
  '*',
  base,
  ['case', get('selected'), 1.2, 1],
  ['case', get('outside'), 0.85, 1],
];
const opacity: ExpressionSpecification = ['case', get('selected'), 1, get('outside'), 0.5, 1];
const common = {
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'text-allow-overlap': true,
  'text-ignore-placement': true,
  // Higher z draws on top: selected, then live, soon, later; inside the radius over outside.
  'symbol-sort-key': get('z'),
  'symbol-z-order': 'auto',
} as const;

/** Adds the sprites, the source and the layers once per style (first load, raster fallback). */
export function addPinLayers(m: maplibregl.Map) {
  addPinSprites(m);
  if (m.getSource(PIN_SOURCE)) return;
  m.addSource(PIN_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const layer = (spec: Omit<maplibregl.SymbolLayerSpecification, 'type' | 'source'>) =>
    m.addLayer({
      type: 'symbol',
      source: PIN_SOURCE,
      ...spec,
    } as maplibregl.SymbolLayerSpecification);
  layer({
    id: 'pin-ring',
    filter: ['all', notCluster, isKind('live')],
    layout: { ...common, 'icon-image': get('ring'), 'icon-size': scale(1) },
    paint: { 'icon-opacity': opacity },
  });
  layer({
    id: 'pin-disc',
    layout: {
      ...common,
      'icon-image': 'pin-disc',
      'icon-size': scale([
        'case',
        get('cluster'),
        1.1,
        ['match', get('kind'), 'live', 1, 'soon', 26 / PIN_PX, 10 / PIN_PX],
      ]),
    },
    paint: { 'icon-opacity': opacity },
  });
  layer({
    id: 'pin-outline',
    filter: ['all', notCluster, ['any', isKind('soon'), ['all', isKind('live'), get('late')]]],
    layout: {
      ...common,
      'icon-image': ['case', get('late'), 'pin-outline-dashed', 'pin-outline'],
      'icon-size': scale(['match', get('kind'), 'live', 1, 26 / PIN_PX]),
    },
    paint: { 'icon-opacity': opacity },
  });
  layer({
    id: 'pin-glyph',
    filter: ['all', notCluster, ['!', isKind('later')]],
    layout: {
      ...common,
      'icon-image': ['concat', 'glyph-', get('glyph')],
      'icon-size': scale(['match', get('kind'), 'live', 1, 0.8]),
    },
    paint: { 'icon-opacity': opacity },
  });
  // Cluster counts in the middle; a place with several events gets a count at the upper left.
  layer({
    id: 'pin-count',
    filter: ['any', get('cluster'), ['>', get('count'), 1]],
    layout: {
      ...common,
      'text-field': ['to-string', get('count')],
      'text-font': FONT,
      'text-size': 12,
      'text-offset': ['case', get('cluster'), ['literal', [0, 0]], ['literal', [-1.3, -1.3]]],
    },
    paint: { 'text-opacity': opacity, 'text-halo-width': 2 },
  });
  // §4.4: "16+" / "18+" at the upper right. Numerals only, no translation.
  layer({
    id: 'pin-age',
    filter: ['all', notCluster, ['!=', get('age'), '']],
    layout: {
      ...common,
      'text-field': get('age'),
      'text-font': FONT,
      'text-size': 10,
      'text-offset': [1.5, -1.4],
    },
    paint: { 'text-opacity': opacity, 'text-halo-width': 2 },
  });
}

/** Pin colours for a theme and preset: the live hue only on live pins (§3.2). */
export function pinPaint(
  t: ThemeTokens,
  preset: ThemePreset,
  name: ThemeName,
): [string, string, unknown][] {
  const { live, onLive } = preset[name];
  return [
    ['pin-ring', 'icon-color', live],
    [
      'pin-disc',
      'icon-color',
      [
        'case',
        get('cluster'),
        t.ink,
        ['match', get('kind'), 'live', live, 'soon', t.paper, t.muted],
      ],
    ],
    ['pin-outline', 'icon-color', ['match', get('kind'), 'live', onLive, live]],
    ['pin-glyph', 'icon-color', ['match', get('kind'), 'live', onLive, t.ink]],
    ['pin-count', 'text-color', ['case', get('cluster'), t.paper, t.ink]],
    ['pin-count', 'text-halo-color', ['case', get('cluster'), t.ink, t.paper]],
    ['pin-age', 'text-color', t.ink],
    ['pin-age', 'text-halo-color', t.paper],
  ];
}

export function applyPinPaint(m: maplibregl.Map, paint: [string, string, unknown][]) {
  for (const [id, prop, value] of paint)
    if (m.getLayer(id)) m.setPaintProperty(id, prop as never, value as never, { validate: false });
}
