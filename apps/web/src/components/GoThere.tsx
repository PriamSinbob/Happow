import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import { distanceM, walkingMinutes, type LatLng, type NearbyEvent } from '@happow/core';
import { api } from '../api';
import { categoriesById, config } from '../config';
import { formatDistance, navigationUrl } from '../format';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { useI18n } from '../i18n';
import { pathLength, progress } from '../nav';
import { FlagNotice } from './EventMeta';
import { Icon } from './Icons';
import { rasterStyle } from './MapView';

const nav = config.app.navigation;
const ROUTE = 'route';

interface Route {
  path: LatLng[];
  /** Direct line drawn when no walking route is available. */
  direct: boolean;
  attribution: string | null;
}

type Phase = 'going' | 'arrived' | 'ended' | 'stopped';

/**
 * "Going there": the walking route to one event, with the user's live position. This is the only
 * place the app keeps GPS on continuously, and only for the trip: it stops on arrival, when the
 * event ends, after `navigation.maxMinutes`, on Stop, and whenever the app is in the background.
 * The event itself is re-read every minute so a cancellation or a warning shows on the way.
 */
export function GoThere({
  ev: initial,
  now,
  refresh,
  onClose,
}: {
  ev: NearbyEvent | null;
  now: Date;
  /** Reads the event fresh (flags, time changes) while on the way. */
  refresh: (id: string, from: LatLng) => Promise<NearbyEvent | null>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [ev, setEv] = useState(initial);
  const [phase, setPhase] = useState<Phase>('going');
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const live = useLiveLocation(phase === 'going' && ev !== null);
  const here = live.position;
  const [route, setRoute] = useState<Route | null>(null);
  const routing = useRef({ at: 0, count: 0, busy: false });

  useEffect(() => {
    if (!ev && initial) setEv(initial);
  }, [ev, initial]);

  // Ask for a route once a position is known, and again (rate-limited) when off the line.
  useEffect(() => {
    if (!ev || !here || phase !== 'going') return;
    const r = routing.current;
    const off = route ? progress(here, route.path).offRouteM : Infinity;
    const due =
      !route ||
      (off > nav.offRouteM &&
        r.count <= nav.maxReroutes &&
        Date.now() - r.at > nav.rerouteMinSeconds * 1000);
    if (!due || r.busy) return;
    r.busy = true;
    r.at = Date.now();
    r.count++;
    api<{ path?: LatLng[]; attribution?: string }>('route', { body: { from: here, to: ev.point } })
      .then((res) => {
        // Anything but a usable line (an old server, a proxy page) falls back like an error.
        const ok = Array.isArray(res.path) && res.path.length >= 2;
        if (!ok) throw new Error('no route');
        setRoute({ path: res.path!, direct: false, attribution: res.attribution ?? null });
      })
      .catch(() => setRoute({ path: [here, ev.point], direct: true, attribution: null }))
      .finally(() => (r.busy = false));
  }, [ev, here, route, phase]);

  // Arrival, end of the event, and the safety cap stop live location.
  useEffect(() => {
    if (phase !== 'going' || !ev) return;
    if (new Date(ev.endAt) < now || ev.status === 'cancelled') setPhase('ended');
    else if (Date.now() - startedAt > nav.maxMinutes * 60_000) setPhase('stopped');
    else if (here && distanceM(here, ev.point) <= nav.arriveM) setPhase('arrived');
  }, [phase, ev, here, now, startedAt]);

  // The event, fresh every minute while on the way and the app is on screen.
  useEffect(() => {
    if (phase !== 'going' || !ev) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refresh(ev.id, here ?? ev.point)
        .then((fresh) => fresh && setEv(fresh))
        .catch(() => {});
    }, nav.eventRefreshSeconds * 1000);
    return () => clearInterval(id);
    // `here` changes with every fix; the interval only needs a recent one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ev?.id, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const left = here
    ? route && !route.direct
      ? progress(here, route.path).remainingM
      : ev
        ? distanceM(here, ev.point)
        : 0
    : null;

  return (
    <div className="go" role="dialog" aria-modal="true" aria-labelledby="go-title">
      <TripMap ev={ev} here={here} route={route} label={t('nav.you')} />
      <header className="go__top">
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.back')}>
          <Icon name="back" />
        </button>
        <div className="go__titles">
          <span className="go__kicker">{t('nav.title')}</span>
          <h1 id="go-title">{ev?.title ?? t('event.loading')}</h1>
          <span className="go__meta" aria-live="polite">
            {phase === 'arrived'
              ? t('nav.arrived')
              : phase === 'ended'
                ? t('nav.ended')
                : phase === 'stopped'
                  ? t('nav.stopped')
                  : live.denied
                    ? t('nav.noLocation')
                    : left === null
                      ? t('nav.locating')
                      : t('nav.remaining', {
                          distance: formatDistance(left, lang),
                          minutes: Math.max(
                            1,
                            walkingMinutes(left, config.app.walkingSpeedMPerMin),
                          ),
                        })}
          </span>
        </div>
      </header>
      {ev && (
        <div className="go__notices">
          {ev.status !== 'scheduled' && (
            <p className={`status-banner status-banner--${ev.status}`}>{t(`event.${ev.status}`)}</p>
          )}
          <FlagNotice ev={ev} now={now} compact />
        </div>
      )}
      <footer className="go__bottom">
        {route?.direct && phase === 'going' && <p className="go__note">{t('nav.direct')}</p>}
        <div className="go-buttons">
          {phase === 'going' ? (
            <button type="button" className="btn" onClick={() => setPhase('stopped')}>
              {t('nav.stop')}
            </button>
          ) : phase === 'stopped' ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setStartedAt(Date.now());
                setPhase('going');
              }}
            >
              {t('nav.resume')}
            </button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>
              {t('nav.close')}
            </button>
          )}
          {ev && phase !== 'arrived' && (
            <a
              className="btn btn--primary go-buttons__maps"
              href={navigationUrl(ev.point.lat, ev.point.lng)}
              target="_blank"
              rel="noreferrer"
            >
              {t('nav.googleMaps')}
            </a>
          )}
        </div>
        {route?.attribution && <p className="go__credit">{route.attribution}</p>}
      </footer>
    </div>
  );
}

/** The trip map: route line, the venue's pin and the walker's dot. Fits the trip once. */
function TripMap({
  ev,
  here,
  route,
  label,
}: {
  ev: NearbyEvent | null;
  here: LatLng | null;
  route: Route | null;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const venue = useRef<maplibregl.Marker | null>(null);
  const you = useRef<maplibregl.Marker | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current!,
      style: config.map.styleUrl,
      center: ev ? [ev.point.lng, ev.point.lat] : [0, 0],
      zoom: 16,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      refreshExpiredTiles: false,
      fadeDuration: 0,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    let fellBack = false;
    m.on('error', () => {
      if (!fellBack && !m.isStyleLoaded()) {
        fellBack = true;
        m.setStyle(rasterStyle());
      }
    });
    m.on('style.load', () => {
      if (m.getSource(ROUTE)) return;
      m.addSource(ROUTE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9 },
      });
      m.addLayer({
        id: 'route-line',
        type: 'line',
        source: ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2563eb',
          'line-width': 5,
          'line-dasharray': ['case', ['get', 'direct'], ['literal', [1, 2]], ['literal', [1, 0]]],
        },
      });
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is created once; markers and the route update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ev) return;
    if (!venue.current) {
      const el = document.createElement('div');
      el.className = 'marker is-target';
      const cat = categoriesById.get(ev.categoryIds[0]!);
      el.style.setProperty('--cat', cat?.color ?? '#475569');
      const pin = Object.assign(document.createElement('span'), { className: 'marker__pin' });
      pin.append(Object.assign(document.createElement('span'), { textContent: cat?.icon ?? '📍' }));
      el.append(pin);
      // A marker needs its position before it is added to the map.
      venue.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([
        ev.point.lng,
        ev.point.lat,
      ]);
      venue.current.addTo(m);
    }
    venue.current.setLngLat([ev.point.lng, ev.point.lat]);
  }, [ev]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!here) return;
    if (!you.current) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', label);
      you.current = new maplibregl.Marker({ element: el }).setLngLat([here.lng, here.lat]);
      you.current.addTo(m);
    }
    you.current.setLngLat([here.lng, here.lat]);
  }, [here, label]);

  useEffect(() => {
    const m = map.current;
    if (!m || !route) return;
    const draw = () => {
      (m.getSource(ROUTE) as GeoJSONSource | undefined)?.setData({
        type: 'Feature',
        properties: { direct: route.direct },
        geometry: { type: 'LineString', coordinates: route.path.map((p) => [p.lng, p.lat]) },
      });
      if (fitted.current) return;
      fitted.current = true;
      const b = new maplibregl.LngLatBounds();
      for (const p of route.path) b.extend([p.lng, p.lat]);
      // Room for the title card above and the buttons below.
      m.fitBounds(b, {
        padding: { top: 150, bottom: 150, left: 40, right: 40 },
        maxZoom: 17,
        duration: pathLength(route.path) > 3000 ? 0 : 400,
      });
    };
    if (m.isStyleLoaded() && m.getSource(ROUTE)) draw();
    else m.once('idle', draw);
  }, [route]);

  return <div ref={container} className="go__map" />;
}
