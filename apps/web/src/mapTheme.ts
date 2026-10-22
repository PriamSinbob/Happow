import { useEffect, useRef, type RefObject } from 'react';
import type maplibregl from 'maplibre-gl';
import { themeLayerPaint, type ThemeTokens } from '@happow/core';
import { config } from './config';
import { useTheme } from './theme';

/** Our own layers (radius, route): [layer id, paint property, theme token]. */
export type OwnLayerPaint = [string, string, keyof ThemeTokens][];

/**
 * Recolours the basemap (config/map.json `themeLayers`) and our own layers to a theme, in place:
 * no style reload, so switching day/night never flashes. The raster fallback has no matching
 * layers and keeps its colours.
 */
export function paintMapTheme(m: maplibregl.Map, tokens: ThemeTokens, own: OwnLayerPaint = []) {
  // isStyleLoaded() also waits for tiles; the layers exist as soon as the style is parsed.
  let ids: string[];
  try {
    ids = m.getStyle().layers.map((l) => l.id);
  } catch {
    return;
  }
  const paint = themeLayerPaint(config.map.themeLayers, ids, tokens);
  for (const [id, prop, token] of own)
    if (m.getLayer(id)) paint.push([id, prop, tokens[token] as string]);
  for (const [id, prop, colour] of paint)
    m.setPaintProperty(id, prop as never, colour, { validate: false });
}

/**
 * Keeps a map in the current theme: on every style load (first load, raster fallback) and on
 * every theme change. Call it after the effect that creates the map, so the map exists.
 */
export function useMapTheme(map: RefObject<maplibregl.Map | null>, own: OwnLayerPaint = []) {
  const { tokens } = useTheme();
  const latest = useRef({ tokens, own });
  latest.current = { tokens, own };
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const repaint = () => paintMapTheme(m, latest.current.tokens, latest.current.own);
    m.on('style.load', repaint);
    return () => {
      m.off('style.load', repaint);
    };
  }, [map]);
  useEffect(() => {
    if (map.current) paintMapTheme(map.current, tokens, latest.current.own);
  }, [map, tokens]);
}
