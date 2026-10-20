import appJson from '../../../config/app.json';
import categoriesJson from '../../../config/categories.json';
import mapJson from '../../../config/map.json';
import regionsJson from '../../../config/regions.json';
import sourcesJson from '../../../config/sources.json';
import {
  appConfigSchema,
  categoriesConfigSchema,
  mapConfigSchema,
  regionsConfigSchema,
  sourcesConfigSchema,
} from './schemas.js';
import type { AppConfig, Category, MapConfig, Region, Source } from './types.js';

export interface HappowConfig {
  app: AppConfig;
  categories: Category[];
  regions: Region[];
  map: MapConfig;
  sources: Source[];
}

/** Parse and cross-check the JSON files in /config. Throws with a readable message on any mistake. */
export function loadConfig(): HappowConfig {
  const app = appConfigSchema.parse(appJson);
  const { categories } = categoriesConfigSchema.parse(categoriesJson);
  const { regions } = regionsConfigSchema.parse(regionsJson);
  const map = mapConfigSchema.parse(mapJson);
  const { sources } = sourcesConfigSchema.parse(sourcesJson);

  const errors: string[] = [];
  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of dupes(categories.map((c) => c.id))) errors.push(`duplicate category "${d}"`);
  for (const d of dupes(regions.map((r) => r.id))) errors.push(`duplicate region "${d}"`);
  if (!regions.some((r) => r.id === app.defaultRegion))
    errors.push(`defaultRegion "${app.defaultRegion}" is not in regions.json`);
  const { minM, maxM, defaultM } = app.radius;
  if (!(minM <= defaultM && defaultM <= maxM))
    errors.push('radius must satisfy minM ≤ defaultM ≤ maxM');
  for (const r of regions) {
    for (const s of r.enabledSources)
      if (!sources.some((src) => src.id === s))
        errors.push(`region "${r.id}" enables unknown source "${s}"`);
    try {
      new Intl.DateTimeFormat('en', { timeZone: r.timezone });
    } catch {
      errors.push(`region "${r.id}" has invalid timezone "${r.timezone}"`);
    }
  }
  if (errors.length) throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  return { app, categories, regions, map, sources };
}

export function getRegion(config: HappowConfig, id?: string): Region {
  const wanted = id || config.app.defaultRegion;
  return (
    config.regions.find((r) => r.id === wanted) ??
    config.regions.find((r) => r.id === config.app.defaultRegion)!
  );
}
