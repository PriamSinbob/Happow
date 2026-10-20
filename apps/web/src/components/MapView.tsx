import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { circleBounds, circleRing, isRunning, type LatLng, type NearbyEvent } from '@happow/core';
import { categoriesById, config, region } from '../config';
import { useI18n } from '../i18n';

interface Props {
  center: LatLng;
  userPosition: LatLng | null;
  radiusM: number;
  events: NearbyEvent[];
  now: Date;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Pixels covered by the bottom panel, so the radius circle stays in the visible area. */
  bottomInset: number;
  hidden?: boolean;
}

const RADIUS_SOURCE = 'radius';

function rasterStyle(): StyleSpecification {
  const r = config.map.fallbackRaster;
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: r.tiles,
        tileSize: r.tileSize,
        maxzoom: r.maxZoom,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

function radiusFeature(center: LatLng, radiusM: number) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [circleRing(center, radiusM)] },
  };
}

export function MapView(props: Props) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>());
  const userMarker = useRef<maplibregl.Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // Create the map once.
  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current!,
      style: config.map.styleUrl,
      center: [props.center.lng, props.center.lat],
      zoom: region.defaultZoom,
      minZoom: config.map.minZoom,
      maxZoom: config.map.maxZoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    // OSM attribution is required; top-right keeps it clear of the bottom sheet.
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
    map.current = m;

    let fellBack = false;
    m.on('error', (e) => {
      // Vector style unreachable → plain OSM raster so the map is never blank.
      if (!fellBack && !m.isStyleLoaded()) {
        fellBack = true;
        console.warn('Map style failed, falling back to raster tiles', e.error);
        m.setStyle(rasterStyle());
      }
    });
    m.on('style.load', () => {
      const p = latest.current;
      if (!m.getSource(RADIUS_SOURCE)) {
        m.addSource(RADIUS_SOURCE, { type: 'geojson', data: radiusFeature(p.center, p.radiusM) });
        m.addLayer({
          id: 'radius-fill',
          type: 'fill',
          source: RADIUS_SOURCE,
          paint: { 'fill-color': '#f97316', 'fill-opacity': 0.07 },
        });
        m.addLayer({
          id: 'radius-line',
          type: 'line',
          source: RADIUS_SOURCE,
          paint: { 'line-color': '#f97316', 'line-width': 2, 'line-dasharray': [2, 1.5] },
        });
      }
    });
    m.once('load', () => {
      // Compact attribution starts expanded on wide viewports; start it collapsed (the ⓘ opens it).
      container.current
        ?.querySelector('.maplibregl-ctrl-attrib')
        ?.classList.remove('maplibregl-compact-show');
    });
    m.on('click', (e) => {
      if (!(e.originalEvent.target as HTMLElement).closest('.marker'))
        latest.current.onSelect(null);
    });
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
      userMarker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Radius circle + fit the view to it whenever the centre or radius changes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (m.getSource(RADIUS_SOURCE) as GeoJSONSource | undefined)?.setData(
      radiusFeature(props.center, props.radiusM),
    );
    const [w, s, e, n] = circleBounds(props.center, props.radiusM);
    m.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      {
        padding: { top: 128, bottom: props.bottomInset + 24, left: 24, right: 24 },
        duration: 450,
        maxZoom: 17,
      },
    );
  }, [props.center.lat, props.center.lng, props.radiusM, props.bottomInset]);

  // The map container may have been display:none while the list was open.
  useEffect(() => {
    if (!props.hidden) map.current?.resize();
  }, [props.hidden]);

  // User position dot.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!props.userPosition) {
      userMarker.current?.remove();
      userMarker.current = null;
      return;
    }
    if (!userMarker.current) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', t('map.you'));
      userMarker.current = new maplibregl.Marker({ element: el })
        .setLngLat(props.userPosition)
        .addTo(m);
    } else {
      userMarker.current.setLngLat(props.userPosition);
    }
  }, [props.userPosition, t]);

  // Event markers: diff by id; nudge markers that share a spot so all stay tappable.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    const perSpot = new Map<string, number>();
    for (const ev of props.events) {
      seen.add(ev.id);
      const spot = `${ev.point.lat.toFixed(5)},${ev.point.lng.toFixed(5)}`;
      const n = perSpot.get(spot) ?? 0;
      perSpot.set(spot, n + 1);
      const cat = categoriesById.get(ev.categoryIds[0]!);
      let entry = markers.current.get(ev.id);
      if (!entry) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'marker';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          latest.current.onSelect(ev.id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(ev.point)
          .addTo(m);
        entry = { marker, el };
        markers.current.set(ev.id, entry);
      }
      const icon = cat?.icon ?? '📍';
      if (entry.el.dataset.icon !== icon) {
        entry.el.dataset.icon = icon;
        entry.el.replaceChildren(
          Object.assign(document.createElement('span'), { textContent: icon }),
        );
      }
      entry.el.style.setProperty('--cat', cat?.color ?? '#475569');
      entry.el.setAttribute('aria-label', ev.title);
      entry.el.classList.toggle('is-now', isRunning(ev, props.now));
      entry.el.classList.toggle('is-selected', ev.id === props.selectedId);
      entry.marker.setOffset([n * 18, -n * 6]);
      entry.el.style.zIndex = ev.id === props.selectedId ? '10' : '';
    }
    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
  }, [props.events, props.selectedId, props.now]);

  return <div ref={container} className="map" hidden={props.hidden} />;
}
