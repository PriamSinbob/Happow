import type maplibregl from 'maplibre-gl';
import { RING_STEPS } from '@happow/core';

/**
 * Pin sprites drawn in code: shapes go onto a canvas as alpha masks, become signed distance
 * fields (the TinySDF method), and are added with `sdf: true`. Colour is then a paint property
 * (`icon-color`), so day/night and presets never rebuild a sprite.
 */

const RATIO = 2;
/** SDF spread in device pixels; MapLibre reads the edge at alpha 192 (cutoff 0.25). */
const RADIUS = 8;
const CUTOFF = 0.25;
const BUFFER = RADIUS;

/** Logical sizes (CSS px) of the sprite artwork; icon-size scales from these. */
export const PIN_PX = 34;
const RING_PX = 44;
const GLYPH_PX = 18;

type Draw = (c: CanvasRenderingContext2D) => void;

/** Category glyphs on a 24-unit grid, line style (2-unit round strokes). */
const GLYPHS: Record<string, Draw> = {
  note: (c) => {
    c.beginPath();
    c.arc(8, 17, 3, 0, Math.PI * 2);
    c.moveTo(11, 17);
    c.lineTo(11, 4);
    c.lineTo(18, 7);
    c.stroke();
  },
  mask: (c) => {
    c.beginPath();
    c.moveTo(5, 5);
    c.lineTo(19, 5);
    c.quadraticCurveTo(19, 21, 12, 21);
    c.quadraticCurveTo(5, 21, 5, 5);
    c.moveTo(8.5, 10);
    c.lineTo(10.5, 10);
    c.moveTo(13.5, 10);
    c.lineTo(15.5, 10);
    c.moveTo(9, 15);
    c.quadraticCurveTo(12, 17.5, 15, 15);
    c.stroke();
  },
  film: (c) => {
    c.beginPath();
    c.rect(4, 5, 16, 14);
    c.moveTo(8, 5);
    c.lineTo(8, 19);
    c.moveTo(16, 5);
    c.lineTo(16, 19);
    c.moveTo(4, 12);
    c.lineTo(20, 12);
    c.stroke();
  },
  frame: (c) => {
    c.beginPath();
    c.rect(4, 4, 16, 16);
    c.moveTo(4, 17);
    c.lineTo(10, 11);
    c.lineTo(14, 15);
    c.lineTo(16, 13);
    c.lineTo(20, 17);
    c.stroke();
    c.beginPath();
    c.arc(15, 8.5, 1.5, 0, Math.PI * 2);
    c.stroke();
  },
  tent: (c) => {
    c.beginPath();
    c.moveTo(3, 20);
    c.lineTo(12, 5);
    c.lineTo(21, 20);
    c.closePath();
    c.moveTo(12, 20);
    c.lineTo(12, 13);
    c.moveTo(12, 5);
    c.lineTo(12, 2.5);
    c.stroke();
  },
  spark: (c) => {
    c.beginPath();
    c.moveTo(12, 3);
    c.quadraticCurveTo(13, 11, 21, 12);
    c.quadraticCurveTo(13, 13, 12, 21);
    c.quadraticCurveTo(11, 13, 3, 12);
    c.quadraticCurveTo(11, 11, 12, 3);
    c.stroke();
  },
  ball: (c) => {
    c.beginPath();
    c.arc(12, 12, 8.5, 0, Math.PI * 2);
    c.moveTo(3.5, 12);
    c.lineTo(20.5, 12);
    c.moveTo(12, 3.5);
    c.quadraticCurveTo(7, 12, 12, 20.5);
    c.moveTo(12, 3.5);
    c.quadraticCurveTo(17, 12, 12, 20.5);
    c.stroke();
  },
  basket: (c) => {
    c.beginPath();
    c.moveTo(3, 10);
    c.lineTo(21, 10);
    c.lineTo(18.5, 20);
    c.lineTo(5.5, 20);
    c.closePath();
    c.moveTo(7, 10);
    c.quadraticCurveTo(12, 1, 17, 10);
    c.moveTo(12, 13);
    c.lineTo(12, 17);
    c.stroke();
  },
  tag: (c) => {
    c.beginPath();
    c.moveTo(3, 3);
    c.lineTo(12, 3);
    c.lineTo(21, 12);
    c.lineTo(12, 21);
    c.lineTo(3, 12);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.arc(8, 8, 1.5, 0, Math.PI * 2);
    c.stroke();
  },
  kite: (c) => {
    c.beginPath();
    c.moveTo(12, 2.5);
    c.lineTo(18, 9);
    c.lineTo(12, 16);
    c.lineTo(6, 9);
    c.closePath();
    c.moveTo(12, 16);
    c.quadraticCurveTo(9, 18.5, 12, 19.5);
    c.quadraticCurveTo(15, 20.5, 12, 22);
    c.stroke();
  },
  cup: (c) => {
    c.beginPath();
    c.moveTo(4, 9);
    c.lineTo(16, 9);
    c.lineTo(15, 20);
    c.lineTo(5, 20);
    c.closePath();
    c.moveTo(16, 11);
    c.quadraticCurveTo(21, 11, 20, 15);
    c.quadraticCurveTo(19, 17, 15.5, 17);
    c.moveTo(8, 3);
    c.lineTo(8, 6);
    c.moveTo(12, 3);
    c.lineTo(12, 6);
    c.stroke();
  },
  mic: (c) => {
    c.beginPath();
    c.moveTo(9, 7);
    c.arc(12, 7, 3, Math.PI, 0);
    c.lineTo(15, 12);
    c.arc(12, 12, 3, 0, Math.PI);
    c.closePath();
    c.moveTo(6, 11);
    c.quadraticCurveTo(6, 17.5, 12, 17.5);
    c.quadraticCurveTo(18, 17.5, 18, 11);
    c.moveTo(12, 17.5);
    c.lineTo(12, 21);
    c.stroke();
  },
  candle: (c) => {
    c.beginPath();
    c.rect(8.5, 10, 7, 11);
    c.moveTo(12, 10);
    c.lineTo(12, 8);
    c.moveTo(12, 2.5);
    c.quadraticCurveTo(15.5, 6, 12, 7.5);
    c.quadraticCurveTo(8.5, 6, 12, 2.5);
    c.stroke();
  },
  dot: (c) => {
    c.beginPath();
    c.arc(12, 12, 3.5, 0, Math.PI * 2);
    c.fill();
  },
};

export const GLYPH_IDS = Object.keys(GLYPHS);

/** Every sprite id the pin layers use. */
export function spriteIds(): string[] {
  return [
    'pin-disc',
    'pin-outline',
    'pin-outline-dashed',
    'ring-dotted',
    ...Array.from({ length: RING_STEPS }, (_, i) => `ring-${i + 1}`),
    ...GLYPH_IDS.map((g) => `glyph-${g}`),
  ];
}

function sdfImage(size: number, draw: Draw) {
  const px = Math.ceil(size * RATIO) + 2 * BUFFER;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const c = canvas.getContext('2d')!;
  c.translate(BUFFER, BUFFER);
  c.scale(RATIO, RATIO);
  c.fillStyle = c.strokeStyle = '#000';
  c.lineCap = c.lineJoin = 'round';
  draw(c);
  const { data } = c.getImageData(0, 0, px, px);
  return { width: px, height: px, data: toSdf(data, px, px) };
}

/** Adds every pin sprite to a map (once per style; cheap: about 30 small images). */
export function addPinSprites(m: maplibregl.Map) {
  const add = (id: string, size: number, draw: Draw) => {
    if (!m.hasImage(id)) m.addImage(id, sdfImage(size, draw), { sdf: true, pixelRatio: RATIO });
  };
  const half = PIN_PX / 2;
  add('pin-disc', PIN_PX, (c) => {
    c.beginPath();
    c.arc(half, half, half - 1, 0, Math.PI * 2);
    c.fill();
  });
  const outline = (dashed: boolean) => (c: CanvasRenderingContext2D) => {
    c.lineWidth = 3;
    if (dashed) c.setLineDash([4, 3.5]);
    c.beginPath();
    c.arc(half, half, half - 2.5, 0, Math.PI * 2);
    c.stroke();
  };
  add('pin-outline', PIN_PX, outline(false));
  add('pin-outline-dashed', PIN_PX, outline(true));
  const r = RING_PX / 2;
  const ring = (fraction: number, dotted: boolean) => (c: CanvasRenderingContext2D) => {
    c.lineWidth = 3.5;
    if (dotted) c.setLineDash([0.1, 5]);
    c.beginPath();
    const start = -Math.PI / 2;
    c.arc(r, r, r - 2.5, start, start + Math.PI * 2 * fraction);
    c.stroke();
  };
  for (let i = 1; i <= RING_STEPS; i++)
    // The smallest step keeps an 8 % stub until the event ends (§4.1).
    add(`ring-${i}`, RING_PX, ring(Math.max(0.08, i / RING_STEPS), false));
  add('ring-dotted', RING_PX, ring(1, true));
  for (const [id, draw] of Object.entries(GLYPHS))
    add(`glyph-${id}`, GLYPH_PX, (c) => {
      c.scale(GLYPH_PX / 24, GLYPH_PX / 24);
      c.lineWidth = 2;
      draw(c);
    });
}

// TinySDF (ISC, Mapbox): squared Euclidean distance transform over the alpha channel.
const INF = 1e20;

function toSdf(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  edt(outer, w, h);
  edt(inner, w, h);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(outer[i]!) - Math.sqrt(inner[i]!);
    out[i * 4 + 3] = Math.round(255 - 255 * (d / RADIUS + CUTOFF));
  }
  return out;
}

function edt(grid: Float64Array, w: number, h: number) {
  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const v = new Uint16Array(len);
  const z = new Float64Array(len + 1);
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

function edt1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array,
) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset]!;
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride]!;
    const q2 = q * q;
    do {
      const r = v[k]!;
      s = (f[q]! - f[r]! + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k]! && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1]! < q) k++;
    const r = v[k]!;
    grid[offset + q * stride] = f[r]! + (q - r) * (q - r);
  }
}
