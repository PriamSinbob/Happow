import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '@happow/core';
import { config, region } from '../config';
import { useMapTheme } from '../mapTheme';
import { rasterStyle } from './MapView';

/** Small map for the add-event form: tap to place the pin, drag it to adjust. */
export function PinMap({
  point,
  onChange,
  label,
}: {
  point: LatLng | null;
  onChange: (p: LatLng) => void;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const { west, south, east, north } = region.bbox;
    const m = new maplibregl.Map({
      container: container.current!,
      style: config.map.styleUrl,
      center: point ? [point.lng, point.lat] : [region.center.lng, region.center.lat],
      zoom: point ? 16 : region.defaultZoom - 3,
      maxBounds: [
        [west - 0.05, south - 0.05],
        [east + 0.05, north + 0.05],
      ],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    let fellBack = false;
    m.on('error', () => {
      if (!fellBack && !m.isStyleLoaded()) {
        fellBack = true;
        m.setStyle(rasterStyle());
      }
    });
    m.on('click', (e) => change.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // Created once; `point` updates are handled below.
  }, []);
  useMapTheme(map);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!point) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const el = document.createElement('div');
      el.className = 'pin-marker';
      marker.current = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
        .setLngLat([point.lng, point.lat])
        .addTo(m);
      marker.current.on('dragend', () => {
        const ll = marker.current!.getLngLat();
        change.current({ lat: ll.lat, lng: ll.lng });
      });
    } else {
      marker.current.setLngLat([point.lng, point.lat]);
    }
    if (!m.getBounds().contains([point.lng, point.lat]) || m.getZoom() < 14) {
      m.easeTo({ center: [point.lng, point.lat], zoom: Math.max(m.getZoom(), 16) });
    }
  }, [point]);

  return <div ref={container} className="pin-map" role="application" aria-label={label} />;
}
