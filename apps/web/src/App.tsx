import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from './account';
import {
  dayStarts,
  densityClusters,
  diceCategory,
  dicePool,
  familyMatch,
  isOnDay,
  isRunning,
  pinState,
  reachForRoll,
  reweigh,
  rollDice,
  snapRadius,
  topCategories,
  type DiceSignal,
  type DiceWeights,
  type HappowEvent,
  type LatLng,
  type NearbyEvent,
} from '@happow/core';
import { trackView } from './analytics';
import { useAtlas } from './atlas/useAtlas';
import { categoriesById, config, region } from './config';
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
import { useLongPress } from './hooks/useLongPress';
import { useShortcut } from './hooks/useShortcut';
import { useI18n } from './i18n';
import { About } from './components/About';
import { AddEvent } from './components/AddEvent';
import { EventCard } from './components/EventCard';
import { EventDetail } from './components/EventDetail';
import { GoThere } from './components/GoThere';
import { GuidanceCard } from './components/Guidance';
import { useDistrictGoal } from './hooks/useDistrictGoal';
import { Glyph, Icon } from './components/Icons';
import { ListView } from './components/ListView';
import { MapView } from './components/MapView';
import { Moderation } from './components/Moderation';
import { SignInSheet, TermsSheet } from './components/SignIn';
import { PickGrid } from './components/PickGrid';
import { PlaceCard } from './components/PlaceCard';
import { ReachRail } from './components/ReachRail';
import { SettingsSheet } from './components/SettingsSheet';
import { TimeLine } from './components/TimeLine';
import type { PinMode } from './pins';
import { storage } from './storage';
import { useTheme } from './theme';

import { countEvent } from './counts';

type View = 'map' | 'list';

const { minM, maxM, defaultM } = config.app.radius;
const { maxEdgeDots } = config.app.density;

/**
 * Family mode moves the hotspot to the device (the density query does not know the mode): square
 * cells of `density.deviceCellM`, near the r8 cells the server uses.
 */
const familyCell = (e: HappowEvent) => {
  const lat = config.app.density.deviceCellM / 111_320;
  const lng = lat / Math.cos((e.point.lat * Math.PI) / 180);
  return `${Math.floor(e.point.lat / lat)}:${Math.floor(e.point.lng / lng)}`;
};

function savedWeights(): DiceWeights {
  try {
    const v: unknown = JSON.parse(storage.get('diceWeights') ?? '{}');
    return v && typeof v === 'object' ? (v as DiceWeights) : {};
  } catch {
    return {};
  }
}

export function App() {
  const { t, lang } = useI18n();
  const repo = useMemo(createRepository, []);
  const location = useGeolocation(region);
  // The local atlas (§6): on this device only; a "from here" point is never recorded.
  const atlas = useAtlas(location.status === 'ok' ? location.position : null, location.accuracy);
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
  const shortcut = useShortcut(filters);
  // The grid a hold opens: the shortcut's choices, or the dice's categories.
  const [grid, setGrid] = useState<'shortcut' | 'dice' | null>(null);
  const closeGrid = useCallback(() => setGrid(null), []);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);
  // The time line (§5, §13.3): a time today (null = now), or a day of the 7 / 14 days.
  const [at, setAt] = useState<Date | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [liveOnly, setLiveOnly] = useState(false);
  // Searches move only after ~100 m; labels and windows follow a minute clock, not downloads.
  // Quick add offers "happening here" only with a precise fix (M12 §4.3).
  const here =
    location.status === 'ok' &&
    location.position &&
    location.accuracy !== null &&
    location.accuracy <= config.app.submissions.quickAdd.maxAccuracyM
      ? location.position
      : null;
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

  // Family mode (§4.4) first, so map, list, counter, hotspot, edge dots and dice agree. Likely
  // family events without age data stay, marked "not confirmed" on their cards.
  const familyOnly = useCallback(
    (list: NearbyEvent[]): NearbyEvent[] => {
      if (!filters.family) return list;
      return list.flatMap((e) => {
        const m = familyMatch(e, config.categories, config.app);
        if (m === 'hide') return [];
        return m === 'unconfirmed' ? [{ ...e, familyUnconfirmed: true }] : [e];
      });
    },
    [filters.family],
  );
  const familyEvents = useMemo(() => familyOnly(loaded.events), [familyOnly, loaded.events]);
  const familyAround = useMemo(() => familyOnly(loaded.around), [familyOnly, loaded.around]);

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
    () => flagged(familyEvents.filter(visible)),
    [flagged, familyEvents, visible],
  );
  const around = useMemo(
    () => flagged(familyAround.filter(visible)),
    [flagged, familyAround, visible],
  );
  // The map shows the reach plus the nearest events beyond it (faded, or edge dots off screen).
  const mapEvents = useMemo(() => [...events, ...around.slice(0, maxEdgeDots)], [events, around]);

  // ● N: on now, in reach, worth going to (not dashed). Always now, whatever the line shows.
  const liveCount = useMemo(
    () =>
      familyEvents.filter((e) => {
        if (!isRunning(e, now)) return false;
        return !pinState(e, now, e.distanceM, radius, config.categories, config.app).late;
      }).length,
    [familyEvents, now, radius],
  );

  const all = useMemo(() => [...events, ...around], [events, around]);
  const selected = all.find((e) => e.id === selectedId) ?? null;
  // A pin with several events at one place lists them; ids that left the results drop out.
  const [placeIds, setPlaceIds] = useState<string[] | null>(null);
  const placeEvents = placeIds ? all.filter((e) => placeIds.includes(e.id)) : [];
  const shownClusters = useMemo(
    () =>
      filters.family
        ? densityClusters([...familyEvents, ...familyAround], radius, familyCell)
        : clusters,
    [filters.family, familyEvents, familyAround, radius, clusters],
  );
  const guidance = useGuidance(shownClusters, searchCenter, radius);
  const [hotspotOpen, setHotspotOpen] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const filtered = filters.activeCount > 0;
  const [route, go] = useRoute();
  const { needsTerms, status: accountStatus } = useAccount();
  // Adding needs an account (M8 §2): signed out, Add opens a sign-in sheet over the map.
  const [addGate, setAddGate] = useState(false);
  const detailId = route?.name === 'event' ? route.id : null;
  const goId = route?.name === 'go' ? route.id : null;
  // Dice (§7): weights on this device; no repeats this session.
  const [diceWeights, setDiceWeights] = useState(savedWeights);
  useEffect(() => storage.set('diceWeights', JSON.stringify(diceWeights)), [diceWeights]);
  const diceSeen = useRef<string[]>([]);
  const [rolledId, setRolledId] = useState<string | null>(null);
  // Opening the rolled event or going there raises its category.
  const signal = (id: string, s: DiceSignal) => {
    if (id !== rolledId) return;
    const e = all.find((x) => x.id === id);
    if (e) setDiceWeights((w) => reweigh(w, diceCategory(e), s));
  };
  const openDetail = (id: string) => {
    signal(id, 'open');
    go({ name: 'event', id });
  };
  const goThere = (id: string) => {
    signal(id, 'go');
    go({ name: 'go', id });
  };
  const close = useCallback(() => go(null), [go]);
  /** The add form, or sign-in first where adding needs an account. */
  const startAdd = () => {
    if (accountStatus === 'signedOut' && config.app.submissions.account === 'required')
      setAddGate(true);
    else go({ name: 'add' });
  };
  // The district goal, only while the reach is empty (M12 §6.2).
  const goal = useDistrictGoal(repo, !loading && events.length === 0 ? searchCenter : null, now);
  const detail = useEventDetail(repo, detailId ?? goId, events, searchCenter);
  const loadCredit = useCallback(
    (id: string, signal: AbortSignal) => repo.credit(id, signal),
    [repo],
  );
  // What's on now around an ended event's place, within the map's reach (M9 §4).
  const loadNearby = useCallback(
    (at: LatLng, signal: AbortSignal) => {
      const t = new Date();
      return repo.near({ center: at, radiusM: radius, from: t, to: t }, signal);
    },
    [repo, radius],
  );
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
  // Events reported cancelled or moved are never rolled.
  const dicePoolNow = useMemo(
    () =>
      dicePool(
        flagged([...familyEvents, ...familyAround]).filter((e) => !e.flag),
        now,
        {
          ...config.app.dice,
          liveOnly,
          late: (e) => pinState(e, now, e.distanceM, radius, config.categories, config.app).late,
        },
      ),
    [flagged, familyEvents, familyAround, now, liveOnly, radius],
  );
  const roll = (category?: string) => {
    const pool = dicePoolNow;
    // Rolling again while the last result is open counts as "not this one".
    let weights = diceWeights;
    const last = rolledId === selectedId ? pool.find((e) => e.id === rolledId) : undefined;
    if (last) {
      weights = reweigh(weights, diceCategory(last), 'reroll');
      setDiceWeights(weights);
    }
    const e = rollDice(pool, { seen: diceSeen.current, weights, category });
    if (!e) {
      setToast(t('dice.empty'));
      return;
    }
    diceSeen.current = [...diceSeen.current, e.id];
    setRolledId(e.id);
    filters.setWindow('today');
    setAt(null);
    setDay(null);
    setView('map');
    setRadius(
      reachForRoll(e.distanceM, radius, config.app.radius.detentsM, config.app.dice.reachMargin),
    );
    setPlaceIds(null);
    setHotspotOpen(false);
    setSelectedId(e.id);
  };
  const dicePress = useLongPress(
    () => roll(),
    () => setGrid('dice'),
  );
  const shortcutPress = useLongPress(shortcut.toggle, () => setGrid('shortcut'));
  const shortcutCategory = shortcut.id === 'family' ? null : categoriesById.get(shortcut.id);
  const shortcutName = shortcutCategory ? shortcutCategory.labels[lang] : t('family.mode');
  const shortcutOptions = [
    { id: 'family', glyph: 'family', label: t('family.mode') },
    ...config.categories.map((c) => ({ id: c.id, glyph: c.glyph, label: c.labels[lang] })),
  ];
  // Only categories the dice can roll right now, by weight.
  const diceOptions = topCategories(
    config.categories
      .map((c) => c.id)
      .filter((id) => dicePoolNow.some((e) => e.categoryIds.includes(id))),
    diceWeights,
    config.app.dice.fanSize,
  ).map((id) => {
    const c = categoriesById.get(id)!;
    return { id, glyph: c.glyph, label: c.labels[lang] };
  });

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
          lit={atlas.lit}
          cellRadiusM={atlas.cellRadiusM}
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
        <button
          type="button"
          className="map-btn"
          data-on={shortcut.on}
          aria-pressed={shortcut.on}
          aria-label={t('shortcut.label', { name: shortcutName })}
          {...shortcutPress}
        >
          <Glyph id={shortcutCategory ? shortcutCategory.glyph : 'family'} size={20} />
        </button>
        {error && (
          <span className="hud-error" role="status">
            {t('summary.error')}
          </span>
        )}
        <span className="hud-top__end">
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
          <button type="button" className="map-btn" aria-label={t('dice.roll')} {...dicePress}>
            <Icon name="dice" />
          </button>
        </span>
      </div>
      {grid === 'shortcut' && (
        <PickGrid
          label={t('shortcut.pick')}
          options={shortcutOptions}
          current={shortcut.id}
          onPick={(id) => {
            shortcut.choose(id);
            setGrid(null);
          }}
          onClose={closeGrid}
        />
      )}
      {grid === 'dice' && (
        <PickGrid
          label={t('dice.pick')}
          options={diceOptions}
          onPick={(id) => {
            setGrid(null);
            roll(id);
          }}
          onClose={closeGrid}
        />
      )}
      {toast && (
        <div
          className="toast toast--icon"
          role="status"
          aria-label={toast}
          style={{ bottom: timelineHeight + 12 }}
        >
          <Icon name="none" size={22} />
        </div>
      )}

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
            goal={goal}
            onAdd={startAdd}
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
              onGo={() => goThere(selected.id)}
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
                goal={goal}
                onAdd={startAdd}
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
            startAdd();
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
          onGo={() => goThere(detailId)}
          loadCredit={loadCredit}
          loadNearby={loadNearby}
          onOpenEvent={(id) => go({ name: 'event', id }, true)}
        />
      )}
      {goId && (
        <GoThere
          key={goId}
          ev={detail.ev && withFlag(detail.ev, myReports)}
          now={clock}
          refresh={(id, from) => repo.byId(id, from)}
          onArrive={(id, point) => {
            atlas.arrive(id, point);
            countEvent(id, 'arrival');
          }}
          onClose={close}
        />
      )}
      {route?.name === 'add' && (
        <AddEvent
          key={route.again ?? 'new'}
          again={route.again ?? null}
          here={here}
          onClose={close}
          onOpenEvent={(id) => go({ name: 'event', id }, true)}
          onOpenAccount={() => go({ name: 'about' }, true)}
        />
      )}
      {route?.name === 'moderate' && <Moderation onClose={close} />}
      {route?.name === 'about' && (
        <About
          atlas={atlas}
          onClose={close}
          onModerate={() => go({ name: 'moderate' }, true)}
          onOpenEvent={(id) => go({ name: 'event', id }, true)}
          onAddAgain={(again) => go({ name: 'add', again }, true)}
        />
      )}
      {addGate && (
        <SignInSheet
          forAdd
          onClose={() => setAddGate(false)}
          onSignedIn={() => {
            setAddGate(false);
            go({ name: 'add' });
          }}
        />
      )}
      {needsTerms && <TermsSheet />}
    </div>
  );
}
