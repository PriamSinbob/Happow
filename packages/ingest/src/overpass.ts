/**
 * Overpass queries for OSM data (district boundaries, venues). Servers are tried in config order:
 * a public Overpass server can refuse a client or time out for hours, and a mirror usually still
 * answers. overpass-api.de answers 406 to a User-Agent with a URL in it, so the caller passes
 * `osm.userAgent`, not the crawler's.
 */

export interface OverpassOptions {
  urls: string[];
  userAgent: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

export async function overpass(query: string, opts: OverpassOptions): Promise<OverpassElement[]> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const errors: string[] = [];
  for (const url of opts.urls) {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': opts.userAgent,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      });
      if (!res.ok) {
        errors.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
      // A query that ran out of time or memory answers 200 with a remark and partial elements.
      if (body.remark && /error|timed out|out of memory/i.test(body.remark)) {
        errors.push(`${url}: ${body.remark}`);
        continue;
      }
      return body.elements ?? [];
    } catch (err) {
      errors.push(`${url}: ${(err as Error).message}`);
    }
  }
  throw new Error(`no Overpass server answered: ${errors.join('; ')}`);
}

/** Overpass QL bbox order: south, west, north, east. */
export function overpassBbox(b: { west: number; south: number; east: number; north: number }) {
  return `(${b.south},${b.west},${b.north},${b.east})`;
}
