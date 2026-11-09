import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from './account';
import {
  agendaDays,
  dayStarts,
  densityClusters,
  diceCategory,
  dicePool,
  familyMatch,
  isOnDay,
  isRunning,
  matchesFilters,
  monthStarts,
  overlaps,
  pinState,
  reachForRoll,
  reweigh,
  rollDice,
  snapRadius,
  topCategories,
  viewIds,
  windowRange,
  type DiceSignal,
  type DiceWeights,
  type HappowEvent,
  type LatLng,
  type NearbyEvent,
  type PlanView,
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
import { useMyEvents } from './hooks/useMyEvents';
import { invitations, useAcceptedInvitations } from './invitations';
import {
  fetchPrivateEvent,
  refreshPrivate,
  usePrivateEvents,
  usePrivateSync,
  type PrivateEvent,
} from './private';
import { ContactLinkSheet } from './components/Contacts';
import { useView } from './hooks/useView';
import { plans, usePlans, usePlanSync } from './plans';
import { reminders } from './reminders';
import { formatRelativeDay } from './format';
import { useLongPress } from './hooks/useLongPress';
import { useShortcut } from './hooks/useShortcut';
import { useI18n } from './i18n';
import { About } from './components/About';
import { Agenda } from './components/Agenda';
import { EveningQueue } from './components/EveningQueue';
import { AddEvent } from './components/AddEvent';
import { EventCard } from './components/EventCard';
import { EventDetail } from './components/EventDetail';
import { GoThere } from './components/GoThere';
import { GuidanceCard } from './components/Guidance';
import { useDistrictGoal } from './hooks/useDistrictGoal';
import { Glyph, Icon } from './components/Icons';
import { ListView } from './components/ListView';
import { MapAddButton } from './components/AddButton';
import { FollowedGroup, FollowedScreen, SearchPanel } from './components/Follow';
import { useFollowMatches, useFollowSync } from './follows';
import { MapView } from './components/MapView';
import { Moderation } from './components/Moderation';
import { SignInSheet, TermsSheet } from './components/SignIn';
import { PickGrid } from './components/PickGrid';
import { PlaceCard } from './components/PlaceCard';
import { ReachRail } from './components/ReachRail';
import { SettingsSheet } from './components/SettingsSheet';
import { TimeLine } from './components/TimeLine';
import type { IconName } from './components/Icons';
import type { PinMode } from './pins';
import { storage } from './storage';
import { useTheme } from './theme';

import { countEvent } from './counts';

type View = 'map' | 'list';

const { minM, maxM, defaultM } = config.app.radius;

/**
 * Family mode moves the hotspot to the device (the density query does not know the mode): square
 * cells of `density.deviceCellM`, near the r8 cells the server uses.
 */
const familyCell = (e: HappowEvent) => {
  const lat = config.app.density.deviceCellM / 111_320;
  const lng = lat / Math.cos((e.point.lat * Math.PI) / 180);
  return `${Math.floor(e.point.lat / lat)}:${Math.floor(e.point.lng / lng)}`;
};

/** The icon of each view on the switcher; the bookmark and calendar the card uses. */
const VIEW_ICON: Record<PlanView, IconName> = {
  all: 'map',
  plans: 'calendar',
  saved: 'bookmark',
  private: 'lock',
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
  // The local atlas: on this device only; a "from here" point is never recorded.
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
  const [grid, setGrid] = useState<'shortcut' | 'dice' | 'view' | null>(null);
  // What the map and list show: everything, your plans, saved.
  const planView = useView();
  const inPlans = planView.view !== 'all';
  const myList = usePlans();
  usePlanSync();
  useFollowSync();
  const [queueDay, setQueueDay] = useState<string | null>(null);
  const closeGrid = useCallback(() => setGrid(null), []);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);
  // The time line: a time today (null = now), or a step of the 14 days (a day) or of the future (a month).
  const [at, setAt] = useState<Date | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [liveOnly, setLiveOnly] = useState(false);
  // Searches move only after ~100 m; labels and windows follow a minute clock, not downloads.
  // Quick add offers "happening here" only with a precise fix.
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
  // Followed artists: matches on open and hourly; their events get the ★.
  const followMatches = useFollowMatches(searchCenter);
  const followedIds = useMemo(
    () => new Set(followMatches.matches.map((m) => m.id)),
    [followMatches.matches],
  );
  // The list's search field and the Followed screen; opening the list focuses the field.
  const [searchFocus, setSearchFocus] = useState(0);
  const [followedOpen, setFollowedOpen] = useState(false);
  const [flyTo, setFlyTo] = useState<{ point: LatLng; seq: number } | null>(null);
  // A list row opened on the map: the map brings its pin into view, and the list stays as it was
  // (scroll position, search text) behind the card's back arrow.
  const [focus, setFocus] = useState<{ point: LatLng; seq: number } | null>(null);
  const [parked, setParked] = useState(false);
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

  // Family mode first, so map, list, counter, hotspot, edge dots and dice agree. Likely
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
  // time. 14 days and the future: everything as dots, or one step's events as glyph pins.
  // The future: months from the end of the day windows, then one step for everything later.
  const future = 'afterDays' in filters.window ? filters.window : null;
  const days = 'days' in filters.window ? filters.window.days : 0;
  const stepped = days > 0 || future !== null;
  const futureFrom = future ? windowRange(future, now, region.timezone).from.getTime() : 0;
  const starts = useMemo(
    () =>
      future
        ? monthStarts(new Date(futureFrom), region.timezone, future.months)
        : days
          ? dayStarts(now, region.timezone, days)
          : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [future, futureFrom, days, future ? 0 : now],
  );
  const pinTime = stepped ? now : (at ?? now);
  const pinMode: PinMode = stepped ? (day === null ? 'range' : 'day') : 'time';
  const visible = useCallback(
    (e: NearbyEvent) => {
      if (liveOnly) return isRunning(e, now);
      if (future) {
        // By start only: what is on today or in the 14 days belongs to those ranges.
        const s = Date.parse(e.startAt);
        return day === null
          ? s >= futureFrom
          : s >= starts[day]!.getTime() && s < starts[day + 1]!.getTime();
      }
      if (!days) return Date.parse(e.endAt) > pinTime.getTime();
      if (day === null) return true;
      return isOnDay(e, starts[day]!, starts[day + 1]!, config.app.timeline.carryOverMin);
    },
    [liveOnly, future, futureFrom, days, day, starts, now, pinTime],
  );
  const events = useMemo(
    () => flagged(familyEvents.filter(visible)),
    [flagged, familyEvents, visible],
  );
  const around = useMemo(
    () => flagged(familyAround.filter(visible)),
    [flagged, familyAround, visible],
  );
  // Your events, read by id: any day and distance. The map's copies fill in at once.
  const invited = useAcceptedInvitations();
  // Private events you own or are invited to, from the API with your sign-in.
  const priv = usePrivateEvents();
  const myIds = useMemo(
    () => [...(viewIds(myList, planView.view, invited) ?? [])],
    [myList, planView.view, invited],
  );
  const known = useMemo(
    () => [...loaded.events, ...loaded.around, ...priv],
    [loaded.events, loaded.around, priv],
  );
  const mine = useMyEvents(repo, myIds, searchCenter, known, inPlans);
  // On the map, a view keeps the time line and the filters: "this evening" plus "my plans" shows
  // tonight's plans. Outside the reach they still show: they're yours.
  const mineOnMap = useMemo(() => {
    if (!inPlans) return [];
    const range = windowRange(filters.window, now, region.timezone);
    return flagged(
      familyOnly(mine.events).filter(
        (e) =>
          e.status !== 'cancelled' &&
          matchesFilters(e, filters) &&
          overlaps(e, range.from, range.to) &&
          visible(e),
      ),
    );
  }, [inPlans, mine.events, filters, now, familyOnly, flagged, visible]);
  // Private events show locked in every view, so none is missed, on the time line and the
  // filters like the rest.
  const privOnMap = useMemo(() => {
    const range = windowRange(filters.window, now, region.timezone);
    return flagged(
      familyOnly([...priv]).filter(
        (e) =>
          e.status !== 'cancelled' &&
          matchesFilters(e, filters) &&
          overlaps(e, range.from, range.to) &&
          visible(e),
      ),
    );
  }, [priv, filters, now, familyOnly, flagged, visible]);
  // The map shows the reach and everything loaded beyond it, as pins everywhere (the nearest
  // off-screen ones as edge dots).
  const mapEvents = useMemo(() => {
    const base = inPlans ? mineOnMap : [...events, ...around];
    const ids = new Set(base.map((e) => e.id));
    const out = [...base, ...privOnMap.filter((e) => !ids.has(e.id))];
    // ★ on a followed artist's pin.
    return followedIds.size
      ? out.map((e) => (followedIds.has(e.id) ? { ...e, followed: true } : e))
      : out;
  }, [inPlans, mineOnMap, events, around, privOnMap, followedIds]);
  // Ended long ago: off the list (a removal, so the account's other devices drop them too).
  const myDays = useMemo(
    () => agendaDays(mine.events, now, region.timezone, config.app.agenda.keepPastDays),
    [mine.events, now],
  );
  useEffect(() => {
    if (myDays.expired.length) plans.remove(myDays.expired);
  }, [myDays.expired]);

  // ● N: on now, in reach, worth going to (not dashed). Always now, whatever the line shows.
  const liveCount = useMemo(
    () =>
      familyEvents.filter((e) => {
        if (!isRunning(e, now)) return false;
        return !pinState(e, now, e.distanceM, radius, config.categories, config.app).late;
      }).length,
    [familyEvents, now, radius],
  );

  const all = useMemo(
    () => [...events, ...around, ...(inPlans ? mineOnMap : []), ...privOnMap],
    [events, around, inPlans, mineOnMap, privOnMap],
  );
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
  usePrivateSync(accountStatus === 'signedIn', searchCenter, config.app.refresh.dataMinutes);
  // Reminders: the server's pending ones, and the subscription tied to the account.
  useEffect(() => {
    if (accountStatus === 'loading') return;
    void reminders
      .relink(lang)
      .then(reminders.refresh)
      .catch(() => {
        /* offline: the bell shows this device's copy */
      });
  }, [accountStatus, lang]);
  // Adding needs an account: signed out, Add opens a sign-in sheet over the map.
  const [addGate, setAddGate] = useState(false);
  const detailId = route?.name === 'event' ? route.id : null;
  const goId = route?.name === 'go' ? route.id : null;
  // Dice: weights on this device; no repeats this session.
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
  // The district goal, only while the reach is empty.
  const goal = useDistrictGoal(repo, !loading && events.length === 0 ? searchCenter : null, now);
  // An edit or an answer on the card reads the event again.
  const [detailVersion, setDetailVersion] = useState(0);
  const detailKnown = useMemo(() => [...events, ...priv], [events, priv]);
  const publicDetail = useEventDetail(
    repo,
    detailId ?? goId,
    detailKnown,
    searchCenter,
    detailVersion,
  );
  // Not public and not in your list: a private event through an invite link, or one you were
  // invited to since the last read.
  const [linkEv, setLinkEv] = useState<{ id: string; ev: PrivateEvent | null } | null>(null);
  const wantId = detailId ?? goId;
  useEffect(() => {
    if (!wantId || publicDetail.ev || publicDetail.loading) return;
    let live = true;
    fetchPrivateEvent(wantId, searchCenter).then(
      (ev) => live && setLinkEv({ id: wantId, ev }),
      () => live && setLinkEv({ id: wantId, ev: null }),
    );
    return () => {
      live = false;
    };
    // Once per id (and after an answer); the centre moving must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantId, publicDetail.ev, publicDetail.loading, detailVersion, accountStatus]);
  const viaLink = linkEv && linkEv.id === wantId ? linkEv.ev : null;
  const detail = publicDetail.ev
    ? publicDetail
    : viaLink
      ? { ev: viaLink, loading: false }
      : {
          ev: null,
          loading: publicDetail.loading || (!!wantId && linkEv?.id !== wantId),
        };
  const loadCredit = useCallback(
    (id: string, signal: AbortSignal) => repo.credit(id, signal),
    [repo],
  );
  // What's on now around an ended event's place, within the map's reach.
  const loadNearby = useCallback(
    (at: LatLng, signal: AbortSignal) => {
      const t = new Date();
      return repo.near({ center: at, radiusM: radius, from: t, to: t }, signal);
    },
    [repo, radius],
  );
  useEffect(() => trackView(route?.name ?? 'map'), [route?.name]);

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
  // Locate: back to the user, the default reach and now.
  const locate = () => {
    setBannerDismissed(false);
    setPoint(null);
    setRadius(defaultM);
    filters.setWindow('today');
    setAt(null);
    setDay(null);
    setLiveOnly(false);
    setView('map');
    setParked(false);
    clearCards();
    setRecenter((n) => n + 1);
    location.retry();
  };
  // Events reported cancelled or moved are never rolled. The pool widens until it has something:
  // close and soon first, then anywhere in the loaded area, then anything still to come in the
  // range shown. Only when all three are empty does the dice say so.
  const dicePools = useMemo(() => {
    const candidates = flagged([...familyEvents, ...familyAround]).filter((e) => !e.flag);
    const late = (e: NearbyEvent) =>
      pinState(e, now, e.distanceM, radius, config.categories, config.app).late;
    const pool = (maxDistanceM: number, soonMin: number) =>
      dicePool(candidates, now, { maxDistanceM, soonMin, liveOnly, late });
    const { maxDistanceM, soonMin } = config.app.dice;
    return [pool(maxDistanceM, soonMin), pool(Infinity, soonMin), pool(Infinity, Infinity)];
  }, [flagged, familyEvents, familyAround, now, liveOnly, radius]);
  const dicePoolNow = dicePools.find((p) => p.length > 0) ?? [];
  const roll = (category?: string) => {
    const pool =
      dicePools.find((p) =>
        category ? p.some((e) => e.categoryIds.includes(category)) : p.length,
      ) ?? [];
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
    setParked(false);
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
  const viewPress = useLongPress(planView.toggle, () => setGrid('view'));
  const viewName = (v: PlanView) => t(`view.${v}`);
  const viewOptions = config.app.agenda.views.map((v) => ({
    id: v,
    icon: VIEW_ICON[v],
    label: viewName(v),
  }));
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
            setParked(false);
          }}
          onSelectPlace={(ids) => {
            setParked(false);
            setSelectedId(null);
            setPlaceIds(ids);
            setHotspotOpen(false);
          }}
          bottomInset={timelineHeight}
          recenter={recenter}
          flyTo={flyTo}
          focus={focus}
          hotspot={inPlans ? null : guidance.hotspot}
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
        <button
          type="button"
          className="map-btn"
          data-on={inPlans}
          aria-pressed={inPlans}
          aria-label={t('view.label', { name: viewName(inPlans ? planView.view : planView.last) })}
          {...viewPress}
        >
          <Icon name={VIEW_ICON[inPlans ? planView.view : planView.last]} filled={inPlans} />
        </button>
        {error && (
          <span className="hud-error" role="status">
            {t('summary.error')}
          </span>
        )}
        <span className="hud-top__end">
          <MapAddButton onClick={startAdd} />
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
      {grid === 'view' && (
        <PickGrid
          label={t('view.pick')}
          options={viewOptions}
          current={planView.view}
          onPick={(id) => {
            planView.choose(id as PlanView);
            setParked(false);
            clearCards();
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
        <div className="toast toast--icon" role="status" style={{ bottom: timelineHeight + 12 }}>
          <Icon name="none" size={20} />
          {toast}
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
          aria-label={t(view === 'list' ? 'view.toMap' : 'view.listSearch')}
          aria-pressed={view === 'list'}
          onClick={() => {
            clearCards();
            if (view === 'list') {
              setView('map');
              setFollowedOpen(false);
            } else if (parked) {
              // The list a row was opened from: back to it as it was.
              setView('list');
            } else {
              setFollowedOpen(false);
              setView('list');
              setSearchFocus((n) => n + 1);
            }
            setParked(false);
          }}
        >
          <Icon name={view === 'list' ? 'map' : 'listSearch'} />
        </button>
      </div>

      {view === 'list' && <div className="list-scrim" aria-hidden onClick={() => setView('map')} />}
      {view === 'list' && inPlans && (
        <section className="list-overlay" aria-label={viewName(planView.view)}>
          <Agenda
            events={flagged(mine.events)}
            gone={mine.gone}
            now={now}
            isGoing={plans.isGoing}
            isInvited={invitations.has}
            onSelect={openDetail}
            onUnsave={plans.toggle}
            onRemoveGone={() => plans.remove(mine.gone)}
            onPlan={setQueueDay}
          />
        </section>
      )}
      {view === 'list' && !inPlans && followedOpen && (
        <section className="list-overlay" aria-label={t('follow.title')}>
          <FollowedScreen onClose={() => setFollowedOpen(false)} />
        </section>
      )}
      {(view === 'list' || parked) && !inPlans && !followedOpen && (
        <section
          className={`list-overlay${view === 'list' ? '' : ' is-parked'}`}
          aria-label={t('view.list')}
          aria-hidden={view !== 'list'}
        >
          <SearchPanel
            key={searchFocus}
            center={searchCenter}
            now={now}
            autoFocus={searchFocus > 0}
            onFollowed={() => setFollowedOpen(true)}
            onOpen={(hit) => {
              // In the loaded snapshot: back to the map with its card, flying there; otherwise
              // the event's page.
              if (all.some((e) => e.id === hit.id)) {
                setView('map');
                setParked(true);
                setPlaceIds(null);
                setHotspotOpen(false);
                setSelectedId(hit.id);
                setFlyTo((f) => ({ point: hit.point, seq: (f?.seq ?? 0) + 1 }));
              } else openDetail(hit.id);
            }}
          >
            <FollowedGroup
              matches={followMatches}
              now={now}
              onOpen={(m) => {
                if (all.some((e) => e.id === m.id)) {
                  setView('map');
                  setParked(true);
                  setPlaceIds(null);
                  setHotspotOpen(false);
                  setSelectedId(m.id);
                  setFlyTo((f) => ({ point: m.point, seq: (f?.seq ?? 0) + 1 }));
                } else openDetail(m.id);
              }}
            />
            <ListView
              events={events}
              now={now}
              radiusM={radius}
              nextRadiusM={nextRadius}
              around={around}
              guidance={guidance}
              filtered={filtered}
              byDay={stepped}
              dayFrom={stepped && day !== null ? starts[day]! : now}
              // A row returns to the map with its pin selected and in view; the list waits
              // behind the card's back arrow.
              onSelect={(id) => {
                const ev = all.find((e) => e.id === id);
                setView('map');
                setParked(true);
                setPlaceIds(null);
                setHotspotOpen(false);
                setSelectedId(id);
                if (ev) setFocus((f) => ({ point: ev.point, seq: (f?.seq ?? 0) + 1 }));
              }}
              onExpand={setRadius}
              onClearFilters={filters.clear}
              goal={goal}
              onAdd={startAdd}
            />
          </SearchPanel>
        </section>
      )}

      <div className="sheet" style={{ bottom: timelineHeight }}>
        {view === 'map' && selected ? (
          <div className="sheet__card">
            <EventCard
              ev={selected}
              now={now}
              followed={followedIds.has(selected.id)}
              onBack={
                parked
                  ? () => {
                      setSelectedId(null);
                      setParked(false);
                      setView('list');
                    }
                  : undefined
              }
              onClose={() => {
                setSelectedId(null);
                setParked(false);
              }}
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
          inPlans &&
          view === 'map' &&
          !mine.loading &&
          mineOnMap.length === 0 && (
            <div className="sheet__card plan-empty" role="status">
              <Icon name={VIEW_ICON[planView.view]} />
              <p>{myIds.length === 0 ? t('agenda.empty') : t('agenda.noneNow')}</p>
              {myIds.length > 0 && (
                <button type="button" className="btn" onClick={() => setView('list')}>
                  {t('agenda.openList')}
                </button>
              )}
            </div>
          )
        )}
      </div>

      <div className="timeline-bar" ref={timeline}>
        <TimeLine
          window={filters.window}
          onWindow={(id) => {
            filters.setWindow(id);
            // A step of the old range means nothing on the new one.
            setDay(null);
            setAt(null);
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
          saved={myList.some((e) => e.id === detailId && e.on)}
          onToggleSave={() => plans.toggle(detailId)}
          onClose={close}
          onReported={addMyReport}
          onGo={() => goThere(detailId)}
          loadCredit={loadCredit}
          loadNearby={loadNearby}
          onOpenEvent={(id) => go({ name: 'event', id }, true)}
          center={searchCenter}
          onChanged={() => {
            setDetailVersion((v) => v + 1);
            void refreshPrivate(searchCenter).catch(() => {});
          }}
        />
      )}
      {route?.name === 'contact' && <ContactLinkSheet token={route.token} onClose={close} />}
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
      {queueDay && (
        <EveningQueue
          day={formatRelativeDay(
            // The day's first event, or now when it's already on.
            new Date(
              Math.max(
                Date.parse(
                  myDays.days.find((d) => d.day === queueDay)?.events[0]?.startAt ??
                    `${queueDay}T12:00:00Z`,
                ),
                now.getTime(),
              ),
            ).toISOString(),
            now,
            region.timezone,
            lang,
          )}
          events={myDays.days.find((d) => d.day === queueDay)?.events ?? []}
          onOpen={(id) => {
            setQueueDay(null);
            openDetail(id);
          }}
          onClose={() => setQueueDay(null)}
        />
      )}
      {needsTerms && <TermsSheet />}
    </div>
  );
}
