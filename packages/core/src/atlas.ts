import { z } from 'zod';
import type { AppConfig, LatLng } from './types.js';

/**
 * The local atlas (§6): which H3 cells the user has been in, kept on the device only. Pure
 * helpers for recording, the veil drawing and the JSON export; no DOM and no h3-js (the web app
 * loads h3-js lazily and passes cell ids and centres in).
 */
export interface AtlasCell {
  /** H3 cell id at `atlas.resolution`. */
  cell: string;
  /** Sessions in which the app was open in this cell. */
  opens: number;
  /** Going there trips that arrived in this cell. */
  arrivals: number;
  /** Last day seen, "2026-10-23": coarser than a timestamp on purpose. */
  lastSeen: string;
}

export type AtlasConfig = AppConfig['atlas'];
export type VisitKind = 'open' | 'arrival';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-23" in `timeZone`. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(at);
}

/** The record after one more visit. */
export function recordVisit(
  prev: AtlasCell | undefined,
  cell: string,
  kind: VisitKind,
  day: string,
): AtlasCell {
  const c = prev ?? { cell, opens: 0, arrivals: 0, lastSeen: day };
  return {
    cell,
    opens: c.opens + (kind === 'open' ? 1 : 0),
    arrivals: c.arrivals + (kind === 'arrival' ? 1 : 0),
    lastSeen: c.lastSeen > day ? c.lastSeen : day,
  };
}

/** An open is recorded once per cell per session, and only from a precise enough fix. */
export function shouldRecordOpen(
  fix: { cell: string; accuracyM: number },
  session: ReadonlySet<string>,
  maxAccuracyM: number,
): boolean {
  return fix.accuracyM <= maxAccuracyM && !session.has(fix.cell);
}

/** The app was hidden long enough that coming back starts a new session. */
export function isNewSession(hiddenAt: number | null, now: number, gapMin: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= gapMin * 60_000;
}

/** How clear a cell is under the veil, 0–1: arrivals strong, opens faint, repeats brighter. */
export function cellStrength(c: AtlasCell, s: AtlasConfig['strength']): number {
  const n = c.opens + c.arrivals;
  if (n <= 0) return 0;
  const base = c.arrivals > 0 ? s.arrival : s.open;
  return Math.min(1, base + s.repeat * Math.log2(n));
}

/** A small stable PRNG (FNV-1a seed, mulberry32): the same id gives the same numbers anywhere. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One soft hole in the veil, in units of the cell (or reach) radius: east, north, radius. */
export interface Blob {
  dx: number;
  dy: number;
  r: number;
}

/** A cell's jittered blobs, seeded by its id, so it looks the same on every redraw. */
export function cellBlobs(cell: string, count: number): Blob[] {
  const rnd = seededRandom(cell);
  return Array.from({ length: count }, () => {
    const angle = rnd() * Math.PI * 2;
    const d = rnd() * 0.55;
    return { dx: Math.cos(angle) * d, dy: Math.sin(angle) * d, r: 0.75 + rnd() * 0.5 };
  });
}

/** Four blobs on the rim of the reach, so its edge is a cloud and not a circle (prototype). */
export function rimBlobs(seed: string): Blob[] {
  const rnd = seededRandom(seed);
  return [0, 1, 2, 3].map((i) => {
    const angle = (i * Math.PI) / 2 + rnd() * 0.8;
    const d = 0.75 + rnd() * 0.2;
    return { dx: Math.cos(angle) * d, dy: Math.sin(angle) * d, r: 0.35 + rnd() * 0.15 };
  });
}

const EARTH_M = 40_075_016.686;
const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** The veil canvas's square in Web Mercator, so blobs line up with the basemap. */
export interface VeilBox {
  west: number;
  east: number;
  north: number;
  south: number;
  /** Top-left corner and side, in Mercator units (0–1 across the world). */
  x0: number;
  y0: number;
  size: number;
}

export function veilBox(centre: LatLng, radiusM: number): VeilBox {
  const half = radiusM / (EARTH_M * Math.cos((centre.lat * Math.PI) / 180));
  const x0 = mercX(centre.lng) - half;
  const y0 = mercY(centre.lat) - half;
  return {
    west: x0 * 360 - 180,
    east: (x0 + 2 * half) * 360 - 180,
    north: latOf(y0),
    south: latOf(y0 + 2 * half),
    x0,
    y0,
    size: 2 * half,
  };
}

/** Corners for a MapLibre image or canvas source: top-left, top-right, bottom-right, bottom-left. */
export function boxCorners(b: VeilBox): [number, number][] {
  return [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
  ];
}

/** A point on the canvas of `px` × `px`. */
export function toCanvasPx(p: LatLng, b: VeilBox, px: number): { x: number; y: number } {
  return { x: ((mercX(p.lng) - b.x0) / b.size) * px, y: ((mercY(p.lat) - b.y0) / b.size) * px };
}

/** Metres at `lat` as canvas pixels. */
export function metresToPx(m: number, b: VeilBox, px: number, lat: number): number {
  return (m / (EARTH_M * Math.cos((lat * Math.PI) / 180) * b.size)) * px;
}

/** Zoom expression for the veil's opacity: full from `full` in, gone at `gone` (city scale). */
export function veilFade(opacity: number, fade: AtlasConfig['fadeZoom']): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], fade.gone, 0, fade.full, opacity];
}

// ---- export and import ----

const count = z.number().int().min(0).max(1_000_000);
const cellRecord = z.object({
  cell: z.string().regex(/^8[0-9a-f]{14}$/),
  opens: count,
  arrivals: count,
  lastSeen: z.string().regex(DAY),
});

export const atlasFileSchema = z.object({
  format: z.literal('happow-atlas'),
  version: z.literal(1),
  exportedAt: z.string().regex(DAY),
  cells: z.array(cellRecord).max(500_000),
});
export type AtlasFile = z.infer<typeof atlasFileSchema>;

export function exportAtlas(cells: readonly AtlasCell[], day: string): AtlasFile {
  const sorted = [...cells].sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0));
  return {
    format: 'happow-atlas',
    version: 1,
    exportedAt: day,
    cells: sorted.map(({ cell, opens, arrivals, lastSeen }) => ({
      cell,
      opens,
      arrivals,
      lastSeen,
    })),
  };
}

export const atlasFileName = (day: string) => `happow-atlas-${day}.json`;

/**
 * The cells of an exported file, or null when it isn't one. Cells at another H3 resolution are
 * dropped (the second hex digit of an H3 cell id is its resolution).
 */
export function parseAtlas(json: unknown, resolution: number): AtlasCell[] | null {
  const parsed = atlasFileSchema.safeParse(json);
  if (!parsed.success) return null;
  const res = resolution.toString(16);
  return parsed.data.cells.filter((c) => c.cell[1] === res);
}

/**
 * Both atlases in one, cell by cell: the larger count and the later day. Idempotent, so
 * importing the same file twice changes nothing.
 */
export function mergeAtlas(a: readonly AtlasCell[], b: readonly AtlasCell[]): AtlasCell[] {
  const out = new Map(a.map((c) => [c.cell, { ...c }]));
  for (const c of b) {
    const prev = out.get(c.cell);
    out.set(
      c.cell,
      prev
        ? {
            cell: c.cell,
            opens: Math.max(prev.opens, c.opens),
            arrivals: Math.max(prev.arrivals, c.arrivals),
            lastSeen: prev.lastSeen > c.lastSeen ? prev.lastSeen : c.lastSeen,
          }
        : { ...c },
    );
  }
  return [...out.values()];
}
