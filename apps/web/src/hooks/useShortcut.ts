import { useCallback, useEffect, useState } from 'react';
import { categoriesById } from '../config';
import { storage } from '../storage';
import type { FiltersState } from './useFilters';

/** What the chip beside the live counter switches: family mode or one category (slice G). */
export type ShortcutId = 'family' | (string & {});

export interface Shortcut {
  id: ShortcutId;
  on: boolean;
  toggle: () => void;
  /** Makes `id` the shortcut and turns it on; the previous one goes off first. */
  choose: (id: ShortcutId) => void;
}

function savedId(): ShortcutId {
  const s = storage.get('shortcut');
  return s && (s === 'family' || categoriesById.has(s)) ? s : 'family';
}

function savedPrevious(): string[] | null {
  try {
    const v: unknown = JSON.parse(storage.get('shortcutPrevious') ?? 'null');
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * The map shortcut (docs/design/map-shortcut.html). It works on the shared filter state, so the
 * settings sheet shows what it does. A category shortcut on = only that category; off = back to
 * the categories chosen before it was turned on.
 */
export function useShortcut(filters: FiltersState): Shortcut {
  const [id, setId] = useState(savedId);
  const [previous, setPrevious] = useState(savedPrevious);
  useEffect(() => storage.set('shortcut', id), [id]);
  useEffect(() => storage.set('shortcutPrevious', JSON.stringify(previous)), [previous]);

  const isOn = (x: ShortcutId) =>
    x === 'family'
      ? filters.family
      : filters.categories.length === 1 && filters.categories[0] === x;
  const on = isOn(id);
  // Turned off elsewhere (the sheet, Clear): the saved choice from before no longer applies.
  useEffect(() => {
    if (!on && previous !== null) setPrevious(null);
  }, [on, previous]);

  const turnOn = useCallback(
    (x: ShortcutId) => {
      if (x === 'family') return filters.setFamily(true);
      setPrevious(filters.categories);
      filters.setCategories([x]);
    },
    [filters],
  );
  const turnOff = useCallback(
    (x: ShortcutId) => {
      if (x === 'family') return filters.setFamily(false);
      filters.setCategories(previous ?? []);
      setPrevious(null);
    },
    [filters, previous],
  );

  return {
    id,
    on,
    toggle: () => (on ? turnOff(id) : turnOn(id)),
    choose: (x) => {
      if (x === id) {
        if (!on) turnOn(x);
        return;
      }
      if (on) {
        // Switching from one category to another keeps the categories from before the first.
        if (id !== 'family' && x !== 'family') {
          setId(x);
          filters.setCategories([x]);
          return;
        }
        turnOff(id);
      }
      setId(x);
      turnOn(x);
    },
  };
}
