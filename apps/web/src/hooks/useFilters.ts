import { useCallback, useEffect, useState } from 'react';
import type { PriceFilter, TimeWindow } from '@happow/core';
import { track } from '../analytics';
import { categoriesById, config } from '../config';
import { storage } from '../storage';

export interface FiltersState {
  window: TimeWindow;
  setWindow: (id: string) => void;
  categories: string[];
  /** Tap: show only this category, or stop showing only it; an excluded one becomes neutral. */
  toggleCategory: (id: string) => void;
  /** Categories hidden from everything (a hold on the chip): all but these are shown. */
  excluded: string[];
  /** Hold: hide this category, or stop hiding it. */
  toggleExcluded: (id: string) => void;
  price: PriceFilter;
  setPrice: (p: PriceFilter) => void;
  /** Replaces the chosen categories (the map shortcut, slice G); none of them stays excluded. */
  setCategories: (ids: string[]) => void;
  /** Family mode (§4.4): a setting on this device, never sent. */
  family: boolean;
  setFamily: (on: boolean) => void;
  /** Category, exclusion, price and family filters in use (the time window is always set, so it does not count). */
  activeCount: number;
  clear: () => void;
}

const PRICES: PriceFilter[] = ['any', 'free', 'paid'];

function savedWindow(): TimeWindow {
  const id = storage.get('window');
  const { timeWindows, defaultTimeWindow } = config.app;
  return (
    timeWindows.find((w) => w.id === id) ?? timeWindows.find((w) => w.id === defaultTimeWindow)!
  );
}

function savedCategories(key: 'categories' | 'excluded'): string[] {
  try {
    const v: unknown = JSON.parse(storage.get(key) ?? '[]');
    // Drop ids that are no longer in the taxonomy.
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && categoriesById.has(c)) : [];
  } catch {
    return [];
  }
}

const without = (ids: string[], id: string) => ids.filter((c) => c !== id);

/**
 * Time window, categories (shown only, or hidden), price and family mode, shared by map and list
 * and remembered per device. A category is in at most one of `categories` and `excluded`.
 */
export function useFilters(): FiltersState {
  const [timeWindow, setWindowState] = useState(savedWindow);
  const [categories, setCategories] = useState(() => savedCategories('categories'));
  const [excluded, setExcluded] = useState(() =>
    savedCategories('excluded').filter((c) => !categories.includes(c)),
  );
  const [price, setPrice] = useState<PriceFilter>(() => {
    const p = storage.get('price') as PriceFilter | null;
    return p && PRICES.includes(p) ? p : 'any';
  });
  const [family, setFamilyState] = useState(() => storage.get('family') === '1');

  useEffect(() => storage.set('window', timeWindow.id), [timeWindow]);
  useEffect(() => storage.set('categories', JSON.stringify(categories)), [categories]);
  useEffect(() => storage.set('excluded', JSON.stringify(excluded)), [excluded]);
  useEffect(() => storage.set('price', price), [price]);
  useEffect(() => storage.set('family', family ? '1' : '0'), [family]);

  const setWindow = useCallback((id: string) => {
    const w = config.app.timeWindows.find((x) => x.id === id);
    if (w) setWindowState(w);
    track('Filter', { type: 'window', value: id });
  }, []);
  const toggleCategory = useCallback(
    (id: string) => {
      if (excluded.includes(id)) setExcluded(without(excluded, id));
      else setCategories((cs) => (cs.includes(id) ? without(cs, id) : [...cs, id]));
      track('Filter', { type: 'category', value: id });
    },
    [excluded],
  );
  const toggleExcluded = useCallback(
    (id: string) => {
      if (excluded.includes(id)) setExcluded(without(excluded, id));
      else {
        setExcluded([...excluded, id]);
        setCategories((cs) => without(cs, id));
      }
      track('Filter', { type: 'exclude', value: id });
    },
    [excluded],
  );
  const choosePrice = useCallback((p: PriceFilter) => {
    setPrice(p);
    track('Filter', { type: 'price', value: p });
  }, []);
  const replaceCategories = useCallback((ids: string[]) => {
    const known = ids.filter((c) => categoriesById.has(c));
    setCategories(known);
    setExcluded((xs) => xs.filter((c) => !known.includes(c)));
    track('Filter', { type: 'categories', value: ids.join(',') });
  }, []);
  // Not tracked: family mode stays on the device (§4.4 privacy).
  const setFamily = setFamilyState;
  const clear = useCallback(() => {
    setCategories([]);
    setExcluded([]);
    setPrice('any');
    setFamilyState(false);
  }, []);

  return {
    window: timeWindow,
    setWindow,
    categories,
    toggleCategory,
    excluded,
    toggleExcluded,
    price,
    setPrice: choosePrice,
    setCategories: replaceCategories,
    family,
    setFamily,
    activeCount: categories.length + excluded.length + (price === 'any' ? 0 : 1) + (family ? 1 : 0),
    clear,
  };
}
