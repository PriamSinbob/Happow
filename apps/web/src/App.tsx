import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { snapRadius, type Language } from '@happow/core';
import { trackView } from './analytics';
import { config, region } from './config';
import { createRepository } from './data';
import { withFlag, useMyReports } from './flags';
import { formatDistance } from './format';
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
import { FilterBar, windowSummary } from './components/FilterBar';
import { FilterSheet } from './components/FilterSheet';
import { GuidanceCard } from './components/Guidance';
import { ListView } from './components/ListView';
import { MapView } from './components/MapView';
import { Moderation } from './components/Moderation';
import { Icon } from './components/Icons';
import { RadiusControl } from './components/RadiusControl';
import { storage } from './storage';

type View = 'map' | 'list';

export function App() {
  const { t, lang, setLang } = useI18n();
  const repo = useMemo(createRepository, []);
  const location = useGeolocation(region);
  const [radius, setRadius] = useRadius();
  const [view, setView] = useState<View>(() => (storage.get('view') === 'list' ? 'list' : 'map'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters = useFilters();
  // Searches move only after ~100 m; labels and windows follow a minute clock, not downloads.
  const searchCenter = useStableCenter(location.center, config.app.refresh.moveThresholdM);
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
  const events = useMemo(
    () => loaded.events.map((e) => withFlag(e, myReports)),
    [loaded.events, myReports],
  );
  const selected = events.find((e) => e.id === selectedId) ?? null;
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

  const panel = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(180);
  const [sheetHeight, setSheetHeight] = useState(200);
  useLayoutEffect(() => {
    const p = panel.current;
    const s = sheet.current;
    if (!p || !s) return;
    const ro = new ResizeObserver(() => {
      setPanelHeight(p.offsetHeight);
      setSheetHeight(s.offsetHeight);
    });
    ro.observe(p);
    ro.observe(s);
    return () => ro.disconnect();
  }, []);

  useEffect(() => storage.set('view', view), [view]);

  const regionName = region.name[lang];
  const banner =
    !bannerDismissed && location.status !== 'ok' && location.status !== 'locating'
      ? t(`location.${location.status}`, { region: regionName })
      : null;
  const nextRadius =
    radius < config.app.radius.maxM
      ? snapRadius(radius * 2.5, config.app.radius.minM, config.app.radius.maxM)
      : null;
  const bannerEl = banner && (
    <div className="banner" role="status">
      <span>{banner}</span>
      <span className="banner__actions">
        {location.status !== 'outside' && (
          <button type="button" onClick={location.retry}>
            {t('location.useMine')}
          </button>
        )}
        <button type="button" onClick={() => setBannerDismissed(true)}>
          {t('location.dismiss')}
        </button>
      </span>
    </div>
  );
  const otherLang = config.app.languages.find((l) => l !== lang) as Language | undefined;

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="brand"
          onClick={() => go({ name: 'about' })}
          aria-label={`${t('header.about')}, ${regionName}`}
        >
          <span className="brand__dot" aria-hidden />
          <span className="brand__name">Happow</span>
          <span className="brand__region">{regionName}</span>
        </button>
        <div className="topbar__actions">
          <button
            type="button"
            className="icon-btn icon-btn--raised"
            onClick={() => go({ name: 'add' })}
            aria-label={t('header.add')}
          >
            <Icon name="plus" />
          </button>
          {otherLang && (
            <button
              type="button"
              className="chip-btn"
              onClick={() => setLang(otherLang)}
              aria-label={t('header.language')}
            >
              {otherLang.toUpperCase()}
            </button>
          )}
          <button
            type="button"
            className="icon-btn icon-btn--raised"
            onClick={() => {
              setBannerDismissed(false);
              setRecenter((n) => n + 1);
              location.retry();
            }}
            aria-label={t('header.locate')}
            data-status={location.status}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path
                fill="currentColor"
                d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"
              />
            </svg>
          </button>
        </div>
      </header>

      <FilterBar
        window={filters.window}
        onWindow={filters.setWindow}
        activeCount={filters.activeCount}
        onOpenFilters={() => setFiltersOpen(true)}
      />

      {view === 'map' && bannerEl}

      <main className="stage">
        <MapView
          center={searchCenter}
          radiusM={radius}
          events={events}
          now={now}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setHotspotOpen(false);
          }}
          bottomInset={panelHeight}
          overlayInset={sheetHeight}
          recenter={recenter}
          hidden={view !== 'map'}
          clusters={clusters}
          hotspot={guidance.hotspot}
          onHotspot={() => {
            setSelectedId(null);
            setHotspotOpen(true);
          }}
          onExpand={setRadius}
        />
        {view === 'list' && (
          <div className="list-wrap" style={{ paddingBottom: panelHeight + 16 }}>
            {bannerEl}
            <ListView
              events={events}
              now={now}
              radiusM={radius}
              nextRadiusM={nextRadius}
              guidance={guidance}
              filtered={filtered}
              onSelect={openDetail}
              onExpand={setRadius}
              onClearFilters={filters.clear}
            />
          </div>
        )}
      </main>

      <div className="sheet" ref={sheet}>
        {selected ? (
          <div className="sheet__card">
            <EventCard
              ev={selected}
              now={now}
              onClose={() => setSelectedId(null)}
              onDetails={() => openDetail(selected.id)}
              onGo={() => go({ name: 'go', id: selected.id })}
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
        <section className="panel" ref={panel} aria-label={t('radius.label')}>
          <div className="panel__summary" aria-live="polite">
            {loading && events.length === 0 ? (
              t('summary.loading')
            ) : (
              <>
                <strong>
                  {t('summary.count', {
                    count: events.length,
                    radius: formatDistance(radius, lang),
                  })}
                </strong>{' '}
                <span className="muted">· {windowSummary(t, filters.window)}</span>
              </>
            )}
            {error && <span className="panel__error">{t('summary.error')}</span>}
          </div>
          <RadiusControl radius={radius} onChange={setRadius} />
          <div className="segmented" role="tablist" aria-label={t('view.label')}>
            {(['map', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={view === v ? 'is-active' : ''}
                onClick={() => setView(v)}
              >
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </section>
      </div>

      {filtersOpen && (
        <FilterSheet
          filters={filters}
          count={events.length}
          loading={loading}
          onClose={() => setFiltersOpen(false)}
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
