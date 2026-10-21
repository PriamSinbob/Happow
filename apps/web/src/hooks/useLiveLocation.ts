import { useEffect, useState } from 'react';
import type { LatLng } from '@happow/core';

export interface LiveLocation {
  position: LatLng | null;
  accuracy: number | null;
  denied: boolean;
}

/**
 * Continuous, precise GPS for the length of a trip only: on while `active` and the app is on
 * screen, off the moment the trip ends, the screen closes or the app goes to the background.
 */
export function useLiveLocation(active: boolean): LiveLocation {
  const [state, setState] = useState<LiveLocation>({
    position: null,
    accuracy: null,
    denied: false,
  });

  useEffect(() => {
    if (!active || !('geolocation' in navigator)) return;
    let id: number | null = null;
    const start = () => {
      if (id !== null || document.visibilityState !== 'visible') return;
      id = navigator.geolocation.watchPosition(
        (p) =>
          setState({
            position: { lat: p.coords.latitude, lng: p.coords.longitude },
            accuracy: p.coords.accuracy,
            denied: false,
          }),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setState((s) => ({ ...s, denied: true }));
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
      );
    };
    const stop = () => {
      if (id !== null) navigator.geolocation.clearWatch(id);
      id = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  return state;
}
