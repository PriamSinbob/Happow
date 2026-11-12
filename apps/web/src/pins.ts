import {
  distanceM,
  eventGlyph,
  pinState,
  type LatLng,
  type NearbyEvent,
  type PinState,
} from '@happow/core';
import { categoriesById, config } from './config';

/** A spot on the map: one place (one or more events there) or nearby places merged at this zoom. */
export interface PinGroup {
  key: string;
  kind: 'place' | 'cluster';
  point: LatLng;
  events: NearbyEvent[];
}

/** Properties of one pin feature; the symbol layers style themselves from these. */
export interface PinProps {
  key: string;
  cluster: boolean;
  /** 'day': an event of the day picked on the 14-day line (or the month on the future one) (26 px, glyph, no live hue). */
  kind: PinState['kind'] | 'day';
  glyph: string;
  /** Ring sprite id for live pins, '' otherwise. */
  ring: string;
  late: boolean;
  outside: boolean;
  selected: boolean;
  count: number;
  /** A single event that people or its source say may be off (community flag). */
  flagged: boolean;
  /** "18+" for events with ageMin ≥ 16, '' otherwise. */
  age: string;
  /** A private event at this place: the lock. */
  locked: boolean;
  /** A followed artist performs here: the ★ at the upper left. */
  starred: boolean;
  /** An update you have not seen (the organiser's post, a new time): the red "!" at the upper right. */
  news: boolean;
  /** symbol-sort-key: higher draws on top (selected > live > soon > later, inside > outside). */
  z: number;
  /** Event ids as a JSON array (GeoJSON properties are flat). */
  ids: string;
}

export interface PinFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: PinProps;
}
export interface PinCollection {
  type: 'FeatureCollection';
  features: PinFeature[];
}

/** The event's glyph: its first category's, or a variant from that category's rules (café, bar). */
export function glyphOf(ev: Pick<NearbyEvent, 'categoryIds' | 'title' | 'venue'>): string {
  return eventGlyph(categoriesById.get(ev.categoryIds[0]!), [ev.title, ev.venue?.name ?? '']);
}

/** Age limits from this one up get the numeral badge. */
const AGE_BADGE_MIN = 16;

const RANK = { live: 0, soon: 1, day: 1, later: 2 } as const;

/** The pin a group shows: its most urgent event (live > soon > later), nearest first. */
function lead(events: NearbyEvent[], states: Map<string, PinState>): NearbyEvent {
  return [...events].sort(
    (a, b) => states.get(a.id)!.sortKey - states.get(b.id)!.sortKey || a.distanceM - b.distanceM,
  )[0]!;
}

/**
 * How pins read the time: 'time' for Today at `now` (the time on the line);
 * 'range' for the whole 14 days or the future, every pin a 10 px dot; 'day' for one picked day, every pin a
 * 26 px glyph.
 */
export type PinMode = 'time' | 'range' | 'day';

export function pinFeatures(
  groups: PinGroup[],
  ctx: {
    now: Date;
    center: LatLng;
    radiusM: number;
    selectedId: string | null;
    mode?: PinMode;
    /** Events with an update not seen yet. */
    unread?: ReadonlySet<string>;
  },
): PinCollection {
  const mode = ctx.mode ?? 'time';
  const states = new Map<string, PinState>();
  for (const g of groups)
    for (const e of g.events)
      states.set(
        e.id,
        pinState(
          e,
          ctx.now,
          distanceM(ctx.center, e.point),
          ctx.radiusM,
          config.categories,
          config.app,
        ),
      );
  return {
    type: 'FeatureCollection',
    features: groups.map((g) => {
      const first = lead(g.events, states);
      const live = states.get(first.id)!;
      // Future days carry no live, soon or late: those only mean something today.
      const s: Omit<PinState, 'kind'> & { kind: PinProps['kind'] } =
        mode === 'time'
          ? { ...live }
          : {
              ...live,
              kind: mode === 'day' ? 'day' : 'later',
              ring: null,
              dotted: false,
              late: false,
            };
      const selected = g.events.some((e) => e.id === ctx.selectedId);
      // A selected "later" dot grows into a glyph pin: a 10 px dot can't show a selection.
      if (selected && s.kind === 'later') s.kind = 'day';
      const age = Math.max(...g.events.map((e) => e.ageMin ?? -1));
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [g.point.lng, g.point.lat] },
        properties: {
          key: g.key,
          cluster: g.kind === 'cluster',
          kind: s.kind,
          glyph: glyphOf(first),
          ring: s.ring === null ? '' : s.dotted ? 'ring-dotted' : `ring-${s.ring}`,
          late: s.late,
          outside: s.outside,
          selected,
          count: g.events.length,
          flagged: g.kind === 'place' && g.events.length === 1 && !!first.flag,
          age: g.kind === 'place' && age >= AGE_BADGE_MIN ? `${age}+` : '',
          locked:
            g.kind === 'place' &&
            g.events.some((e) => (e as { visibility?: string }).visibility === 'private'),
          starred:
            g.kind === 'place' &&
            g.events.some((e) => (e as { followed?: boolean }).followed === true),
          news: !!ctx.unread?.size && g.events.some((e) => ctx.unread!.has(e.id)),
          z:
            (selected ? 100 : 0) + (s.outside ? 0 : 10) + (2 - RANK[s.kind]) * 2 + (s.late ? 0 : 1),
          ids: JSON.stringify(g.events.map((e) => e.id)),
        },
      };
    }),
  };
}
