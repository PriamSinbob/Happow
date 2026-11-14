import { getRegion, loadConfig, regionAt, type LatLng } from '@happow/core';

export const config = loadConfig();

/** The region this page runs in, kept on the device; the build's region until then. */
const REGION_KEY = 'happow.region';

function chosenRegion(): string | undefined {
  try {
    // `?region=krakow` opens that region (links, testing) and is remembered like a move.
    const asked = new URLSearchParams(location.search).get('region');
    if (asked && config.regions.some((r) => r.id === asked))
      localStorage.setItem(REGION_KEY, asked);
    return localStorage.getItem(REGION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export const region = getRegion(config, chosenRegion() ?? import.meta.env.VITE_REGION_ID);
export const categoriesById = new Map(config.categories.map((c) => [c.id, c]));

/**
 * When `p` lies in another configured region, remember it and reload the page into it (the
 * region is fixed for a page's lifetime). True when the page is about to reload.
 */
export function moveToRegionAt(p: LatLng): boolean {
  const there = regionAt(config, p);
  if (!there || there.id === region.id) return false;
  try {
    localStorage.setItem(REGION_KEY, there.id);
    if (localStorage.getItem(REGION_KEY) !== there.id) return false;
  } catch {
    return false;
  }
  location.reload();
  return true;
}
