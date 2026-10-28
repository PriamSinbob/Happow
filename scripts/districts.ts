/**
 * `pnpm districts [region] [--from overpass.json]` writes a region's district boundaries (config/regions.json →
 * `districts`) from OpenStreetMap through Overpass, for the M12 metrics. Run by hand when the
 * districts change; the file is committed and `pnpm db:seed` loads it. Never runs in CI.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegion, loadConfig } from '@happow/core';
import { districtsFromOverpass, type OverpassRelation } from '@happow/core/districts';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = loadConfig();
const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
// A saved Overpass answer (same query, `out geom`), for when Overpass is busy or offline.
const from = fromAt >= 0 ? args.splice(fromAt, 2)[1] : undefined;
const region = getRegion(config, args[0] ?? config.app.defaultRegion);
if (!region.districts) throw new Error(`region "${region.id}" has no districts in regions.json`);

const { west, south, east, north } = region.bbox;
const query =
  `[out:json][timeout:90];` +
  `rel["boundary"="administrative"]["admin_level"="${region.districts.adminLevel}"]` +
  `(${south},${west},${north},${east});out geom;`;

async function overpass(): Promise<OverpassRelation[]> {
  const res = await fetch(config.app.osm.overpassUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': config.app.osm.userAgent,
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { elements: OverpassRelation[] }).elements;
}

const elements = from
  ? (JSON.parse(await readFile(from, 'utf8')) as { elements: OverpassRelation[] }).elements
  : await overpass();

const { collection, problems } = districtsFromOverpass(elements);
for (const p of problems) console.warn(`warning: ${p}`);

const out = root + region.districts.file;
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(collection) + '\n');
// The bbox can also catch a neighbouring town's districts: check the count and names.
console.log(
  `${collection.features.length} districts for ${region.id} → ${region.districts.file}: ` +
    collection.features.map((f) => f.properties.name).join(', '),
);
