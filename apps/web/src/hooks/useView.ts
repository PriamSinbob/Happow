import { useCallback, useState } from 'react';
import type { PlanView } from '@happow/core';
import { config } from '../config';
import { storage } from '../storage';

const views = config.app.agenda.views;
const others = views.filter((v) => v !== 'all');

function saved(key: string, fallback: PlanView, from: readonly PlanView[]): PlanView {
  const v = storage.get(key);
  return v && (from as readonly string[]).includes(v) ? (v as PlanView) : fallback;
}

export interface ViewState {
  view: PlanView;
  /** The view a tap switches to from "everything": the last other one chosen. */
  last: PlanView;
  /** Tap: between everything and the last other view. */
  toggle: () => void;
  choose: (v: PlanView) => void;
}

/**
 * What the map and list show: everything, your plans, saved, private events. Remembered on the
 * device, like the map shortcut.
 */
export function useView(): ViewState {
  const [view, setView] = useState<PlanView>(() => saved('view', 'all', views));
  const [last, setLast] = useState<PlanView>(() => saved('viewLast', others[0]!, others));
  const choose = useCallback((v: PlanView) => {
    setView(v);
    storage.set('view', v);
    if (v !== 'all') {
      setLast(v);
      storage.set('viewLast', v);
    }
  }, []);
  return { view, last, choose, toggle: () => choose(view === 'all' ? last : 'all') };
}
