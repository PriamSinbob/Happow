import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  dayStarts,
  isOnDay,
  isRunning,
  pinState,
  snapRadius,
  type LatLng,
  type NearbyEvent,
} from '@happow/core';
import { trackView } from './analytics';
import { config, region } from './config';
import { createRepository } from './data';
import { withFlag, useMyReports } from './flags';
import { useEventDetail } from './hooks/useEventDetail';
import { useEvents } from './hooks/useEvents';
import { useGuidance } from './hooks/useGuidance';
import { useFilters } from './hooks/useFilters';
import { useGeolocation, useStableCenter } from './hooks/useGeolocation';
import { useMinuteClock } from './hooks/useClock';
import { useRoute } from './hooks/useHashRoute';
import { useRadius } from './hooks/useRadius';
import { useSaved } from './hooks/useSaved';
import { useI18n } from './i18n';
import { About } from './components/About';
import { AddEvent } from './components/AddEvent';
import { EventCard } from './components/EventCard';
import { EventDetail } from './components/EventDetail';
import { GoThere } from './components/GoThere';
import { GuidanceCard } from './components/Guidance';
import { Icon } from './components/Icons';
import { ListView } from './components/ListView';
import { MapView } from './components/MapView';
import { Moderation } from './components/Moderation';
import { PlaceCard } from './components/PlaceCard';
import { ReachRail } from './components/ReachRail';
import { SettingsSheet } from './components/SettingsSheet';
import { TimeLine } from './components/TimeLine';
import type { PinMode } from './pins';
import { storage } from './storage';
import { useTheme } from './theme';

type View = 'map' | 'list';

const { minM, maxM, defaultM } = config.app.radius;
const { maxEdgeDots } = config.app.density;

export function App() {
  const { t, lang } = useI18n();
  const repo = useMemo(createRepository, []);
  const location = useGeolocation(region);
  const [radius, setRadius] = useRadius();
  const [previewRadius, setPreviewRadius] = useState<number | null>(null);
  const [view, setView] = useState<View>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "OK" on the location notice is remembered on this device; the locate button shows it again.
  const [bannerDismissed, setBannerDismissed] = useState(
    () => storage.get('locationNoticeDismissed') === '1',
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const filters = useFilters();
  // The time line (§5, §13.3): a time today (null = now), or a day of the 7 / 14 days.
  const [at, setAt] = useState<Date | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [liveOnly, setLiveOnly] = useState(false);
  // Searches move only after ~100 m; labels and windows follow a minute clock, not downloads.
  const userCenter = useStableCenter(location.center, config.app.refresh.moveThresholdM);
  // Auto day/night follows sunrise and sunset where the user is.
  const { setPoint: setThemePoint } = useTheme();
  useEffect(() => setThemePoint(userCenter), [userCenter, setThemePoint]);
  // Long-press the map → plan from that spot (another district, a taxi drop-off); distances and
  // walking times then count from it. The locate button returns to the user.
  const [point, setPoint] = useState<LatLng | null>(null);
  const searchCenter = point ?? userCenter;
  const clock = useMinuteClock();
  const loaded = useEvents(
    repo,
    searchCenter,
    radius,
    region.timezone,
    filters.window,
    filters,
    config.app.density.searchRadiusM,
    clock,
  );
  const { clusters, loading, error, now } = loaded;
  // Status reports from this device show at once; everyone else's arrive with the next reload.
  const [myReports, addMyReport] = useMyReports();
  const flagged = useCallback(
    (list: NearbyEvent[]) => list.map((e) => withFlag(e, myReports)),
    [myReports],
  );

  // What the time line selects. Today: what is still on at the time looked at, drawn for that
  // time. 7 / 14 days: everything as dots, or one day's events as glyph pins.
  const days = 'days' in filters.window ? filters.window.days : 0;
  const starts = useMemo(() => (days ? dayStarts(now, region.timezone, days) : []), [days, now]);
  const pinTime = days ? now : (at ?? now);
  const pinMode: PinMode = days ? (day === null ? 'range' : 'day') : 'time';
  const visible = useCallback(
    (e: NearbyEvent) => {
      if (liveOnly) return isRunning(e, now);
      if (!days) return Date.parse(e.endAt) > pinTime.getTime();
      if (day === null) return true;
      return isOnDay(e, starts[day]!, starts[day + 1]!, config.app.timeline.carryOverMin);
    },
    [liveOnly, days, day, starts, now, pinTime],
  );
  const events = useMemo(
    () => flagged(loaded.events.filter(visible)),
    [flagged, loaded.events, visible],
  );
  const around = useMemo(
    () => flagged(loaded.around.filter(visible)),
    [flagged, loaded.around, visible],
  );
  // The map shows the reach plus the nearest events beyond it (faded, or edge dots off screen).
  const mapEvents = useMemo(() => [...events, ...around.slice(0, maxEdgeDots)], [events, around]);

  // ● N: on now, in reach, worth going to (not dashed). Always now, whatever the line shows.
  const liveCount = useMemo(
    () =>
      loaded.events.filter((e) => {
        if (!isRunning(e, now)) return false;
        return !pinState(e, now, e.distanceM, radius, config.categories, config.app).late;
      }).length,
    [loaded.events, now, radius],
  );

  const all = useMemo(() => [...events, ...around], [events, around]);
  const selected = all.find((e) => e.id === selectedId) ?? null;
  // A pin with several events at one place lists them; ids that left the results drop out.
  const [placeIds, setPlaceIds] = useState<string[] | null>(null);
  const placeEvents = placeIds ? all.filter((e) => placeIds.includes(e.id)) : [];
  const guidance = useGuidance(clusters, searchCenter, radius);
  const [hotspotOpen, setHotspotOpen] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const filtered = filters.activeCount > 0;
  const [route, go] = useRoute();
  const detailId = route?.name === 'event' ? route.id : null;
  const goId = route?.name === 'go' ? route.id : null;
  const openDetail = (id: string) => go({ name: 'event', id });
  const close = useCallback(() => go(null), [go]);
  const detail = useEventDetail(repo, detailId ?? goId, events, searchCenter);
  useEffect(() => trackView(route?.name ?? 'map'), [route?.name]);
  const saved = useSaved();

  // The time line's height: the map keeps the reach clear of it.
  const timeline = useRef<HTMLDivElement>(null);
  const [timelineHeight, setTimelineHeight] = useState(90);
  useLayoutEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTimelineHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clearCards = () => {
    setSelectedId(null);
    setPlaceIds(null);
    setHotspotOpen(false);
  };
  const banner =
    !bannerDismissed && location.status !== 'ok' && location.status !== 'locating'
      ? t(`location.${location.status}`, { region: region.name[lang] })
      : null;
  const nextRadius = radius < maxM ? snapRadius(radius * 2.5, minM, maxM) : null;
  // Locate: back to the user, the default reach and now (§5).
  const locate = () => {
    setBannerDismissed(false);
    setPoint(null);
    setRadius(defaultM);
    filters.setWindow('today');
    setAt(null);
    setDay(null);
    setLiveOnly(false);
    setView('map');
    clearCards();
    setRecenter((n) => n + 1);
    location.retry();
  };
  const toggleLive = () => {
    // Live-only is about right now: from a later time or day, it returns to now.
    if (!liveOnly) {
      filters.setWindow('today');
      setAt(null);
      setDay(null);
    }
    setLiveOnly((v) => !v);
  };

  return (
    <div className="app">
      <main className="stage">
        <MapView
          center={searchCenter}
          radiusM={radius}
          events={mapEvents}
          now={pinTime}
          pinMode={pinMode}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setPlaceIds(null);
            setHotspotOpen(false);
          }}
          onSelectPlace={(ids) => {
            setSelectedId(null);
            setPlaceIds(ids);
            setHotspotOpen(false);
          }}
          bottomInset={timelineHeight}
          recenter={recenter}
          hotspot={guidance.hotspot}
          onHotspot={() => {
            setSelectedId(null);
            setHotspotOpen(true);
          }}
          previewRadiusM={previewRadius}
          onCity={() => setRadius(maxM)}
          pinned={point !== null}
          onSetPoint={(p) => {
            setPoint(p);
            clearCards();
          }}
        />
      </main>

      <div className="hud-top">
        <button
          type="button"
          className={`counter${liveOnly ? ' is-on' : ''}`}
          aria-pressed={liveOnly}
          aria-label={t('counter.label', { count: liveCount })}
          onClick={toggleLive}
        >
          <span className={`counter__dot${liveCount ? ' has-live' : ''}`} aria-hidden />
          {loading && loaded.events.length === 0 ? '…' : liveCount}
        </button>
        {error && (
          <span className="hud-error" role="status">
            {t('summary.error')}
          </span>
        )}
        <button
          type="button"
          className={`map-btn${filtered ? ' has-active' : ''}`}
          aria-label={t('settings.open')}
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="sliders" />
          {filtered && <span className="map-btn__badge" aria-hidden />}
        </button>
      </div>

      {banner && (
        <div className="banner" role="status">
          <span>{banner}</span>
          <span className="banner__actions">
            {location.status !== 'outside' && (
              <button type="button" onClick={location.retry}>
                {t('location.useMine')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setBannerDismissed(true);
                storage.set('locationNoticeDismissed', '1');
              }}
            >
              {t('location.dismiss')}
            </button>
          </span>
        </div>
      )}

      <ReachRail radiusM={radius} onChange={setRadius} onPreview={setPreviewRadius} />
      <div className="rail-buttons">
        <button
          type="button"
          className="map-btn"
          onClick={locate}
          aria-label={t(point ? 'point.back' : 'header.locate')}
          data-status={location.status}
          data-pinned={point !== null}
        >
          <Icon name="locate" />
        </button>
        <button
          type="button"
          className="map-btn"
          aria-label={t(view === 'list' ? 'view.toMap' : 'view.list')}
          aria-pressed={view === 'list'}
          onClick={() => {
            clearCards();
            setView(view === 'list' ? 'map' : 'list');
          }}
        >
          <Icon name={view === 'list' ? 'map' : 'list'} />
        </button>
      </div>

      {view === 'list' && (
        <section className="list-overlay" aria-label={t('view.list')}>
          <ListView
            events={events}
            now={now}
            radiusM={radius}
            nextRadiusM={nextRadius}
            around={around}
            guidance={guidance}
            filtered={filtered}
            byDay={days > 0}
            dayFrom={days && day !== null ? starts[day]! : now}
            // A row returns to the map with its pin selected (§5, list style B).
            onSelect={(id) => {
              setView('map');
              setPlaceIds(null);
              setHotspotOpen(false);
              setSelectedId(id);
            }}
            onExpand={setRadius}
            onClearFilters={filters.clear}
          />
        </section>
      )}

      <div className="sheet" style={{ bottom: timelineHeight }}>
        {view === 'map' && selected ? (
          <div className="sheet__card">
            <EventCard
              ev={selected}
              now={now}
              onClose={() => setSelectedId(null)}
              onDetails={() => openDetail(selected.id)}
              onGo={() => go({ name: 'go', id: selected.id })}
            />
          </div>
        ) : view === 'map' && placeEvents.length > 0 ? (
          <div className="sheet__card">
            <PlaceCard
              events={placeEvents}
              now={now}
              onSelect={openDetail}
              onClose={() => setPlaceIds(null)}
            />
          </div>
        ) : view === 'map' && hotspotOpen && guidance.hotspot ? (
          <div className="sheet__card">
            <GuidanceCard
              guidance={guidance}
              radiusM={radius}
              mode="hotspot"
              filtered={filtered}
              fallbackRadiusM={null}
              onExpand={(r) => {
                setRadius(r);
                setHotspotOpen(false);
              }}
              onClearFilters={filters.clear}
              onClose={() => setHotspotOpen(false)}
            />
          </div>
        ) : (
          view === 'map' &&
          !loading &&
          events.length === 0 && (
            <div className="sheet__card">
              <GuidanceCard
                guidance={guidance}
                radiusM={radius}
                mode="empty"
                filtered={filtered}
                fallbackRadiusM={nextRadius}
                onExpand={setRadius}
                onClearFilters={filters.clear}
              />
            </div>
          )
        )}
      </div>

      <div className="timeline-bar" ref={timeline}>
        <TimeLine
          window={filters.window}
          onWindow={(id) => {
            filters.setWindow(id);
            setLiveOnly(false);
            clearCards();
          }}
          now={now}
          timeZone={region.timezone}
          at={at}
          onAt={(v) => {
            setAt(v);
            if (v) setLiveOnly(false);
          }}
          day={day}
          onDay={(d) => {
            setDay(d);
            if (d !== null) setLiveOnly(false);
          }}
          events={loaded.events}
        />
      </div>

      {settingsOpen && (
        <SettingsSheet
          filters={filters}
          count={events.length}
          loading={loading}
          onClose={() => setSettingsOpen(false)}
          onAdd={() => {
            setSettingsOpen(false);
            go({ name: 'add' });
          }}
          onAbout={() => {
            setSettingsOpen(false);
            go({ name: 'about' });
          }}
        />
      )}
      {detailId && (
        <EventDetail
          ev={detail.ev && withFlag(detail.ev, myReports)}
          loading={detail.loading}
          now={now}
          saved={saved.isSaved(detailId)}
          onToggleSave={() => saved.toggle(detailId)}
          onClose={close}
          onReported={addMyReport}
          onGo={() => go({ name: 'go', id: detailId })}
        />
      )}
      {goId && (
        <GoThere
          key={goId}
          ev={detail.ev && withFlag(detail.ev, myReports)}
          now={clock}
          refresh={(id, from) => repo.byId(id, from)}
          onClose={close}
        />
      )}
      {route?.name === 'add' && (
        <AddEvent onClose={close} onOpenEvent={(id) => go({ name: 'event', id }, true)} />
      )}
      {route?.name === 'moderate' && <Moderation onClose={close} />}
      {route?.name === 'about' && (
        <About onClose={close} onModerate={() => go({ name: 'moderate' }, true)} />
      )}
    </div>
  );
}
