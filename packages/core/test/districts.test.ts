import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src';
import {
  assembleRings,
  districtsFromOverpass,
  inRing,
  simplifyLine,
  type DistrictCollection,
  type OverpassRelation,
  type Position,
} from '../src/districts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const geom = (pts: Position[]) => pts.map(([lon, lat]) => ({ lon, lat }));
const way = (pts: Position[], role = 'outer') => ({ type: 'way', role, geometry: geom(pts) });
const rel = (id: number, name: string, members: ReturnType<typeof way>[]): OverpassRelation => ({
  type: 'relation',
  id,
  tags: { name },
  members,
});

describe('assembleRings', () => {
  it('joins ways end to end, reversing where needed', () => {
    const { rings, open } = assembleRings([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 1],
        [1, 0],
      ],
      [
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ]);
    expect(open).toEqual([]);
    expect(rings).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ]);
  });

  it('returns a ring that never closes as open', () => {
    const { rings, open } = assembleRings([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [1, 1],
      ],
    ]);
    expect(rings).toEqual([]);
    expect(open).toHaveLength(1);
  });
});

describe('simplifyLine', () => {
  it('drops points closer than the tolerance and keeps the ends', () => {
    // About 1 m off the straight line at 51°N, then a 100 m corner.
    const line: Position[] = [
      [17, 51],
      [17.001, 51.00001],
      [17.002, 51],
      [17.002, 51.001],
    ];
    expect(simplifyLine(line, 10)).toEqual([
      [17, 51],
      [17.002, 51],
      [17.002, 51.001],
    ]);
    expect(simplifyLine(line, 0.1)).toEqual(line);
  });
});

describe('districtsFromOverpass', () => {
  const left: Position[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  // The border x = 1 is one way shared by both districts, as in OSM.
  const border: Position[] = [
    [1, 0],
    [1, 0.5],
    [1, 1],
  ];
  const leftRest: Position[] = [
    [1, 1],
    [0, 1],
    [0, 0],
    [1, 0],
  ];
  const rightRest: Position[] = [
    [1, 1],
    [2, 1],
    [2, 0],
    [1, 0],
  ];

  it('builds one MultiPolygon per relation, with holes inside their outer ring', () => {
    const hole: Position[] = [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.4],
    ];
    const { collection, problems } = districtsFromOverpass([
      rel(2, 'B', [way(border), way(rightRest)]),
      rel(1, 'A', [way(left), way(hole, 'inner')]),
    ]);
    expect(problems).toEqual([]);
    expect(collection.features.map((f) => [f.id, f.properties.name])).toEqual([
      ['1', 'A'],
      ['2', 'B'],
    ]);
    expect(collection.features[0]!.geometry.coordinates[0]).toHaveLength(2);
    expect(collection.attribution).toContain('OpenStreetMap');
  });

  it('gives neighbours the same simplified border', () => {
    const wiggly: Position[] = [
      [1, 0],
      [1.00001, 0.5],
      [1, 1],
    ];
    const { collection } = districtsFromOverpass([
      rel(1, 'A', [way(wiggly), way(leftRest)]),
      rel(2, 'B', [way(wiggly), way(rightRest)]),
    ]);
    const has = (ring: Position[], p: Position) => ring.some((q) => q[0] === p[0] && q[1] === p[1]);
    for (const f of collection.features) {
      const ring = f.geometry.coordinates[0]![0]!;
      expect(has(ring, [1.00001, 0.5])).toBe(false);
    }
  });

  it('leaves out a relation with no closed outer ring and says so', () => {
    const { collection, problems } = districtsFromOverpass([rel(3, 'C', [way(border)])]);
    expect(collection.features).toEqual([]);
    expect(problems).toEqual(['C: unclosed ways', 'C: no closed outer ring, left out']);
  });
});

describe('district files in config', () => {
  const config = loadConfig();

  it.each(config.regions.filter((r) => r.districts))('$id has a valid district file', (region) => {
    const file = JSON.parse(
      readFileSync(root + region.districts!.file, 'utf8'),
    ) as DistrictCollection;
    expect(file.type).toBe('FeatureCollection');
    expect(file.attribution).toContain('OpenStreetMap');
    expect(file.features.length).toBeGreaterThan(0);
    expect(new Set(file.features.map((f) => f.id)).size).toBe(file.features.length);
    for (const f of file.features)
      for (const poly of f.geometry.coordinates)
        for (const ring of poly) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring.at(-1));
        }
    // The region's centre lies in one of its districts.
    const c: Position = [region.center.lng, region.center.lat];
    expect(file.features.some((f) => f.geometry.coordinates.some((p) => inRing(c, p[0]!)))).toBe(
      true,
    );
  });
});
