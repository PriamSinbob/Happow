/**
 * District boundaries from OpenStreetMap (M12 slice A): an Overpass answer (`out geom`) for
 * `boundary=administrative` relations becomes a small GeoJSON file the seed loads. OSM stores a
 * boundary as separate ways, so they are joined into closed rings here. Each way is simplified
 * before joining: neighbouring districts share their border ways, so both get the same
 * simplified border and no gaps open between them.
 */

export type Position = [lng: number, lat: number];

export interface OverpassMember {
  type: string;
  role: string;
  geometry?: { lat: number; lon: number }[];
}

export interface OverpassRelation {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: OverpassMember[];
}

export interface DistrictFeature {
  type: 'Feature';
  id: string;
  properties: { name: string };
  geometry: { type: 'MultiPolygon'; coordinates: Position[][][] };
}

export interface DistrictCollection {
  type: 'FeatureCollection';
  attribution: string;
  features: DistrictFeature[];
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0';

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/**
 * Joins ways into closed rings, end to end, reversing a way where needed. Ways that never close
 * a ring are returned in `open` (a boundary cut by the query's bbox, or broken data).
 */
export function assembleRings(ways: Position[][]): { rings: Position[][]; open: Position[][] } {
  const pool = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const rings: Position[][] = [];
  const open: Position[][] = [];
  while (pool.length) {
    const ring = pool.shift()!;
    let grown = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grown) {
      grown = false;
      const end = ring[ring.length - 1]!;
      const i = pool.findIndex((w) => same(w[0]!, end) || same(w[w.length - 1]!, end));
      if (i < 0) break;
      const next = pool.splice(i, 1)[0]!;
      if (!same(next[0]!, end)) next.reverse();
      ring.push(...next.slice(1));
      grown = true;
    }
    if (same(ring[0]!, ring[ring.length - 1]!) && ring.length >= 4) rings.push(ring);
    else open.push(ring);
  }
  return { rings, open };
}

/** Douglas–Peucker on a line, tolerance in metres; the end points always stay. */
export function simplifyLine(line: Position[], toleranceM: number): Position[] {
  if (line.length <= 2 || toleranceM <= 0) return line;
  const lat0 = (line[0]![1] * Math.PI) / 180;
  const mx = 111_320 * Math.cos(lat0);
  const my = 110_540;
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = [line[a]![0] * mx, line[a]![1] * my];
    const [bx, by] = [line[b]![0] * mx, line[b]![1] * my];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = line[i]![0] * mx - ax;
      const py = line[i]![1] * my - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > toleranceM) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Ray casting; the ring is closed (first point = last point). */
export function inRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const round = (line: Position[], digits: number): Position[] => {
  const f = 10 ** digits;
  return line.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
};

export interface DistrictBuildResult {
  collection: DistrictCollection;
  /** Districts left out (no closed outer ring) or with ways that did not close, by name. */
  problems: string[];
}

/**
 * Overpass relations → districts. Inner rings become holes of the outer ring that holds them.
 * `toleranceM` simplifies each way (about 10 m keeps a district's shape at street level).
 */
export function districtsFromOverpass(
  elements: OverpassRelation[],
  opts: { toleranceM?: number; digits?: number } = {},
): DistrictBuildResult {
  const tol = opts.toleranceM ?? 10;
  const digits = opts.digits ?? 5;
  const problems: string[] = [];
  const features: DistrictFeature[] = [];
  for (const rel of elements) {
    if (rel.type !== 'relation' || !rel.tags?.name) continue;
    const ways = (role: (r: string) => boolean) =>
      (rel.members ?? [])
        .filter((m) => m.type === 'way' && m.geometry?.length && role(m.role))
        .map((m) =>
          round(
            simplifyLine(
              m.geometry!.map((g): Position => [g.lon, g.lat]),
              tol,
            ),
            digits,
          ),
        );
    const outer = assembleRings(ways((r) => r !== 'inner'));
    const inner = assembleRings(ways((r) => r === 'inner'));
    if (outer.open.length || inner.open.length) problems.push(`${rel.tags.name}: unclosed ways`);
    if (!outer.rings.length) {
      problems.push(`${rel.tags.name}: no closed outer ring, left out`);
      continue;
    }
    const polygons: Position[][][] = outer.rings.map((r) => [r]);
    for (const hole of inner.rings) {
      const holder = polygons.find((poly) => inRing(hole[0]!, poly[0]!));
      if (holder) holder.push(hole);
    }
    features.push({
      type: 'Feature',
      id: String(rel.id),
      properties: { name: rel.tags.name },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    });
  }
  // A stable order, so a rerun on unchanged OSM data gives the same file.
  features.sort((a, b) => Number(a.id) - Number(b.id));
  return {
    collection: { type: 'FeatureCollection', attribution: OSM_ATTRIBUTION, features },
    problems,
  };
}
