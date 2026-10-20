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
  if (!app.timeWindows.some((w) => w.id === app.defaultTimeWindow))
    errors.push(`defaultTimeWindow "${app.defaultTimeWindow}" is not in timeWindows`);
  for (const d of dupes(app.timeWindows.map((w) => w.id)))
    errors.push(`duplicate time window "${d}"`);
  for (const d of dupes(sources.map((s) => s.id))) errors.push(`duplicate source "${d}"`);
  const categoryIds = new Set(categories.map((c) => c.id));
  for (const s of sources) {
    for (const r of s.regionIds)
      if (!regions.some((reg) => reg.id === r))
        errors.push(`source "${s.id}" lists unknown region "${r}"`);
    for (const [label, c] of Object.entries(s.categoryMap))
      if (!categoryIds.has(c))
        errors.push(`source "${s.id}" maps "${label}" to unknown category "${c}"`);
    for (const c of s.defaultCategories)
      if (!categoryIds.has(c)) errors.push(`source "${s.id}" defaults to unknown category "${c}"`);
    for (const label of Object.keys(s.categoryMap))
      if (label !== label.toLowerCase())
        errors.push(`source "${s.id}" categoryMap key "${label}" must be lower-case`);
  }
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
