import { useCallback, useEffect, useState } from 'react';
import type { PriceFilter, TimeWindow } from '@happow/core';
import { track } from '../analytics';
import { categoriesById, config } from '../config';
import { storage } from '../storage';

export interface FiltersState {
  window: TimeWindow;
  setWindow: (id: string) => void;
  categories: string[];
  toggleCategory: (id: string) => void;
  price: PriceFilter;
  setPrice: (p: PriceFilter) => void;
  /** Category and price filters in use (the time window is always set, so it does not count). */
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

function savedCategories(): string[] {
  try {
    const v: unknown = JSON.parse(storage.get('categories') ?? '[]');
    // Drop ids that are no longer in the taxonomy.
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && categoriesById.has(c)) : [];
  } catch {
    return [];
  }
}

/** Time window, categories and price, shared by map and list and remembered per device. */
export function useFilters(): FiltersState {
  const [timeWindow, setWindowState] = useState(savedWindow);
  const [categories, setCategories] = useState(savedCategories);
  const [price, setPrice] = useState<PriceFilter>(() => {
    const p = storage.get('price') as PriceFilter | null;
    return p && PRICES.includes(p) ? p : 'any';
  });

  useEffect(() => storage.set('window', timeWindow.id), [timeWindow]);
  useEffect(() => storage.set('categories', JSON.stringify(categories)), [categories]);
  useEffect(() => storage.set('price', price), [price]);

  const setWindow = useCallback((id: string) => {
    const w = config.app.timeWindows.find((x) => x.id === id);
    if (w) setWindowState(w);
    track('Filter', { type: 'window', value: id });
  }, []);
  const toggleCategory = useCallback((id: string) => {
    setCategories((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
    track('Filter', { type: 'category', value: id });
  }, []);
  const choosePrice = useCallback((p: PriceFilter) => {
    setPrice(p);
    track('Filter', { type: 'price', value: p });
  }, []);
  const clear = useCallback(() => {
    setCategories([]);
    setPrice('any');
  }, []);

  return {
    window: timeWindow,
    setWindow,
    categories,
    toggleCategory,
    price,
    setPrice: choosePrice,
    activeCount: categories.length + (price === 'any' ? 0 : 1),
    clear,
  };
}
