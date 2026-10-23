import type { AtlasCell } from '@happow/core';

/**
 * The local atlas in IndexedDB (§6): one record per H3 cell, on this device only. Never throws:
 * private mode or blocked storage gives an empty atlas, and the veil then lights the reach only.
 */
const DB = 'happow';
const STORE = 'atlas';

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: 'cell' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** One transaction; resolves true when it commits, false when storage is unavailable or fails. */
async function write(fn: (store: IDBObjectStore) => void): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export const atlasStore = {
  async all(): Promise<AtlasCell[]> {
    const db = await open();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as AtlasCell[]);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  },
  /** Writes (or replaces) these cells in one transaction. */
  put: (cells: readonly AtlasCell[]) => write((s) => cells.forEach((c) => s.put(c))),
  clear: () => write((s) => s.clear()),
};

/** Tests only: forget the open connection (fake-indexeddb is reset between tests). */
export function resetAtlasStore() {
  opening = null;
}
