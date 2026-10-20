import { getRegion, loadConfig } from '@happow/core';

export const config = loadConfig();
export const region = getRegion(config, import.meta.env.VITE_REGION_ID);
export const categoriesById = new Map(config.categories.map((c) => [c.id, c]));
