import { useCallback, useEffect, useRef, useState } from 'react';
import { isInBbox, type LatLng, type Region } from '@happow/core';

export type LocationStatus = 'locating' | 'ok' | 'denied' | 'unavailable' | 'outside';

export interface LocationState {
  status: LocationStatus;
  /** The user's real position, when known. */
  position: LatLng | null;
  /** Where we search from: the user's position inside the region, otherwise the region centre. */
  center: LatLng;
  retry: () => void;
}

export function useGeolocation(region: Region): LocationState {
  const [status, setStatus] = useState<LocationStatus>('locating');
  const [position, setPosition] = useState<LatLng | null>(null);
  const watchId = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    setStatus((s) => (s === 'ok' ? s : 'locating'));
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPosition(here);
        setStatus(isInBbox(here, region.bbox) ? 'ok' : 'outside');
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
  }, [region]);

  useEffect(() => {
    start();
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [start]);

  const center = status === 'ok' && position ? position : region.center;
  return { status, position, center, retry: start };
}
