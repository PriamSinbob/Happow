import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  areaKey,
  circleBounds,
  clampToEdge,
  distanceM,
  isRunning,
  veilBox,
  type LatLng,
  type NearbyEvent,
} from '@happow/core';
import { addVeil, drawVeil, moveVeil, paintVeil, uploadVeil, type LitCell } from '../atlas/veil';
import { config, region } from '../config';
import type { Guidance } from '../hooks/useGuidance';
import { useI18n } from '../i18n';
import { useMapTheme } from '../mapTheme';
import { addPinLayers, applyPinPaint, PIN_HIT_LAYERS, PIN_SOURCE, pinPaint } from '../pinLayers';
import { pinFeatures, type PinMode } from '../pins';
import { addReachCircle, RADIUS_SOURCE, radiusFeature } from '../reachCircle';
import { useTheme } from '../theme';

interface Props {
  center: LatLng;
  radiusM: number;
  /** Events in reach plus the nearest ones beyond it (drawn faded, or as edge dots off screen). */
  events: NearbyEvent[];
  /** The time pins are drawn for: now, or the time picked on the line. */
  now: Date;
  pinMode: PinMode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Tapped a pin that holds several events at one place (cinema screenings, a festival stage). */
  onSelectPlace: (ids: string[]) => void;
  /** Pixels covered at the bottom (time line, cards), kept clear when fitting and for edge dots. */
  bottomInset: number;
  /** Incremented by the locate button: fit the view to the reach again even after panning. */
  recenter: number;
  hidden?: boolean;
  hotspot: Guidance['hotspot'];
  onHotspot: () => void;
  /** While the reach rail is dragged: the radius under the finger, so the map zooms with it. */
  previewRadiusM: number | null;
  /** Pinched out well past the rail's last stop: city mode (§5). */
  onCity: () => void;
  /** The reach is pinned to a point on the map ("plan from here"), not following the user. */
  pinned: boolean;
  /** Long-press on the map: plan from that spot. */
  onSetPoint: (point: LatLng) => void;
  /** The local atlas (§6): lit cells, null until loaded (the veil then lights the reach only). */
  lit: readonly LitCell[] | null;
  cellRadiusM: number;
}

interface EdgeDot {
  id: string;
  x: number;
  y: number;
  live: boolean;
  point: LatLng;
}

/** Top: the live counter and settings row. Right: the reach rail and its buttons. */
const TOP_INSET = 68;
const RIGHT_INSET = 64;
const EDGE = 10;
/** A tap this close to a pin counts as a tap on it, so 10 px dots are easy to hit. */
const HIT_PX = 14;
const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE_PX = 8;
const { detentsM } = config.app.radius;
const RAIL_MAX = detentsM[detentsM.length - 1]!;
/** Pinching out to show this many times the rail's last stop switches to city mode. */
const CITY_FACTOR = 1.6;
/** Without panning, re-fit only once the user has walked this far (GPS jitter is smaller). */
const REFIT_AFTER_M = 30;

const { atlas, refresh } = config.app;

/** The veil's canvas covers this box around the area snapshot's grid point. */
function boxAround(center: LatLng) {
  const k = areaKey(center, config.app.density.searchRadiusM, refresh);
  return veilBox({ lat: k.lat, lng: k.lng }, atlas.veilRadiusM);
}

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

function fitPadding(bottomInset: number) {
  return { top: TOP_INSET, bottom: bottomInset + 16, left: 20, right: RIGHT_INSET };
}

/** Off-screen events as dots on the edge of the visible map, live ones in the live hue (§5). */
function computeEdgeDots(m: maplibregl.Map, p: Props): EdgeDot[] {
  const el = m.getContainer();
  const rect = {
    left: EDGE,
    top: TOP_INSET - 8,
    right: el.clientWidth - EDGE,
    bottom: el.clientHeight - p.bottomInset - EDGE,
  };
  if (rect.right - rect.left < 60 || rect.bottom - rect.top < 60) return [];
  const c = m.project([p.center.lng, p.center.lat]);
  const out: EdgeDot[] = [];
  for (const ev of p.events) {
    const pt = m.project([ev.point.lng, ev.point.lat]);
    const at = clampToEdge(pt, c, rect);
    if (!at) continue;
    out.push({
      id: ev.id,
      ...at,
      live: p.pinMode === 'time' && isRunning(ev, p.now),
      point: ev.point,
    });
  }
  return out;
}

export function MapView(props: Props) {
  const { t } = useI18n();
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
  const [edgeDots, setEdgeDots] = useState<EdgeDot[]>([]);
  const latest = useRef(props);
  latest.current = props;
  // The veil (§6): one small canvas, redrawn only when what it shows changes.
  const veilCanvas = useRef<HTMLCanvasElement | null>(null);
  veilCanvas.current ??= Object.assign(document.createElement('canvas'), {
    width: atlas.canvasPx,
    height: atlas.canvasPx,
  });
  const boxKey = areaKey(props.center, config.app.density.searchRadiusM, refresh);
  const box = useMemo(
    () => boxAround(props.center),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxKey.lat, boxKey.lng],
  );
  const boxRef = useRef(box);
  boxRef.current = box;
  const redrawVeil = (m: maplibregl.Map) => {
    const p = latest.current;
    const ctx = veilCanvas.current!.getContext('2d');
    if (!ctx || !m.getSource('veil')) return;
    drawVeil(ctx, {
      box: boxRef.current,
      colour: themeRef.current.tokens.veil,
      cells: p.lit ?? [],
      cellRadiusM: p.cellRadiusM,
      reach: { centre: p.center, radiusM: p.radiusM },
    });
    uploadVeil(m);
  };

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
    // OSM attribution is required; bottom-left sits just above the time line.
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
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
      // Under the basemap labels and below the pins. Its lit disc shows the reach (M8 §1).
      addVeil(m, veilCanvas.current!, boxRef.current);
      paintVeil(m, themeRef.current.tokens);
      addReachCircle(m, p.center, p.radiusM);
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

    // Pinching out far past the rail's last stop asks for the whole city (§5).
    m.on('zoomend', (e) => {
      const p = latest.current;
      if (!e.originalEvent || p.radiusM > RAIL_MAX) return;
      const b = m.getBounds();
      const c = m.getCenter();
      const half = Math.min(
        distanceM({ lat: c.lat, lng: c.lng }, { lat: b.getNorth(), lng: c.lng }),
        distanceM({ lat: c.lat, lng: c.lng }, { lat: c.lat, lng: b.getEast() }),
      );
      if (half > RAIL_MAX * CITY_FACTOR) p.onCity();
    });

    // Long-press = plan from here (§5). A move, a second finger or a drag cancels it.
    let press: { timer: number; x: number; y: number } | null = null;
    let pressed = false;
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    const start = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      cancel();
      pressed = false;
      if ('points' in e && e.points.length > 1) return;
      const at = e.lngLat;
      press = {
        x: e.point.x,
        y: e.point.y,
        timer: window.setTimeout(() => {
          press = null;
          pressed = true;
          navigator.vibrate?.(10);
          latest.current.onSetPoint({ lat: at.lat, lng: at.lng });
        }, LONG_PRESS_MS),
      };
    };
    const moved = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (press && Math.hypot(e.point.x - press.x, e.point.y - press.y) > MOVE_TOLERANCE_PX)
        cancel();
    };
    m.on('touchstart', start);
    m.on('mousedown', start);
    m.on('touchmove', moved);
    m.on('mousemove', moved);
    m.on('touchend', cancel);
    m.on('touchcancel', cancel);
    m.on('mouseup', cancel);
    m.on('dragstart', cancel);
    m.on('zoomstart', cancel);
    m.on('contextmenu', (e) => {
      // Desktop: right-click does the same; on touch the timer above already fired.
      e.preventDefault();
      if (pressed) return;
      cancel();
      latest.current.onSetPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    // A tap selects the nearest pin within reach of the finger; on empty map it closes the card.
    m.on('click', (e) => {
      if (pressed) {
        pressed = false;
        return;
      }
      if ((e.originalEvent.target as HTMLElement).closest('.maplibregl-marker')) return;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - HIT_PX, e.point.y - HIT_PX],
        [e.point.x + HIT_PX, e.point.y + HIT_PX],
      ];
      const hits = m.getLayer('pin-disc')
        ? m.queryRenderedFeatures(box, { layers: PIN_HIT_LAYERS })
        : [];
      const hit = hits
        .map((f) => {
          const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
          const pt = m.project([lng, lat]);
          return { f, d: Math.hypot(pt.x - e.point.x, pt.y - e.point.y) };
        })
        .sort((a, b) => a.d - b.d)[0]?.f;
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
      latest.current.onSelect(null);
    });
    return () => {
      cancel();
      m.remove();
      map.current = null;
      hintMarkers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMapTheme(map);

  // Rail drag: the map zooms with the finger (§5), and on the raster fallback the circle follows
  // it too. No animation: this runs every frame of the drag.
  useEffect(() => {
    const m = map.current;
    const r = props.previewRadiusM;
    if (!m || r === null) return;
    (m.getSource(RADIUS_SOURCE) as GeoJSONSource | undefined)?.setData(
      radiusFeature(props.center, r),
    );
    const [w, s, e, n] = circleBounds(props.center, r);
    const cam = m.cameraForBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: fitPadding(props.bottomInset), maxZoom: 17 },
    );
    if (cam) m.jumpTo(cam);
  }, [props.previewRadiusM, props.center, props.bottomInset]);

  // The reach always follows the user; the view fits to it only when that won't fight the user:
  // on a new radius or layout, on "locate", or when the user has walked on while the map still
  // shows the reach. GPS updates alone never yank back a map the user has panned or zoomed.
  useEffect(() => {
    const m = map.current;
    if (!m || props.previewRadiusM !== null) return;
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
      { padding: fitPadding(props.bottomInset), duration: 450, maxZoom: 17 },
    );
  }, [
    props.center.lat,
    props.center.lng,
    props.radiusM,
    props.bottomInset,
    props.recenter,
    props.previewRadiusM,
  ]);

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

  // The map container may have been display:none.
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
  // zoom merge into a count bubble that zooms in; rebuilt on data, selection, time or zoom.
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
        mode: props.pinMode,
      }),
    );
  }, [
    props.events,
    props.selectedId,
    props.now,
    props.center,
    props.radiusM,
    props.pinMode,
    zoom,
    styleReady,
  ]);

  // The veil follows the snapshot's grid point; its canvas is redrawn only when the lit cells, the
  // reach (a detent released, locate, long-press) or the theme change. Pan and zoom never redraw
  // it: the GPU moves the texture and the zoom fade is a style expression.
  useEffect(() => {
    if (map.current) moveVeil(map.current, box);
  }, [box]);
  useEffect(() => {
    if (map.current) paintVeil(map.current, tokens);
  }, [tokens, styleReady]);
  useEffect(() => {
    if (map.current) redrawVeil(map.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lit, props.cellRadiusM, props.center, props.radiusM, tokens.veil, box, styleReady]);

  // Day/night or preset changed: pin colours are paint properties, no sprite rebuild.
  useEffect(() => {
    if (map.current) applyPinPaint(map.current, pinPaint(tokens, preset, themeName));
  }, [tokens, preset, themeName, styleReady]);

  // The hotspot marker: the busiest cell within the search area, outside the reach.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of hintMarkers.current) mk.remove();
    hintMarkers.current = [];
    const hot = props.hotspot && props.hotspot.outsideCount > 0 ? props.hotspot : null;
    if (!hot) return;
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
    hintMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat(hot.center).addTo(m));
  }, [props.hotspot, t]);

  // Edge dots follow the map as it moves.
  useEffect(() => {
    const m = map.current;
    if (!m || props.hidden) {
      setEdgeDots([]);
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setEdgeDots(computeEdgeDots(m, latest.current)));
    };
    update();
    m.on('move', update);
    m.on('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      m.off('move', update);
      m.off('resize', update);
    };
  }, [props.events, props.center, props.now, props.pinMode, props.bottomInset, props.hidden]);

  return (
    <div className="map" hidden={props.hidden}>
      <div ref={container} className="map__canvas" />
      {edgeDots.map((d) => (
        <button
          key={d.id}
          type="button"
          className={`edge-dot${d.live ? ' is-live' : ''}`}
          style={{ left: d.x, top: d.y }}
          tabIndex={-1}
          aria-hidden
          onClick={() => map.current?.easeTo({ center: [d.point.lng, d.point.lat], duration: 600 })}
        />
      ))}
    </div>
  );
}
