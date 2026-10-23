import type maplibregl from 'maplibre-gl';
import type { CanvasSource, GeoJSONSource } from 'maplibre-gl';
import {
  boxCorners,
  cellBlobs,
  metresToPx,
  rimBlobs,
  toCanvasPx,
  veilFade,
  type LatLng,
  type ThemeTokens,
  type VeilBox,
} from '@happow/core';
import { config } from '../config';

const { atlas } = config.app;

/** A lit cell, ready to draw: its centre (from h3-js) and how clear it is (0–1). */
export interface LitCell {
  cell: string;
  centre: LatLng;
  strength: number;
}

export interface VeilScene {
  box: VeilBox;
  colour: string;
  cells: readonly LitCell[];
  cellRadiusM: number;
  reach: { centre: LatLng; radiusM: number };
}

/** Each blob's gradient reaches this far past its radius, so neighbours blend into one cloud. */
const SPREAD = 1.3;
/** Five overlapping blobs per cell; each cuts this share of the cell's strength. */
const PER_BLOB = 1 / 1.6;

const SPRITE_PX = 64;
let sprite: HTMLCanvasElement | null | undefined;

/**
 * One soft blob, drawn once and stamped with drawImage: about 10× faster than a new radial
 * gradient per blob. Null where canvas is unavailable (tests); holes then use gradients.
 */
function blobSprite(): HTMLCanvasElement | null {
  if (sprite !== undefined) return sprite;
  const c = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return (sprite = null);
  c.width = c.height = SPRITE_PX;
  const h = SPRITE_PX / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return (sprite = c);
}

function hole(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  const img = blobSprite();
  if (img) {
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, x - r, y - r, 2 * r, 2 * r);
    ctx.globalAlpha = 1;
    return;
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.7})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Paints the veil: the theme's veil colour, with soft holes cut out (`destination-out`) for each
 * lit cell and for the reach. Overlapping holes compound, so repeat visits read clearer. Returns
 * the number of holes cut.
 */
export function drawVeil(ctx: CanvasRenderingContext2D, s: VeilScene): number {
  const px = ctx.canvas.width;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, px, px);
  ctx.fillStyle = s.colour;
  ctx.fillRect(0, 0, px, px);
  ctx.globalCompositeOperation = 'destination-out';
  let holes = 0;
  const cellPx = metresToPx(s.cellRadiusM, s.box, px, s.reach.centre.lat);
  const margin = cellPx * 2 * SPREAD;
  for (const c of s.cells) {
    if (c.strength <= 0) continue;
    const at = toCanvasPx(c.centre, s.box, px);
    if (at.x < -margin || at.y < -margin || at.x > px + margin || at.y > px + margin) continue;
    for (const b of cellBlobs(c.cell, atlas.blobsPerCell)) {
      // dy points north, canvas y points down.
      hole(
        ctx,
        at.x + b.dx * cellPx,
        at.y - b.dy * cellPx,
        b.r * cellPx * SPREAD,
        c.strength * PER_BLOB,
      );
      holes++;
    }
  }
  // The reach is always lit: a soft disc with a cloudy rim (prototype).
  const r = metresToPx(s.reach.radiusM, s.box, px, s.reach.centre.lat);
  const c = toCanvasPx(s.reach.centre, s.box, px);
  hole(ctx, c.x, c.y, r * 1.35, 1);
  hole(ctx, c.x, c.y, r * 1.1, 0.6);
  holes += 2;
  for (const b of rimBlobs('reach')) {
    hole(ctx, c.x + b.dx * r, c.y - b.dy * r, b.r * r, 0.45);
    holes++;
  }
  ctx.globalCompositeOperation = 'source-over';
  return holes;
}

export const VEIL_SOURCE = 'veil';
const OUTER_SOURCE = 'veil-outer';
export const VEIL_LAYERS = ['veil-outer', 'veil'] as const;

/** The world with the canvas box cut out: veiled the same way, so panning never shows colour. */
function outerFeature(box: VeilBox) {
  const corners = boxCorners(box);
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-180, 85],
          [180, 85],
          [180, -85],
          [-180, -85],
          [-180, 85],
        ],
        [...corners, corners[0]!].reverse(),
      ],
    },
  };
}

/** The veil goes on the vector basemap only, under its labels (owner, 2026-10-23). */
export function canVeil(m: maplibregl.Map): boolean {
  try {
    return Object.values(m.getStyle().sources).some((s) => s.type === 'vector');
  } catch {
    return false;
  }
}

/** The first basemap label layer: the veil goes under it, so street names stay readable. */
function firstLabel(m: maplibregl.Map): string | undefined {
  return m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

/** Adds the veil's sources and layers; call on style load, before our own layers. */
export function addVeil(m: maplibregl.Map, canvas: HTMLCanvasElement, box: VeilBox) {
  if (m.getSource(VEIL_SOURCE) || !canVeil(m)) return;
  const before = firstLabel(m);
  m.addSource(OUTER_SOURCE, { type: 'geojson', data: outerFeature(box) });
  m.addLayer(
    { id: 'veil-outer', type: 'fill', source: OUTER_SOURCE, paint: { 'fill-antialias': false } },
    before,
  );
  m.addSource(VEIL_SOURCE, {
    type: 'canvas',
    canvas,
    coordinates: boxCorners(box) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ],
    animate: false,
  });
  m.addLayer(
    {
      id: 'veil',
      type: 'raster',
      source: VEIL_SOURCE,
      paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
    },
    before,
  );
}

/** The veil's colour and zoom fade; both are style values, so nothing runs while zooming. */
export function paintVeil(m: maplibregl.Map, tokens: ThemeTokens) {
  if (!m.getLayer('veil')) return;
  const fade = veilFade(tokens.veilOpacity, atlas.fadeZoom);
  m.setPaintProperty('veil', 'raster-opacity', fade as never);
  m.setPaintProperty('veil-outer', 'fill-opacity', fade as never);
  m.setPaintProperty('veil-outer', 'fill-color', tokens.veil);
}

/** Moves the canvas box (a new snapshot centre). */
export function moveVeil(m: maplibregl.Map, box: VeilBox) {
  (m.getSource(OUTER_SOURCE) as GeoJSONSource | undefined)?.setData(outerFeature(box));
  (m.getSource(VEIL_SOURCE) as CanvasSource | undefined)?.setCoordinates(
    boxCorners(box) as [[number, number], [number, number], [number, number], [number, number]],
  );
}

/**
 * Hands a redrawn canvas to the GPU once. A non-animated canvas source uploads its texture only
 * while playing; pause() uploads it and stops, so no frame after this one touches the canvas.
 */
export function uploadVeil(m: maplibregl.Map) {
  const src = m.getSource(VEIL_SOURCE) as CanvasSource | undefined;
  if (!src) return;
  src.play();
  src.pause();
}
