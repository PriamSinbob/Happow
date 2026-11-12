import type maplibregl from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import type { ThemePreset, ThemeName, ThemeTokens } from '@happow/core';
import { addPinSprites, PIN_PX } from './pinSprites';

/** Event pins: one GeoJSON source, a few symbol layers. */
export const PIN_SOURCE = 'pins';
/** Layers a tap can hit, top first. */
export const PIN_HIT_LAYERS = ['pin-disc', 'pin-ring'];

const FONT = ['Noto Sans Bold'];
const get = (p: string): ExpressionSpecification => ['get', p];
const isKind = (k: string): ExpressionSpecification => ['==', get('kind'), k];
const notCluster: ExpressionSpecification = ['!', get('cluster')];

/**
 * Sizes: live 34 px, soon 26 px, later 10 px; outside ×0.85; selected ×1.3 (and never the
 * smaller outside size). Pins beyond the reach keep full opacity: they must read through the veil.
 */
const scale = (base: ExpressionSpecification | number): ExpressionSpecification => [
  '*',
  base,
  ['case', get('selected'), 1.3, get('outside'), 0.85, 1],
];
const opacity = 1;
/** The selected pin's ring and the paper under it: around the live ring, closer on smaller pins. */
const selectScale = (live: number, other: number): ExpressionSpecification =>
  scale(['match', get('kind'), 'live', live, other]);
const isSelected: ExpressionSpecification = ['all', notCluster, get('selected')];
const common = {
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'text-allow-overlap': true,
  'text-ignore-placement': true,
  // Higher z draws on top: selected, then live, soon, later; inside the radius over outside.
  'symbol-sort-key': get('z'),
  'symbol-z-order': 'auto',
} as const;

/** The "!" of an unseen update: a disc this wide at the pin's upper right, in the pin colour. */
const NEWS_PX = 18;
const NEWS_TEXT = 15;
/** How far from the pin's centre it sits: by a glyph pin's edge, closer on a 10 px dot. */
const NEWS_FAR = 13;
const NEWS_NEAR = 8;

/** Open places: their own source, drawn under the event pins. */
export const PLACE_SOURCE = 'places';
export const PLACE_HIT_LAYERS = ['place-disc'];
/** A place is a 22 px paper pin with a muted outline: smaller than any event with a glyph. */
const PLACE_PX = 22;

function addPlaceLayers(m: maplibregl.Map) {
  if (m.getSource(PLACE_SOURCE)) return;
  m.addSource(PLACE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const size = (base: number): ExpressionSpecification => [
    '*',
    base,
    ['case', get('selected'), 1.3, 1],
  ];
  const selectedOnTop: ExpressionSpecification = ['case', get('selected'), 1, 0];
  const layout = { ...common, 'symbol-sort-key': selectedOnTop };
  const layer = (id: string, image: ExpressionSpecification | string, base: number) =>
    m.addLayer({
      id,
      type: 'symbol',
      source: PLACE_SOURCE,
      layout: { ...layout, 'icon-image': image, 'icon-size': size(base) },
    } as maplibregl.SymbolLayerSpecification);
  layer('place-disc', 'pin-disc', PLACE_PX / PIN_PX);
  layer('place-outline', 'pin-outline', PLACE_PX / PIN_PX);
  layer('place-glyph', ['concat', 'glyph-', get('glyph')], 0.66);
  // A private party is on: the lock at the lower left, as on a private event's pin.
  m.addLayer({
    id: 'place-lock',
    type: 'symbol',
    source: PLACE_SOURCE,
    filter: get('party'),
    layout: { ...layout, 'icon-image': 'pin-lock', 'icon-offset': [-10, 9] },
    paint: { 'icon-halo-width': 2 },
  } as maplibregl.SymbolLayerSpecification);
}

/** Adds the sprites, the sources and the layers once per style (first load, raster fallback). */
export function addPinLayers(m: maplibregl.Map) {
  addPinSprites(m);
  addPlaceLayers(m);
  if (m.getSource(PIN_SOURCE)) return;
  m.addSource(PIN_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const layer = (spec: Omit<maplibregl.SymbolLayerSpecification, 'type' | 'source'>) =>
    m.addLayer({
      type: 'symbol',
      source: PIN_SOURCE,
      ...spec,
    } as maplibregl.SymbolLayerSpecification);
  // The selected pin: a paper disc and an ink ring around it, so it stands out among live pins.
  layer({
    id: 'pin-select-bed',
    filter: isSelected,
    layout: { ...common, 'icon-image': 'pin-disc', 'icon-size': selectScale(1.7, 1.2) },
    paint: { 'icon-opacity': 0.6 },
  });
  layer({
    id: 'pin-select',
    filter: isSelected,
    layout: { ...common, 'icon-image': 'pin-select', 'icon-size': selectScale(1, 0.7) },
  });
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
        ['match', get('kind'), 'live', 1, ['soon', 'day'], 26 / PIN_PX, 10 / PIN_PX],
      ]),
    },
    paint: { 'icon-opacity': opacity },
  });
  layer({
    id: 'pin-outline',
    filter: [
      'all',
      notCluster,
      ['any', isKind('soon'), isKind('day'), ['all', isKind('live'), get('late')]],
    ],
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
  // Possibly off (cancelled, moved, closed): a "!" at the lower right, as the card explains.
  layer({
    id: 'pin-flag',
    filter: ['all', notCluster, get('flagged')],
    layout: {
      ...common,
      'text-field': '!',
      'text-font': FONT,
      'text-size': 13,
      'text-offset': [1.3, 1.1],
    },
    paint: { 'text-opacity': opacity, 'text-halo-width': 3 },
  });
  // A private event (yours, or one you're invited to) carries a lock at the lower left.
  layer({
    id: 'pin-lock',
    filter: ['all', notCluster, get('locked')],
    layout: { ...common, 'icon-image': 'pin-lock', 'icon-offset': [-13, 11] },
    paint: { 'icon-opacity': opacity, 'icon-halo-width': 2 },
  });
  // A followed artist's event carries a star at the upper left.
  layer({
    id: 'pin-star',
    filter: ['all', notCluster, get('starred')],
    layout: { ...common, 'icon-image': 'pin-star', 'icon-offset': [-13, -11] },
    paint: { 'icon-opacity': opacity, 'icon-halo-width': 2 },
  });
  // An update not seen yet (saved and "going" events only): a large "!" at the upper right in the
  // preset's pin colour, on any pin, a cluster included.
  // It takes the age badge's corner while it shows.
  layer({
    id: 'pin-news-bed',
    filter: get('news'),
    layout: {
      ...common,
      'icon-image': 'pin-disc',
      'icon-size': NEWS_PX / PIN_PX,
      // icon-offset counts in the sprite's own pixels, before icon-size.
      'icon-offset': [
        'case',
        isKind('later'),
        ['literal', [(NEWS_NEAR * PIN_PX) / NEWS_PX, (-NEWS_NEAR * PIN_PX) / NEWS_PX]],
        ['literal', [(NEWS_FAR * PIN_PX) / NEWS_PX, (-NEWS_FAR * PIN_PX) / NEWS_PX]],
      ],
    },
    paint: { 'icon-opacity': opacity, 'icon-halo-width': 1.5 },
  });
  layer({
    id: 'pin-news',
    filter: get('news'),
    layout: {
      ...common,
      'text-field': '!',
      'text-font': FONT,
      'text-size': NEWS_TEXT,
      'text-offset': [
        'case',
        isKind('later'),
        ['literal', [NEWS_NEAR / NEWS_TEXT, -NEWS_NEAR / NEWS_TEXT]],
        ['literal', [NEWS_FAR / NEWS_TEXT, -NEWS_FAR / NEWS_TEXT]],
      ],
    },
    paint: { 'text-opacity': opacity },
  });
  // "16+" / "18+" at the upper right. Numerals only, no translation.
  layer({
    id: 'pin-age',
    filter: ['all', notCluster, ['!=', get('age'), ''], ['!', get('news')]],
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

/** Pin colours for a theme and preset: the live hue only on live pins. */
export function pinPaint(
  t: ThemeTokens,
  preset: ThemePreset,
  name: ThemeName,
): [string, string, unknown][] {
  const { live, onLive } = preset[name];
  return [
    ['place-disc', 'icon-color', t.paper],
    ['place-outline', 'icon-color', ['case', get('selected'), t.ink, t.muted]],
    ['place-glyph', 'icon-color', t.ink],
    ['pin-select-bed', 'icon-color', t.paper],
    ['pin-select', 'icon-color', t.ink],
    ['pin-ring', 'icon-color', live],
    [
      'pin-disc',
      'icon-color',
      [
        'case',
        get('cluster'),
        t.ink,
        ['match', get('kind'), 'live', live, ['soon', 'day'], t.paper, t.ink],
      ],
    ],
    ['pin-outline', 'icon-color', ['match', get('kind'), 'live', onLive, 'day', t.muted, live]],
    ['pin-glyph', 'icon-color', ['match', get('kind'), 'live', onLive, t.ink]],
    ['pin-count', 'text-color', ['case', get('cluster'), t.paper, t.ink]],
    ['pin-count', 'text-halo-color', ['case', get('cluster'), t.ink, t.paper]],
    ['pin-flag', 'text-color', t.warnInk],
    ['pin-flag', 'text-halo-color', t.warn],
    ['pin-lock', 'icon-color', t.ink],
    ['pin-lock', 'icon-halo-color', t.paper],
    ['pin-star', 'icon-color', t.ink],
    ['pin-star', 'icon-halo-color', t.paper],
    ['place-lock', 'icon-color', t.ink],
    ['place-lock', 'icon-halo-color', t.paper],
    ['pin-news-bed', 'icon-color', live],
    ['pin-news-bed', 'icon-halo-color', t.paper],
    ['pin-news', 'text-color', onLive],
    ['pin-age', 'text-color', t.ink],
    ['pin-age', 'text-halo-color', t.paper],
  ];
}

export function applyPinPaint(m: maplibregl.Map, paint: [string, string, unknown][]) {
  for (const [id, prop, value] of paint)
    if (m.getLayer(id)) m.setPaintProperty(id, prop as never, value as never, { validate: false });
}
