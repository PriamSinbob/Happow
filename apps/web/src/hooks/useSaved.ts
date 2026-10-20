import { useCallback, useState } from 'react';
import { storage } from '../storage';

function load(): string[] {
  try {
    const v: unknown = JSON.parse(storage.get('saved') ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Saved event ids, on this device only (no account in the PoC). */
export function useSaved(): { isSaved: (id: string) => boolean; toggle: (id: string) => void } {
  const [saved, setSaved] = useState(load);
  const toggle = useCallback((id: string) => {
    setSaved((s) => {
      const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-200);
      storage.set('saved', JSON.stringify(next));
      return next;
    });
  }, []);
  return { isSaved: useCallback((id: string) => saved.includes(id), [saved]), toggle };
}
