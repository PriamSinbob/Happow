import { useCallback, useState } from 'react';
import { config } from '../config';
import { storage } from '../storage';

const { minM, maxM, defaultM } = config.app.radius;

/** Radius in metres, remembered per device. */
export function useRadius(): [number, (r: number) => void] {
  const [radius, setRadiusState] = useState(() => {
    const saved = Number(storage.get('radius'));
    return saved >= minM && saved <= maxM ? saved : defaultM;
  });
  const setRadius = useCallback((r: number) => {
    storage.set('radius', String(r));
    setRadiusState(r);
  }, []);
  return [radius, setRadius];
}
