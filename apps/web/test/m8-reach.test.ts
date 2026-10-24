import type maplibregl from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { addDragRing, addReachCircle, dragRingColour, showDragRing } from '../src/reachCircle';

/** Just enough of a MapLibre map to record what gets added to its style. */
function fakeMap(sources: Record<string, { type: string }>) {
  const added = {
    sources: [] as string[],
    layers: [] as { id: string; layout?: object; paint?: object }[],
    data: [] as unknown[],
    visibility: {} as Record<string, string>,
  };
  const map = {
    getStyle: () => ({ sources, layers: [] }),
    getSource: (id: string) =>
      added.sources.includes(id) ? { setData: (d: unknown) => added.data.push(d) } : undefined,
    getLayer: (id: string) => added.layers.find((l) => l.id === id),
    addSource: (id: string) => added.sources.push(id),
    addLayer: (layer: { id: string; paint?: object }) => added.layers.push(layer),
    setLayoutProperty: (id: string, _prop: string, value: string) => (added.visibility[id] = value),
  };
  return { map: map as unknown as maplibregl.Map, added };
}

const centre = { lat: 50, lng: 20 };
// Day ink in both themes: the raster tiles stay light at night.
const ink = config.theme.themes.day.ink;

describe('the reach circle (M8 slice D)', () => {
  it('is not drawn on the vector map, where the veil shows the reach', () => {
    const { map, added } = fakeMap({ basemap: { type: 'vector' } });
    addReachCircle(map, centre, 1500);
    expect(added.sources).toEqual([]);
    expect(added.layers).toEqual([]);
  });

  it('is drawn, dashed and faintly filled, after a fallback to raster tiles', () => {
    const { map, added } = fakeMap({ osm: { type: 'raster' } });
    addReachCircle(map, centre, 1500);
    expect(added.sources).toEqual(['radius']);
    expect(added.layers).toEqual([
      {
        id: 'radius-fill',
        type: 'fill',
        source: 'radius',
        paint: { 'fill-color': ink, 'fill-opacity': 0.07 },
      },
      {
        id: 'radius-line',
        type: 'line',
        source: 'radius',
        paint: { 'line-color': ink, 'line-width': 2, 'line-dasharray': [2, 1.5] },
      },
    ]);
    // A second style load does not add it twice.
    addReachCircle(map, centre, 1500);
    expect(added.layers).toHaveLength(2);
  });
});

describe('the drag ring (M8 slice D)', () => {
  it('shows on the vector map only while the rail is dragged', () => {
    const { map, added } = fakeMap({ basemap: { type: 'vector' } });
    addDragRing(map, dragRingColour('night'));
    expect(added.layers).toEqual([
      {
        id: 'reach-drag',
        type: 'line',
        source: 'reach-drag',
        layout: { visibility: 'none' },
        paint: {
          'line-color': config.theme.themes.night.ink,
          'line-width': 2,
          'line-dasharray': [2, 1.5],
        },
      },
    ]);
    showDragRing(map, centre, 2000);
    expect(added.visibility['reach-drag']).toBe('visible');
    expect(added.data).toHaveLength(1);
    showDragRing(map, centre, null);
    expect(added.visibility['reach-drag']).toBe('none');
    expect(added.data).toHaveLength(1);
  });

  it('is bright at night and grey by day, where white would vanish into the roads', () => {
    expect(dragRingColour('night')).toBe(config.theme.themes.night.ink);
    expect(dragRingColour('day')).toBe(config.theme.themes.day.muted);
  });

  it('is not added on the raster fallback, whose circle follows the drag instead', () => {
    const { map, added } = fakeMap({ osm: { type: 'raster' } });
    addDragRing(map, dragRingColour('day'));
    showDragRing(map, centre, 2000);
    expect(added.layers).toEqual([]);
    expect(added.visibility).toEqual({});
  });
});
