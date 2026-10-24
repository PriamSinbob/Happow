import type maplibregl from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { addReachCircle } from '../src/reachCircle';

/** Just enough of a MapLibre map to record what gets added to its style. */
function fakeMap(sources: Record<string, { type: string }>) {
  const added = { sources: [] as string[], layers: [] as { id: string; paint?: object }[] };
  const map = {
    getStyle: () => ({ sources, layers: [] }),
    getSource: (id: string) => (added.sources.includes(id) ? {} : undefined),
    addSource: (id: string) => added.sources.push(id),
    addLayer: (layer: { id: string; paint?: object }) => added.layers.push(layer),
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
