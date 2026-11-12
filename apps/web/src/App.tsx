import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from './account';
import {
  agendaDays,
  dayStarts,
  densityClusters,
  familyMatch,
  isOnDay,
  isRunning,
  matchesFilters,
  monthStarts,
  overlaps,
  pinState,
  reachForRoll,
  snapRadius,
  viewIds,
  windowRange,
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
import { useDice } from './hooks/useDice';
import { useEvents } from './hooks/useEvents';
import { useGuidance } from './hooks/useGuidance';
import { useFilters } from './hooks/useFilters';
import { useGeolocation, useStableCenter } from './hooks/useGeolocation';
import { useMinuteClock } from './hooks/useClock';
import { useRoute } from './hooks/useHashRoute';
import { useRadius } from './hooks/useRadius';
import { useMyEvents } from './hooks/useMyEvents';
import { useOpenEvent } from './hooks/useOpenEvent';
import { invitations, useAcceptedInvitations } from './invitations';
import { isPrivate, refreshPrivate, usePrivateEvents, usePrivateSync } from './private';
import { ContactLinkSheet } from './components/Contacts';
import { useView } from './hooks/useView';
import { openPlaces, partyAt, usePlaces } from './places';
import { plans, usePlans, usePlanSync } from './plans';
import { reminders, useReminders } from './reminders';
import { updates, useUnread, useUpdatesSync, useUpdatesVersion, type News } from './updates';
import { formatRelativeDay } from './format';
import { useLongPress } from './hooks/useLongPress';
import { useShortcut } from './hooks/useShortcut';
import { useI18n } from './i18n';
import { About } from './components/About';
import { Agenda } from './components/Agenda';
import { EveningQueue } from './components/EveningQueue';
import { AddEvent } from './components/AddEvent';
import { AddPlace } from './components/AddPlace';
import { PlaceEdit } from './components/PlaceEdit';
import { Sheet } from './components/Sheet';
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
import { OpenPlaceCard } from './components/OpenPlaceCard';
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

/**
 * The one card over the map: an event, an open place, a pin with several events at one place, or
 * the hotspot. One value, so opening any of them closes the others.
 */
type MapCard =
  | { kind: 'event'; id: string }
  | { kind: 'place'; id: string }
  | { kind: 'venue'; eventIds: string[] }
  | { kind: 'hotspot' }
  | null;

export function App() {
  const { t, lang } = useI18n();
  const repo = useMemo(createRepository, []);
  const location = useGeolocation(region);
  // The local atlas: on this device only; a "from here" point is never recorded.
  const atlas = useAtlas(location.status === 'ok' ? location.position : null, location.accuracy);
  const [radius, setRadius] = useRadius();
  const [previewRadius, setPreviewRadius] = useState<number | null>(null);
  const [view, setView] = useState<View>('map');
  const [card, setCard] = useState<MapCard>(null);
  const selectedId = card?.kind === 'event' ? card.id : null;
  const openPlaceId = card?.kind === 'place' ? card.id : null;
  const placeIds = card?.kind === 'venue' ? card.eventIds : null;
  const hotspotOpen = card?.kind === 'hotspot';
  const clearCards = useCallback(() => setCard(null), []);
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
  /** The line back to today, at the present moment. */
  const backToNow = () => {
    filters.setWindow('today');
    setAt(null);
    setDay(null);
  };
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
    day,
  );
  // The time line's bars cover the whole range even while one month is read on its own. Outside
  // the future range this is the same question as above, answered from the same snapshot.
  const overview = useEvents(
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
  const shownNow = useCallback(
    (list: readonly NearbyEvent[]) => {
      const range = windowRange(filters.window, now, region.timezone);
      return flagged(
        familyOnly([...list]).filter(
          (e) =>
            e.status !== 'cancelled' &&
            matchesFilters(e, filters) &&
            overlaps(e, range.from, range.to) &&
            visible(e),
        ),
      );
    },
    [filters, now, familyOnly, flagged, visible],
  );
  const mineOnMap = useMemo(
    () => (inPlans ? shownNow(mine.events) : []),
    [inPlans, mine.events, shownNow],
  );
  // Private events show locked in every view, so none is missed, on the time line and the
  // filters like the rest.
  const privOnMap = useMemo(() => shownNow(priv), [priv, shownNow]);
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
  // Open places (restaurants, pubs, galleries) at the time looked at today: not on a day or month
  // of the line, not in "my plans", not with live-only on. An event at a place takes its pin.
  const showPlaces = !stepped && !inPlans && !liveOnly;
  const allPlaces = usePlaces(searchCenter, showPlaces);
  const placesOnMap = useMemo(
    () =>
      showPlaces
        ? openPlaces(
            allPlaces,
            pinTime,
            region.timezone,
            searchCenter,
            filters,
            mapEvents.map((e) => e.point),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      showPlaces,
      allPlaces,
      pinTime.getTime(),
      searchCenter,
      filters.categories,
      filters.excluded,
      mapEvents,
    ],
  );
  const openPlace = placesOnMap.find((p) => p.id === openPlaceId) ?? null;
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
  const placeEvents = placeIds ? all.filter((e) => placeIds.includes(e.id)) : [];
  const shownClusters = useMemo(
    () =>
      filters.family
        ? densityClusters([...familyEvents, ...familyAround], radius, familyCell)
        : clusters,
    [filters.family, familyEvents, familyAround, radius, clusters],
  );
  const guidance = useGuidance(shownClusters, searchCenter, radius);
  const [recenter, setRecenter] = useState(0);
  const filtered = filters.activeCount > 0;
  const [route, go] = useRoute();
  const { needsTerms, status: accountStatus, member } = useAccount();
  // Adding and correcting need the activated account: signed out or still waiting for the code,
  // the sign-in sheet comes first (waiting, it opens on the code).
  const needsSignIn = accountStatus === 'signedOut' || accountStatus === 'pending';
  usePrivateSync(member, searchCenter, config.app.refresh.dataMinutes);
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
  // The plus asks first what to add; signed out, sign-in comes before the form.
  const [addChoice, setAddChoice] = useState(false);
  const [addGate, setAddGate] = useState<{ what: 'event' | 'place'; at?: string } | null>(null);
  // A private event at a place: the place it was started from, for the add form.
  const [eventPlace, setEventPlace] = useState<{
    id: string;
    name: string;
    address: string | null;
    point: LatLng;
  } | null>(null);
  // Correcting the open place; signed out, sign-in first.
  const [placeEdit, setPlaceEdit] = useState<'edit' | 'signIn' | null>(null);
  const detailId = route?.name === 'event' ? route.id : null;
  const goId = route?.name === 'go' ? route.id : null;
  const diceEvents = useMemo(
    () => flagged([...familyEvents, ...familyAround]),
    [flagged, familyEvents, familyAround],
  );
  const dice = useDice({ events: diceEvents, now, radiusM: radius, liveOnly });
  const openDetail = (id: string) => {
    dice.signal(
      all.find((e) => e.id === id),
      'open',
    );
    go({ name: 'event', id });
  };
  const goThere = (id: string) => {
    dice.signal(
      all.find((e) => e.id === id),
      'go',
    );
    go({ name: 'go', id });
  };
  const close = useCallback(() => go(null), [go]);
  /** The add form, or sign-in first where adding needs an account (a place always does). */
  const startAdd = (what: 'event' | 'place', at?: string) => {
    setAddChoice(false);
    if (needsSignIn && (what === 'place' || config.app.submissions.account === 'required'))
      setAddGate({ what, at });
    else go(what === 'place' ? { name: 'addPlace' } : { name: 'add', ...(at && { place: at }) });
  };
  // Updates on the events that are yours: what is saved, marked going or has a reminder (public
  // ones are asked about; private ones bring theirs). Unseen ones carry the red "!".
  const reminderMap = useReminders();
  const watched = useMemo(
    () => [
      ...new Set([...myList.filter((e) => e.on).map((e) => e.id), ...Object.keys(reminderMap)]),
    ],
    [myList, reminderMap],
  );
  useUpdatesSync(watched);
  useEffect(() => updates.setPrivate(priv), [priv]);
  const unread = useUnread();
  // The newest unseen update is announced once over the map; a tap opens the event.
  const newsVersion = useUpdatesVersion();
  const [notice, setNotice] = useState<{ id: string; news: News } | null>(null);
  useEffect(() => {
    const fresh = updates.takeNew();
    if (fresh.length) setNotice(fresh[0]!);
  }, [newsVersion]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(id);
  }, [notice]);
  // Its card is open: the update is on screen, the notice has done its work.
  useEffect(() => {
    if (notice && selectedId === notice.id) setNotice(null);
  }, [notice, selectedId]);
  // The district goal, only while the reach is empty.
  const goal = useDistrictGoal(repo, !loading && events.length === 0 ? searchCenter : null, now);
  // An edit or an answer on the card reads the event again.
  const [detailVersion, setDetailVersion] = useState(0);
  const detailKnown = useMemo(() => [...events, ...priv], [events, priv]);
  const detail = useOpenEvent(
    repo,
    detailId ?? goId,
    detailKnown,
    searchCenter,
    detailVersion,
    accountStatus,
  );
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
    backToNow();
    setLiveOnly(false);
    setView('map');
    setParked(false);
    clearCards();
    setRecenter((n) => n + 1);
    location.retry();
  };
  const roll = (category?: string) => {
    const e = dice.roll(category, selectedId);
    if (!e) {
      setToast(t('dice.empty'));
      return;
    }
    backToNow();
    setView('map');
    setParked(false);
    setRadius(
      reachForRoll(e.distanceM, radius, config.app.radius.detentsM, config.app.dice.reachMargin),
    );
    setCard({ kind: 'event', id: e.id });
  };
  /** A list row opens on the map with its card; the list waits behind the card's back arrow. */
  const showOnMap = (id: string) => {
    setView('map');
    setParked(true);
    setCard({ kind: 'event', id });
  };
  /**
   * A search hit or a followed artist's date. In the loaded snapshot: back to the map with its
   * card, flying there; otherwise the event's page.
   */
  const openHit = (hit: { id: string; point: LatLng }) => {
    if (!all.some((e) => e.id === hit.id)) return openDetail(hit.id);
    showOnMap(hit.id);
    setFlyTo((f) => ({ point: hit.point, seq: (f?.seq ?? 0) + 1 }));
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
  const diceOptions = dice.categories.map((id) => {
    const c = categoriesById.get(id)!;
    return { id, glyph: c.glyph, label: c.labels[lang] };
  });

  const toggleLive = () => {
    // Live-only is about right now: from a later time or day, it returns to now.
    if (!liveOnly) backToNow();
    setLiveOnly((v) => !v);
  };

  return (
    <div className="app">
      <main className="stage">
        <MapView
          center={searchCenter}
          radiusM={radius}
          events={mapEvents}
          unread={unread}
          now={pinTime}
          pinMode={pinMode}
          // A pin with several events is selected through any one of them.
          selectedId={selectedId ?? placeIds?.[0] ?? null}
          // A tap on the bare map (null) closes whatever card is open.
          onSelect={(id) => {
            setCard(id ? { kind: 'event', id } : null);
            setParked(false);
          }}
          places={placesOnMap}
          selectedPlaceId={openPlaceId}
          onSelectOpenPlace={(id) => {
            setCard({ kind: 'place', id });
            setParked(false);
          }}
          onSelectPlace={(eventIds) => {
            setCard({ kind: 'venue', eventIds });
            setParked(false);
          }}
          bottomInset={timelineHeight}
          recenter={recenter}
          flyTo={flyTo}
          focus={focus}
          hotspot={inPlans ? null : guidance.hotspot}
          onHotspot={() => setCard({ kind: 'hotspot' })}
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
          <MapAddButton onClick={() => setAddChoice(true)} />
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
      {notice && !detailId && (
        <button
          type="button"
          className="update-notice"
          onClick={() => {
            setNotice(null);
            openDetail(notice.id);
          }}
        >
          <span className="badge badge--news" aria-hidden>
            !
          </span>
          <span className="update-notice__text">
            <strong>
              {notice.news.posts[0]
                ? `${t(`organiser.kind.${notice.news.posts[0].kind}`)}: ${notice.news.title}`
                : notice.news.title}
            </strong>
            <span>{notice.news.posts[0]?.body ?? t('updates.changed')}</span>
          </span>
        </button>
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
            onOpen={openHit}
          >
            <FollowedGroup matches={followMatches} now={now} onOpen={openHit} />
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
                showOnMap(id);
                const ev = all.find((e) => e.id === id);
                if (ev) setFocus((f) => ({ point: ev.point, seq: (f?.seq ?? 0) + 1 }));
              }}
              onExpand={setRadius}
              onClearFilters={filters.clear}
              goal={goal}
              onAdd={() => setAddChoice(true)}
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
              party={
                isPrivate(selected)
                  ? null
                  : partyAt(allPlaces, pinTime, selected.point, searchCenter)
              }
              onBack={
                parked
                  ? () => {
                      clearCards();
                      setParked(false);
                      setView('list');
                    }
                  : undefined
              }
              onClose={() => {
                clearCards();
                setParked(false);
              }}
              onDetails={() => openDetail(selected.id)}
              onGo={() => goThere(selected.id)}
            />
          </div>
        ) : view === 'map' && openPlace ? (
          <div className="sheet__card">
            <OpenPlaceCard
              place={openPlace}
              now={pinTime}
              timeZone={region.timezone}
              onClose={clearCards}
              onEdit={() => setPlaceEdit(needsSignIn ? 'signIn' : 'edit')}
              onPrivateEvent={() => {
                setEventPlace({
                  id: openPlace.id,
                  name: openPlace.name,
                  address: openPlace.address,
                  point: openPlace.point,
                });
                startAdd('event', openPlace.id);
              }}
            />
          </div>
        ) : view === 'map' && placeEvents.length > 0 ? (
          <div className="sheet__card">
            <PlaceCard events={placeEvents} now={now} onSelect={openDetail} onClose={clearCards} />
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
                clearCards();
              }}
              onClearFilters={filters.clear}
              onClose={clearCards}
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
          events={future ? overview.events : loaded.events}
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
          party={
            detail.ev && !isPrivate(detail.ev)
              ? partyAt(allPlaces, now, detail.ev.point, searchCenter)
              : null
          }
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
          key={route.again ?? route.place ?? 'new'}
          again={route.again ?? null}
          place={
            route.place
              ? ((eventPlace?.id === route.place ? eventPlace : null) ??
                allPlaces.find((p) => p.id === route.place) ??
                null)
              : null
          }
          here={here}
          onClose={close}
          onOpenEvent={(id) => go({ name: 'event', id }, true)}
          onOpenAccount={() => go({ name: 'about' }, true)}
        />
      )}
      {route?.name === 'addPlace' && (
        <AddPlace
          onClose={close}
          onShow={(id, point) => {
            close();
            setCard({ kind: 'place', id });
            setFocus((f) => ({ point, seq: (f?.seq ?? 0) + 1 }));
          }}
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
      {addChoice && (
        <Sheet title={t('addChoice.title')} onClose={() => setAddChoice(false)}>
          <div className="choices">
            <button type="button" className="choice" onClick={() => startAdd('event')}>
              {t('addChoice.event')}
              <span>{t('addChoice.eventHint')}</span>
            </button>
            <button type="button" className="choice" onClick={() => startAdd('place')}>
              {t('addChoice.place')}
              <span>{t('addChoice.placeHint')}</span>
            </button>
          </div>
        </Sheet>
      )}
      {addGate && (
        <SignInSheet
          forAdd={addGate.what === 'event'}
          onClose={() => setAddGate(null)}
          onSignedIn={() => {
            go(
              addGate.what === 'place'
                ? { name: 'addPlace' }
                : { name: 'add', ...(addGate.at && { place: addGate.at }) },
            );
            setAddGate(null);
          }}
        />
      )}
      {placeEdit === 'signIn' && (
        <SignInSheet onClose={() => setPlaceEdit(null)} onSignedIn={() => setPlaceEdit('edit')} />
      )}
      {placeEdit === 'edit' && openPlace && (
        <PlaceEdit
          place={openPlace}
          now={pinTime}
          timeZone={region.timezone}
          onClose={() => setPlaceEdit(null)}
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
