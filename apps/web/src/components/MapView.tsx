import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  bearing,
  circleBounds,
  circleRing,
  compassPoint,
  distanceM,
  snapRadiusUp,
  type DensityCluster,
  type LatLng,
  type NearbyEvent,
} from '@happow/core';
import { config, region } from '../config';
import { formatDistance } from '../format';
import type { Guidance } from '../hooks/useGuidance';
import { useI18n, type MessageKey } from '../i18n';
import { useMapTheme, type OwnLayerPaint } from '../mapTheme';
import { addPinLayers, applyPinPaint, PIN_HIT_LAYERS, PIN_SOURCE, pinPaint } from '../pinLayers';
import { pinFeatures } from '../pins';
import { useTheme } from '../theme';

interface Props {
  center: LatLng;
  radiusM: number;
  events: NearbyEvent[];
  now: Date;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Tapped a pin that holds several events at one place (cinema screenings, a festival stage). */
  onSelectPlace: (ids: string[]) => void;
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
  /** The circle is pinned to a point on the map ("Search here"), not following the user. */
  pinned: boolean;
  /** A card is open in the sheet: the next tap on the map closes it instead of placing a point. */
  cardOpen: boolean;
  /** "Search from here" confirmed for a tapped spot. */
  onSetPoint: (point: LatLng) => void;
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
const RADIUS_PAINT: OwnLayerPaint = [
  ['radius-fill', 'fill-color', 'ink'],
  ['radius-line', 'line-color', 'ink'],
];

export interface MarkerItem {
  key: string;
  /** "place": one spot (one or more events there); "cluster": nearby spots merged at this zoom. */
  kind: 'place' | 'cluster';
  point: LatLng;
  events: NearbyEvent[];
  /** Venue name of a place, when its events have one. */
  label: string | null;
}

/** Spots closer than this on screen merge into one bubble. */
const CLUSTER_PX = 48;

/**
 * Groups events by exact spot, then merges spots falling into the same CLUSTER_PX grid square of
 * the Web Mercator world at this zoom. A grid (not distance) keeps groups stable while panning.
 */
export function groupMarkers(events: NearbyEvent[], zoom: number): MarkerItem[] {
  const places = new Map<string, MarkerItem>();
  for (const ev of events) {
    const key = `p:${ev.point.lat.toFixed(5)},${ev.point.lng.toFixed(5)}`;
    const place = places.get(key);
    if (place) place.events.push(ev);
    else
      places.set(key, {
        key,
        kind: 'place',
        point: ev.point,
        events: [ev],
        label: ev.venue?.name ?? null,
      });
  }
  const world = 512 * 2 ** zoom;
  const cells = new Map<string, MarkerItem[]>();
  for (const place of places.values()) {
    const c = maplibregl.MercatorCoordinate.fromLngLat(place.point);
    const cell = `${Math.floor((c.x * world) / CLUSTER_PX)}:${Math.floor((c.y * world) / CLUSTER_PX)}`;
    cells.set(cell, [...(cells.get(cell) ?? []), place]);
  }
  const out: MarkerItem[] = [];
  for (const [cell, group] of cells) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    const all = group.flatMap((p) => p.events);
    out.push({
      key: `c:${zoom}:${cell}`,
      kind: 'cluster',
      point: {
        lat: group.reduce((s, p) => s + p.point.lat, 0) / group.length,
        lng: group.reduce((s, p) => s + p.point.lng, 0) / group.length,
      },
      events: all,
      label: null,
    });
  }
  return out;
}

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
  const groupsRef = useRef<MarkerItem[]>([]);
  const [styleReady, setStyleReady] = useState(0);
  const { tokens, preset, name: themeName } = useTheme();
  const themeRef = useRef({ tokens, preset, name: themeName });
  themeRef.current = { tokens, preset, name: themeName };
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
          paint: { 'fill-opacity': 0.07 },
        });
        m.addLayer({
          id: 'radius-line',
          type: 'line',
          source: RADIUS_SOURCE,
          paint: { 'line-width': 2, 'line-dasharray': [2, 1.5] },
        });
      }
      addPinLayers(m);
      const th = themeRef.current;
      applyPinPaint(m, pinPaint(th.tokens, th.preset, th.name));
      setStyleReady((n) => n + 1);
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
    // A tap on empty map first closes an open card; otherwise it proposes a search point there
    // (inside the circle too, for fine adjustment). Taps on any marker are theirs.
    m.on('click', (e) => {
      if ((e.originalEvent.target as HTMLElement).closest('.maplibregl-marker')) return;
      const hit = m.getLayer('pin-disc')
        ? m.queryRenderedFeatures(e.point, { layers: PIN_HIT_LAYERS })[0]
        : undefined;
      if (hit) {
        const key = hit.properties.key as string;
        const group = groupsRef.current.find((g) => g.key === key);
        if (!group) return;
        if (group.kind === 'cluster') {
          m.easeTo({ center: group.point, zoom: Math.min(m.getZoom() + 2, config.map.maxZoom) });
          return;
        }
        const ids = group.events.map((ev) => ev.id);
        if (ids.length === 1) latest.current.onSelect(ids[0]!);
        else latest.current.onSelectPlace(ids);
        return;
      }
      if (latest.current.cardOpen) latest.current.onSelect(null);
      else setCandidate({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    return () => {
      m.remove();
      map.current = null;
      hintMarkers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMapTheme(map, RADIUS_PAINT);

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

  // The tapped spot: a pin with "Search from here" above it, and ✕ to drop it. Another tap moves it.
  const [candidate, setCandidate] = useState<LatLng | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !candidate) return;
    const el = document.createElement('div');
    el.className = 'candidate';
    const actions = Object.assign(document.createElement('div'), {
      className: 'candidate__actions',
    });
    const go = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'candidate__go',
      textContent: t('point.searchHere'),
    });
    go.addEventListener('click', (e) => {
      e.stopPropagation();
      setCandidate(null);
      latest.current.onSetPoint(candidate);
    });
    const cancel = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'candidate__cancel',
      textContent: '✕',
    });
    cancel.setAttribute('aria-label', t('event.close'));
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      setCandidate(null);
    });
    actions.append(go, cancel);
    el.append(actions, Object.assign(document.createElement('span'), { className: 'point-pin' }));
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(candidate)
      .addTo(m);
    return () => {
      marker.remove();
    };
  }, [candidate, t]);
  // Locate (or any other move of the circle) or leaving the map drops a pending proposal.
  useEffect(() => setCandidate(null), [props.center.lat, props.center.lng, props.hidden]);

  // A pinned search point gets its own marker, so it's clear what distances count from.
  useEffect(() => {
    const m = map.current;
    if (!m || !props.pinned) return;
    const el = document.createElement('div');
    el.className = 'point-pin';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', t('point.label'));
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(props.center)
      .addTo(m);
    return () => {
      marker.remove();
    };
  }, [props.pinned, props.center.lat, props.center.lng, t]);

  // The map container may have been display:none while the list was open.
  useEffect(() => {
    if (!props.hidden) map.current?.resize();
  }, [props.hidden]);

  // Re-group markers only when the zoom level changes, not on every pan frame.
  const [zoom, setZoom] = useState(region.defaultZoom);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const update = () => setZoom(Math.round(m.getZoom()));
    m.on('zoomend', update);
    return () => {
      m.off('zoomend', update);
    };
  }, []);

  // Pins: one GeoJSON source drawn by symbol layers (§4.3). Places that would overlap at this
  // zoom merge into a count bubble that zooms in; rebuilt on data, selection, minute or zoom.
  useEffect(() => {
    const groups = groupMarkers(props.events, zoom);
    groupsRef.current = groups;
    const src = map.current?.getSource(PIN_SOURCE) as GeoJSONSource | undefined;
    src?.setData(
      pinFeatures(groups, {
        now: props.now,
        center: props.center,
        radiusM: props.radiusM,
        selectedId: props.selectedId,
      }),
    );
  }, [props.events, props.selectedId, props.now, props.center, props.radiusM, zoom, styleReady]);

  // Day/night or preset changed: pin colours are paint properties, no sprite rebuild.
  useEffect(() => {
    if (map.current) applyPinPaint(map.current, pinPaint(tokens, preset, themeName));
  }, [tokens, preset, themeName, styleReady]);

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
