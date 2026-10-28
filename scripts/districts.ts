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
import { overpass, overpassBbox } from '@happow/ingest';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = loadConfig();
const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
// A saved Overpass answer (same query, `out geom`), for when Overpass is busy or offline.
const from = fromAt >= 0 ? args.splice(fromAt, 2)[1] : undefined;
const region = getRegion(config, args[0] ?? config.app.defaultRegion);
if (!region.districts) throw new Error(`region "${region.id}" has no districts in regions.json`);

const query =
  `[out:json][timeout:90];` +
  `rel["boundary"="administrative"]["admin_level"="${region.districts.adminLevel}"]` +
  `${overpassBbox(region.bbox)};out geom;`;

const elements = from
  ? (JSON.parse(await readFile(from, 'utf8')) as { elements: OverpassRelation[] }).elements
  : ((await overpass(query, {
      urls: config.app.osm.overpassUrls,
      userAgent: config.app.osm.userAgent,
    })) as OverpassRelation[]);

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
