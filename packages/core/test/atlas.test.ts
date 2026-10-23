import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  atlasFileName,
  boxCorners,
  cellBlobs,
  cellStrength,
  checkTokens,
  exportAtlas,
  isNewSession,
  loadConfig,
  localDay,
  mergeAtlas,
  metresToPx,
  parseAtlas,
  recordVisit,
  rimBlobs,
  seededRandom,
  shouldRecordOpen,
  toCanvasPx,
  veilBox,
  veilFade,
  type AtlasCell,
} from '../src';

const { app, theme } = loadConfig();
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
const rynek = { lat: 51.11, lng: 17.032 };

describe('recording visits', () => {
  it('counts opens and arrivals apart and keeps the later day', () => {
    let c = recordVisit(undefined, '891e2040887ffff', 'open', '2026-10-22');
    c = recordVisit(c, '891e2040887ffff', 'arrival', '2026-10-23');
    c = recordVisit(c, '891e2040887ffff', 'open', '2026-10-21');
    expect(c).toEqual({ cell: '891e2040887ffff', opens: 2, arrivals: 1, lastSeen: '2026-10-23' });
  });

  it('records an open once per cell per session, and only from a precise fix', () => {
    const session = new Set(['891e2040887ffff']);
    const max = app.atlas.maxAccuracyM;
    expect(shouldRecordOpen({ cell: '891e2040887ffff', accuracyM: 10 }, session, max)).toBe(false);
    expect(shouldRecordOpen({ cell: '891e2040897ffff', accuracyM: 10 }, session, max)).toBe(true);
    expect(shouldRecordOpen({ cell: '891e2040897ffff', accuracyM: 500 }, session, max)).toBe(false);
  });

  it('starts a new session after the app was hidden long enough', () => {
    const gap = app.atlas.sessionGapMin;
    expect(isNewSession(null, 1e9, gap)).toBe(false);
    expect(isNewSession(0, gap * 60_000 - 1, gap)).toBe(false);
    expect(isNewSession(0, gap * 60_000, gap)).toBe(true);
  });

  it('names the day in the region time zone', () => {
    expect(localDay(new Date('2026-10-23T22:30:00Z'), 'Europe/Warsaw')).toBe('2026-10-24');
    expect(localDay(new Date('2026-10-23T21:30:00Z'), 'Europe/Warsaw')).toBe('2026-10-23');
  });
});

describe('veil strength and blobs', () => {
  const s = app.atlas.strength;
  const cell = (opens: number, arrivals: number): AtlasCell => ({
    cell: '891e2040887ffff',
    opens,
    arrivals,
    lastSeen: '2026-10-23',
  });

  it('makes opens faint, arrivals strong and repeats brighter, up to 1', () => {
    expect(cellStrength(cell(0, 0), s)).toBe(0);
    expect(cellStrength(cell(1, 0), s)).toBeCloseTo(s.open);
    expect(cellStrength(cell(0, 1), s)).toBeCloseTo(s.arrival);
    expect(cellStrength(cell(4, 0), s)).toBeCloseTo(s.open + 2 * s.repeat);
    expect(cellStrength(cell(4, 0), s)).toBeGreaterThan(cellStrength(cell(2, 0), s));
    expect(cellStrength(cell(500, 500), s)).toBe(1);
  });

  it('seeds the same blobs from the same cell id, and different ones from another', () => {
    const a = cellBlobs('891e2040887ffff', app.atlas.blobsPerCell);
    expect(cellBlobs('891e2040887ffff', app.atlas.blobsPerCell)).toEqual(a);
    expect(cellBlobs('891e2040897ffff', app.atlas.blobsPerCell)).not.toEqual(a);
    expect(a).toHaveLength(app.atlas.blobsPerCell);
    for (const b of a) {
      expect(Math.hypot(b.dx, b.dy)).toBeLessThanOrEqual(0.55);
      expect(b.r).toBeGreaterThanOrEqual(0.75);
      expect(b.r).toBeLessThanOrEqual(1.25);
    }
    const rnd = seededRandom('x');
    const first = [rnd(), rnd()];
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(rimBlobs('reach')).toEqual(rimBlobs('reach'));
  });
});

describe('veil box (Web Mercator)', () => {
  const r = app.atlas.veilRadiusM;
  const px = app.atlas.canvasPx;
  const box = veilBox(rynek, r);

  it('puts the centre in the middle and the radius at half the canvas', () => {
    const c = toCanvasPx(rynek, box, px);
    expect(c.x).toBeCloseTo(px / 2, 6);
    expect(c.y).toBeCloseTo(px / 2, 6);
    expect(metresToPx(r, box, px, rynek.lat)).toBeCloseTo(px / 2, 6);
  });

  it('gives MapLibre corners clockwise from the top-left', () => {
    const [tl, tr, br, bl] = boxCorners(box);
    expect(tl![0]).toBeLessThan(tr![0]);
    expect(tl![1]).toBeGreaterThan(bl![1]);
    expect(br).toEqual([tr![0], bl![1]]);
    const nw = toCanvasPx({ lat: box.north, lng: box.west }, box, px);
    expect(nw.x).toBeCloseTo(0, 6);
    expect(nw.y).toBeCloseTo(0, 6);
    const se = toCanvasPx({ lat: box.south, lng: box.east }, box, px);
    expect(se.x).toBeCloseTo(px, 6);
    expect(se.y).toBeCloseTo(px, 6);
  });

  it('is about 2 × the radius wide on the ground', () => {
    const widthM = (box.east - box.west) * 111_320 * Math.cos((rynek.lat * Math.PI) / 180);
    expect(widthM).toBeGreaterThan(2 * r * 0.99);
    expect(widthM).toBeLessThan(2 * r * 1.01);
  });

  it('fades by zoom: full close in, gone at city scale', () => {
    expect(veilFade(0.74, app.atlas.fadeZoom)).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      app.atlas.fadeZoom.gone,
      0,
      app.atlas.fadeZoom.full,
      0.74,
    ]);
  });
});

describe('export and import', () => {
  it('reads a recorded file and drops cells at another resolution', () => {
    const cells = parseAtlas(fixture('atlas-v1.json'), app.atlas.resolution)!;
    expect(cells).toHaveLength(4);
    expect(cells.find((c) => c.cell === '881e2040d5fffff')).toBeUndefined();
  });

  it('rejects malformed files', () => {
    expect(parseAtlas(fixture('atlas-bad.json'), 9)).toBeNull();
    expect(parseAtlas({ format: 'other' }, 9)).toBeNull();
    expect(parseAtlas('nonsense', 9)).toBeNull();
    expect(parseAtlas(null, 9)).toBeNull();
  });

  it('round-trips through an export', () => {
    const cells = parseAtlas(fixture('atlas-v1.json'), 9)!;
    const file = exportAtlas(cells, '2026-10-23');
    expect(file.format).toBe('happow-atlas');
    expect(parseAtlas(JSON.parse(JSON.stringify(file)), 9)).toEqual(
      [...cells].sort((a, b) => a.cell.localeCompare(b.cell)),
    );
    expect(atlasFileName('2026-10-23')).toBe('happow-atlas-2026-10-23.json');
  });

  it('merges by the larger count and the later day, so a re-import changes nothing', () => {
    const file = parseAtlas(fixture('atlas-v1.json'), 9)!;
    const mine: AtlasCell[] = [
      { cell: '891e2040887ffff', opens: 2, arrivals: 3, lastSeen: '2026-10-24' },
      { cell: '891e2040d57ffff', opens: 1, arrivals: 0, lastSeen: '2026-10-24' },
    ];
    const once = mergeAtlas(mine, file);
    expect(once).toHaveLength(5);
    expect(once.find((c) => c.cell === '891e2040887ffff')).toEqual({
      cell: '891e2040887ffff',
      opens: 4,
      arrivals: 3,
      lastSeen: '2026-10-24',
    });
    const sort = (x: AtlasCell[]) => [...x].sort((a, b) => a.cell.localeCompare(b.cell));
    expect(sort(mergeAtlas(once, file))).toEqual(sort(once));
  });
});

describe('veil tokens', () => {
  it('keeps veilOpacity within the rule in both themes', () => {
    const dim = { ...theme.themes.day, veilOpacity: 0.95 };
    expect(checkTokens('day', dim, theme).join()).toMatch(/veilOpacity/);
    expect(checkTokens('night', theme.themes.night, theme)).toEqual([]);
  });
});
