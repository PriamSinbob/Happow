import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  bearing,
  circleBounds,
  circleRing,
  compassPoint,
  distanceM,
  isRunning,
  snapRadiusUp,
  type DensityCluster,
  type LatLng,
  type NearbyEvent,
} from '@happow/core';
import { categoriesById, config, region } from '../config';
import { formatDistance } from '../format';
import type { Guidance } from '../hooks/useGuidance';
import { useI18n, type MessageKey } from '../i18n';

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
  /** Incremented by the locate button: fit the view to the circle again even after panning. */
  recenter: number;
  /** Pixels covered by everything at the bottom (cards included), kept clear of chevrons. */
  overlayInset: number;
  hidden?: boolean;
  /** Matching events around the user per density cell, for chevrons and outside-radius bubbles. */
  clusters: DensityCluster[];
  hotspot: Guidance['hotspot'];
  onHotspot: () => void;
  onExpand: (radius: number) => void;
}

interface Chevron {
  cell: string;
  x: number;
  y: number;
  angle: number;
  opacity: number;
  distanceM: number;
  count: number;
  direction: string;
  target: LatLng;
}

/** Map area not covered by the floating top bars (and the attribution button) or the bottom sheet. */
const TOP_INSET = 136;
const EDGE = 10;
/** Chevrons are centred on their position, so keep that point half a chevron inside the edge. */
const HALF_W = 52;
const HALF_H = 16;
const { minM, maxM } = config.app.radius;
const { searchRadiusM, maxChevrons } = config.app.density;
/** Without panning, re-fit only once the user has walked this far (GPS jitter is smaller). */
const REFIT_AFTER_M = 30;

/**
 * Edge-of-screen pointers to clusters outside the visible map area: placed where the line from the
 * view's centre to the cluster leaves the visible rectangle, nearest first, faded with distance,
 * capped and kept apart so they never pile up.
 */
function computeChevrons(m: maplibregl.Map, p: Props): Chevron[] {
  const el = m.getContainer();
  const rect = {
    x0: EDGE + HALF_W,
    y0: TOP_INSET + HALF_H,
    x1: el.clientWidth - EDGE - HALF_W,
    y1: el.clientHeight - p.overlayInset - EDGE - HALF_H,
  };
  if (rect.x1 - rect.x0 < 60 || rect.y1 - rect.y0 < 60) return [];
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const span = Math.max(1, searchRadiusM - p.radiusM);

  const candidates = p.clusters
    .filter((c) => c.outsideCount > 0)
    .map((c) => ({
      c,
      pt: m.project([c.center.lng, c.center.lat]),
      // Distance to the cluster's nearest event, so labels agree with "Nearest: …" guidance.
      d: c.nearestOutside?.distanceM ?? distanceM(p.center, c.center),
    }))
    .filter(({ pt }) => pt.x < rect.x0 || pt.x > rect.x1 || pt.y < rect.y0 || pt.y > rect.y1)
    .sort((a, b) => a.d - b.d);

  const out: Chevron[] = [];
  for (const { c, pt, d } of candidates) {
    if (out.length >= maxChevrons) break;
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const s = Math.min(
      dx ? (dx > 0 ? rect.x1 - cx : cx - rect.x0) / Math.abs(dx) : Infinity,
      dy ? (dy > 0 ? rect.y1 - cy : cy - rect.y0) / Math.abs(dy) : Infinity,
    );
    const x = cx + dx * s;
    const y = cy + dy * s;
    // Pills are wide: keep them a pill apart horizontally or a row apart vertically.
    if (out.some((o) => Math.abs(o.x - x) < 2 * HALF_W + 6 && Math.abs(o.y - y) < 2 * HALF_H + 6))
      continue;
    const fade = Math.min(1, Math.max(0, (d - p.radiusM) / span));
    out.push({
      cell: c.cell,
      x,
      y,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      opacity: 1 - 0.55 * fade,
      distanceM: d,
      count: c.count,
      direction: compassPoint(bearing(p.center, c.center)),
      target: c.center,
    });
  }
  return out;
}

const RADIUS_SOURCE = 'radius';

export function rasterStyle(): StyleSpecification {
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
  const { t, lang } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>());
  const userMarker = useRef<maplibregl.Marker | null>(null);
  const hintMarkers = useRef<maplibregl.Marker[]>([]);
  const userMoved = useRef(false);
  const lastFit = useRef<{
    center: LatLng;
    radiusM: number;
    bottomInset: number;
    recenter: number;
  } | null>(null);
  const [chevrons, setChevrons] = useState<Chevron[]>([]);
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
      // Battery and data: tiles cached for a week are good enough; don't re-download them.
      refreshExpiredTiles: false,
      fadeDuration: 0,
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
    // Gestures carry an originalEvent; our own fitBounds/easeTo calls do not.
    const markMoved = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved.current = true;
    };
    m.on('dragstart', markMoved);
    m.on('zoomstart', markMoved);
    m.on('click', (e) => {
      if (!(e.originalEvent.target as HTMLElement).closest('.marker'))
        latest.current.onSelect(null);
    });
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
      userMarker.current = null;
      hintMarkers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The radius circle always follows the user; the view fits to it only when that won't fight the
  // user: on a new radius or layout, on "locate", or when the user has walked on while the map
  // still shows the circle. GPS updates alone never yank back a map the user has panned or zoomed.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (m.getSource(RADIUS_SOURCE) as GeoJSONSource | undefined)?.setData(
      radiusFeature(props.center, props.radiusM),
    );
    const last = lastFit.current;
    const forced =
      !last ||
      last.radiusM !== props.radiusM ||
      last.bottomInset !== props.bottomInset ||
      last.recenter !== props.recenter;
    if (!forced && (userMoved.current || distanceM(last.center, props.center) < REFIT_AFTER_M))
      return;
    userMoved.current = false;
    lastFit.current = {
      center: props.center,
      radiusM: props.radiusM,
      bottomInset: props.bottomInset,
      recenter: props.recenter,
    };
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
  }, [props.center.lat, props.center.lng, props.radiusM, props.bottomInset, props.recenter]);

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
        const pin = Object.assign(document.createElement('span'), { className: 'marker__pin' });
        pin.append(Object.assign(document.createElement('span'), { textContent: icon }));
        entry.el.replaceChildren(pin);
      }
      entry.el.style.setProperty('--cat', cat?.color ?? '#475569');
      entry.el.setAttribute('aria-label', ev.title);
      entry.el.classList.toggle('is-now', isRunning(ev, props.now));
      entry.el.classList.toggle('is-selected', ev.id === props.selectedId);
      entry.el.classList.toggle('is-flagged', !!ev.flag);
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

  // Outside-radius bubbles (tap to widen the circle) and the hotspot marker.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of hintMarkers.current) mk.remove();
    hintMarkers.current = [];
    const label = (key: MessageKey, count: number, at: LatLng, place?: string) =>
      t(key, {
        count,
        place: place ?? '',
        distance: formatDistance(distanceM(props.center, at), lang),
        direction: t(`dir.${compassPoint(bearing(props.center, at))}` as MessageKey),
      });
    const hot = props.hotspot && props.hotspot.outsideCount > 0 ? props.hotspot : null;

    for (const c of props.clusters) {
      if (c.outsideCount === 0 || c.cell === hot?.cell || !c.nearestOutside) continue;
      // Inside-the-circle centroids would sit among the pins; anchor on the nearest outside event.
      const at =
        distanceM(props.center, c.center) > props.radiusM ? c.center : c.nearestOutside.point;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'ghost';
      el.textContent = String(c.outsideCount);
      el.setAttribute('aria-label', label('cluster.label', c.outsideCount, at));
      const reach = c.nearestOutside.distanceM;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        latest.current.onExpand(snapRadiusUp(reach + 10, minM, maxM));
      });
      hintMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(m));
    }
    if (hot) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hotspot';
      el.innerHTML = '<span class="hotspot__ring" aria-hidden="true"></span>';
      el.append(
        Object.assign(document.createElement('span'), {
          className: 'hotspot__count',
          textContent: String(hot.count),
        }),
      );
      el.setAttribute(
        'aria-label',
        t('hotspot.label', { place: hot.topVenue ?? t('guide.place'), count: hot.count }),
      );
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        latest.current.onHotspot();
      });
      hintMarkers.current.push(
        new maplibregl.Marker({ element: el }).setLngLat(hot.center).addTo(m),
      );
    }
  }, [props.clusters, props.hotspot, props.center, props.radiusM, t, lang]);

  // Chevrons follow the map as it moves.
  useEffect(() => {
    const m = map.current;
    if (!m || props.hidden) {
      setChevrons([]);
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setChevrons(computeChevrons(m, latest.current)));
    };
    update();
    m.on('move', update);
    m.on('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      m.off('move', update);
      m.off('resize', update);
    };
  }, [props.clusters, props.center, props.radiusM, props.overlayInset, props.hidden]);

  return (
    <div className="map" hidden={props.hidden}>
      <div ref={container} className="map__canvas" />
      {chevrons.map((c) => (
        <button
          key={c.cell}
          type="button"
          className="chevron"
          style={{ left: c.x, top: c.y, opacity: c.opacity }}
          aria-label={t('chevron.label', {
            count: c.count,
            distance: formatDistance(c.distanceM, lang),
            direction: t(`dir.${c.direction}` as MessageKey),
          })}
          onClick={() =>
            map.current?.easeTo({ center: [c.target.lng, c.target.lat], duration: 600 })
          }
        >
          <svg
            className="chevron__arrow"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            style={{ transform: `rotate(${c.angle}deg)` }}
            aria-hidden
          >
            <path
              d="M5 12h12m-5-6 6 6-6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            {formatDistance(c.distanceM, lang)} · {c.count}
          </span>
        </button>
      ))}
    </div>
  );
}
