import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  atlasFileName,
  cellStrength,
  exportAtlas,
  isNewSession,
  localDay,
  mergeAtlas,
  parseAtlas,
  recordVisit,
  shouldRecordOpen,
  type AtlasCell,
  type LatLng,
  type VisitKind,
} from '@happow/core';
import { config, region } from '../config';
import { atlasStore } from './store';
import type { LitCell } from './veil';

const { atlas } = config.app;

type H3 = typeof import('@happow/core/h3');
let h3Loading: Promise<H3 | null> | null = null;
/** h3-js (~93 KB gzipped) loads after the first paint, so the cold open never waits for it. */
export const loadH3 = () => (h3Loading ??= import('@happow/core/h3').catch(() => null));

export interface Atlas {
  /** Lit cells with their centres; null until h3-js and the store are loaded. */
  lit: LitCell[] | null;
  cellRadiusM: number;
  count: number;
  /** Going there arrived at this point. */
  arrive: (point: LatLng) => void;
  /** Saves the atlas as JSON: the share sheet where it takes files, otherwise a download. */
  exportFile: () => Promise<boolean>;
  /** Merges an exported file; the number of new cells, or null when it isn't an atlas file. */
  importFile: (file: Blob) => Promise<number | null>;
  clear: () => Promise<void>;
}

const today = () => localDay(new Date(), region.timezone);

/** Blob.text() is missing on older WebViews; FileReader works everywhere. */
function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/**
 * The local atlas (§6): records the cells the user opens the app in (once per cell per session,
 * from precise fixes only) and the cells Going there arrives in. All on the device; nothing is
 * sent anywhere.
 */
export function useAtlas(position: LatLng | null, accuracyM: number | null): Atlas {
  const [h3, setH3] = useState<H3 | null>(null);
  const [cells, setCells] = useState<Map<string, AtlasCell> | null>(null);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const session = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 800));
    idle(() => {
      void loadH3().then((lib) => alive && setH3(lib));
      void atlasStore.all().then((all) => alive && setCells(new Map(all.map((c) => [c.cell, c]))));
    });
    return () => {
      alive = false;
    };
  }, []);

  // A cell counts once per session; hidden for `sessionGapMin` starts a new one.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else {
        if (isNewSession(hiddenAt, Date.now(), atlas.sessionGapMin)) session.current.clear();
        hiddenAt = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const visit = useCallback((cell: string, kind: VisitKind) => {
    const current = cellsRef.current;
    if (!current) return;
    const next = recordVisit(current.get(cell), cell, kind, today());
    const map = new Map(current).set(cell, next);
    cellsRef.current = map;
    setCells(map);
    void atlasStore.put([next]);
  }, []);

  useEffect(() => {
    if (!h3 || !cells || !position || accuracyM === null) return;
    const cell = h3.h3Cell(position, atlas.resolution);
    if (!shouldRecordOpen({ cell, accuracyM }, session.current, atlas.maxAccuracyM)) return;
    session.current.add(cell);
    visit(cell, 'open');
    // Only a new fix records; the cells changing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h3, cells !== null, position, accuracyM, visit]);

  const arrive = useCallback(
    (point: LatLng) => {
      void loadH3().then((lib) => lib && visit(lib.h3Cell(point, atlas.resolution), 'arrival'));
    },
    [visit],
  );

  const exportFile = useCallback(async () => {
    const day = today();
    const body = JSON.stringify(exportAtlas([...(cellsRef.current?.values() ?? [])], day));
    const name = atlasFileName(day);
    const file = new File([body], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return true;
      }
    } catch (e) {
      // The user closed the share sheet: nothing to report.
      if ((e as Error).name === 'AbortError') return false;
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }, []);

  const importFile = useCallback(async (file: Blob) => {
    let json: unknown;
    try {
      json = JSON.parse(await readText(file));
    } catch {
      return null;
    }
    const incoming = parseAtlas(json, atlas.resolution);
    const current = cellsRef.current;
    if (!incoming || !current) return null;
    const merged = mergeAtlas([...current.values()], incoming);
    const changed = merged.filter((c) => {
      const prev = current.get(c.cell);
      return (
        !prev ||
        prev.opens !== c.opens ||
        prev.arrivals !== c.arrivals ||
        prev.lastSeen !== c.lastSeen
      );
    });
    await atlasStore.put(changed);
    const map = new Map(merged.map((c) => [c.cell, c]));
    cellsRef.current = map;
    setCells(map);
    return merged.length - current.size;
  }, []);

  const clear = useCallback(async () => {
    await atlasStore.clear();
    const map = new Map<string, AtlasCell>();
    cellsRef.current = map;
    setCells(map);
  }, []);

  const lit = useMemo(
    () =>
      h3 && cells
        ? [...cells.values()].map((c) => ({
            cell: c.cell,
            centre: h3.h3Centre(c.cell),
            strength: cellStrength(c, atlas.strength),
          }))
        : null,
    [h3, cells],
  );
  const cellRadiusM = useMemo(() => (h3 ? h3.h3EdgeM(atlas.resolution) : 200), [h3]);

  return {
    lit,
    cellRadiusM,
    count: cells?.size ?? 0,
    arrive,
    exportFile,
    importFile,
    clear,
  };
}
