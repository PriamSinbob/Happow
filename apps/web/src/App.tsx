import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { snapRadius, type Language } from '@happow/core';
import { config, region } from './config';
import { createRepository } from './data';
import { formatDistance } from './format';
import { useEventDetail } from './hooks/useEventDetail';
import { useEvents } from './hooks/useEvents';
import { useFilters } from './hooks/useFilters';
import { useGeolocation } from './hooks/useGeolocation';
import { useDetailRoute } from './hooks/useHashRoute';
import { useRadius } from './hooks/useRadius';
import { useSaved } from './hooks/useSaved';
import { useI18n } from './i18n';
import { EventCard } from './components/EventCard';
import { EventDetail } from './components/EventDetail';
import { FilterBar, windowSummary } from './components/FilterBar';
import { FilterSheet } from './components/FilterSheet';
import { ListView } from './components/ListView';
import { MapView } from './components/MapView';
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
  const { events, loading, error, now } = useEvents(
    repo,
    location.center,
    radius,
    region.timezone,
    filters.window,
    filters,
  );
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const [detailId, openDetail] = useDetailRoute();
  const detail = useEventDetail(repo, detailId, events, location.center);
  const saved = useSaved();

  const panel = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(180);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelHeight(el.offsetHeight));
    ro.observe(el);
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
        <div className="brand">
          <span className="brand__dot" aria-hidden />
          <span className="brand__name">Happow</span>
          <span className="brand__region">{regionName}</span>
        </div>
        <div className="topbar__actions">
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
          center={location.center}
          userPosition={location.position}
          radiusM={radius}
          events={events}
          now={now}
          selectedId={selectedId}
          onSelect={setSelectedId}
          bottomInset={panelHeight}
          hidden={view !== 'map'}
        />
        {view === 'list' && (
          <div className="list-wrap" style={{ paddingBottom: panelHeight + 16 }}>
            {bannerEl}
            <ListView
              events={events}
              now={now}
              radiusM={radius}
              nextRadiusM={nextRadius}
              filtered={filters.activeCount > 0}
              onSelect={openDetail}
              onExpand={setRadius}
              onClearFilters={filters.clear}
            />
          </div>
        )}
      </main>

      <div className="sheet">
        {selected && (
          <div className="sheet__card">
            <EventCard
              ev={selected}
              now={now}
              onClose={() => setSelectedId(null)}
              onDetails={() => openDetail(selected.id)}
            />
          </div>
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
          ev={detail.ev}
          loading={detail.loading}
          now={now}
          saved={saved.isSaved(detailId)}
          onToggleSave={() => saved.toggle(detailId)}
          onClose={() => openDetail(null)}
        />
      )}
    </div>
  );
}
