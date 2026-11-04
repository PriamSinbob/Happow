import { localDay } from './atlas.js';
import { entryOf } from './entry.js';
import { distanceM } from './geo.js';
import type { AppConfig, Category, HappowEvent } from './types.js';

/**
 * Plan ahead (M10, docs/milestones/M10-plan-ahead.md): the saved list a device keeps and an
 * account syncs, the agenda's days, and the evening queue.
 */

export type AgendaConfig = AppConfig['agenda'];
export type PlanView = AgendaConfig['views'][number];

/**
 * One event on someone's list (§1, §2). A removal is kept as `on: false` for a while, so a phone
 * that was offline doesn't bring the event back. `going`: marked "I'm going" (which also saves).
 * `at`: when it last changed, in milliseconds; the latest change wins when lists are merged.
 */
export interface PlanEntry {
  id: string;
  on: boolean;
  going: boolean;
  at: number;
}

const DAY_MS = 86_400_000;

/**
 * Two lists as one (§2): per event the latest change wins (on a tie, `b`, the server's). Removals
 * older than `keepRemovedDays` go; of the saved ones, the oldest go past `maxSaved`.
 */
export function mergePlans(
  a: readonly PlanEntry[],
  b: readonly PlanEntry[],
  now: number,
  cfg: Pick<AgendaConfig, 'keepRemovedDays' | 'maxSaved'>,
): PlanEntry[] {
  const byId = new Map<string, PlanEntry>();
  for (const e of [...a, ...b]) {
    const prev = byId.get(e.id);
    if (!prev || e.at >= prev.at) byId.set(e.id, e);
  }
  const all = [...byId.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
  const live = all.filter((e) => e.on);
  const drop = new Set(live.slice(0, Math.max(0, live.length - cfg.maxSaved)).map((e) => e.id));
  const removedAfter = now - cfg.keepRemovedDays * DAY_MS;
  return all.filter((e) => !drop.has(e.id) && (e.on || e.at >= removedAfter));
}

/** The list after one save, removal or "going" change. "I'm going" also saves (owner, 2026-11-04). */
export function setPlan(
  list: readonly PlanEntry[],
  id: string,
  change: { on?: boolean; going?: boolean },
  now: number,
): PlanEntry[] {
  const prev = list.find((e) => e.id === id);
  const going = change.going ?? (change.on === false ? false : (prev?.going ?? false));
  // Marking going saves; taking "going" back leaves the bookmark as it was.
  const on = change.on ?? (change.going ? true : (prev?.on ?? false));
  const next: PlanEntry = { id, on, going: on && going, at: Math.max(now, (prev?.at ?? 0) + 1) };
  return [...list.filter((e) => e.id !== id), next];
}

/**
 * An invitation the person accepted (M11). Until M11 the source is empty; its events are always in
 * "My plans" and can't be un-bookmarked (declining removes them). `private`: a private event,
 * shown in the Private view too.
 */
export interface AcceptedInvitation {
  id: string;
  private: boolean;
}

/**
 * Event ids a view shows; null for "everything" (§1, §6). My plans: saved ∪ going ∪ accepted
 * invitations ("going" always saves); Saved: the bookmarks only; Private: the private events
 * you're invited to.
 */
export function viewIds(
  list: readonly PlanEntry[],
  view: PlanView,
  invited: readonly AcceptedInvitation[] = [],
): Set<string> | null {
  if (view === 'all') return null;
  if (view === 'private') return new Set(invited.filter((i) => i.private).map((i) => i.id));
  const saved = list.filter((e) => e.on || e.going).map((e) => e.id);
  if (view === 'saved') return new Set(saved);
  return new Set([...saved, ...invited.map((i) => i.id)]);
}

type Timed = Pick<HappowEvent, 'id' | 'startAt' | 'endAt'>;

export interface AgendaDay<E> {
  /** "2026-11-07" in the region's time zone. */
  day: string;
  events: E[];
}

/**
 * Your events by day (§1): upcoming ones under the day they are on from now (a running one counts
 * today and comes first), by start time; ended ones in `past`, newest first, for
 * `keepPastDays`. `expired` lists the ids past that, for the device to drop.
 */
export function agendaDays<E extends Timed>(
  events: readonly E[],
  now: Date,
  timeZone: string,
  keepPastDays: number,
): { days: AgendaDay<E>[]; past: E[]; expired: string[] } {
  const t = now.getTime();
  const from = (e: E) => Math.max(Date.parse(e.startAt), t);
  const upcoming = events
    .filter((e) => Date.parse(e.endAt) > t)
    .sort((a, b) => from(a) - from(b) || Date.parse(a.startAt) - Date.parse(b.startAt));
  const days = new Map<string, E[]>();
  for (const e of upcoming) {
    const day = localDay(new Date(from(e)), timeZone);
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  const keepAfter = t - keepPastDays * DAY_MS;
  const ended = events.filter((e) => Date.parse(e.endAt) <= t);
  return {
    days: [...days].map(([day, evs]) => ({ day, events: evs })),
    past: ended
      .filter((e) => Date.parse(e.endAt) > keepAfter)
      .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)),
    expired: ended.filter((e) => Date.parse(e.endAt) <= keepAfter).map((e) => e.id),
  };
}

type QueueConfig = Pick<AppConfig, 'walkingSpeedMPerMin' | 'arrival' | 'agenda'> & {
  navigation: Pick<AppConfig['navigation'], 'maxMinutes'>;
};

/** Minutes on foot (M6 §4.2's estimate), rounded up to `agenda.walkRoundMin` (§3). */
export function walkMinutes(meters: number, app: QueueConfig): number {
  const exact = (meters * app.arrival.detourFactor) / app.walkingSpeedMPerMin;
  const step = app.agenda.walkRoundMin;
  return Math.max(0, Math.ceil(exact / step - 1e-9)) * step;
}

/** How the walk from one event to the next works out (§3). Times are ISO strings. */
export type LegVerdict =
  | { kind: 'fine'; spareMin: number }
  /** The next one is open entry and already open when you'd get there. */
  | { kind: 'openUntil'; until: string }
  /** The next one (fixed entry) starts before you leave this one. */
  | { kind: 'overlap'; min: number }
  /** You'd get to the next one (fixed entry) after its start and grace. */
  | { kind: 'late'; min: number }
  /** This one is open entry: leaving by `by` makes the next one on time. */
  | { kind: 'leaveEarly'; by: string }
  /** The next one (open entry) closes before you'd get there. */
  | { kind: 'closed' };

export interface QueueLeg {
  from: string;
  to: string;
  walkMin: number;
  /** Over `navigation.maxMinutes` on foot: offer transit instead. */
  long: boolean;
  leaveAt: string;
  arrival: string;
  verdict: LegVerdict;
}

export interface QueueStop<E> {
  event: E;
  /** When you leave it: its end, or an earlier time you chose. */
  leaveAt: string;
  /** You chose to leave before the end. */
  early: boolean;
}

type QueueEvent = HappowEvent;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * An evening of several events in start order (§3), with the walk between each pair and what it
 * means for the next one. Nothing is moved or dropped: the verdicts only say how it works out.
 * `leaveAt` holds times chosen on the device, kept between the event's start and its end.
 */
export function eveningQueue<E extends QueueEvent>(
  events: readonly E[],
  leaveAt: Readonly<Record<string, string>>,
  categories: Category[],
  app: QueueConfig,
): { stops: QueueStop<E>[]; legs: QueueLeg[] } {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || (a.id < b.id ? -1 : 1),
  );
  const stops = sorted.map((event) => {
    const start = Date.parse(event.startAt);
    const end = Date.parse(event.endAt);
    const chosen = leaveAt[event.id] ? Date.parse(leaveAt[event.id]!) : NaN;
    const leave = Number.isFinite(chosen) ? Math.min(end, Math.max(start, chosen)) : end;
    return { event, leaveAt: iso(leave), early: leave < end };
  });
  const legs: QueueLeg[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!.event;
    const walkMin = walkMinutes(distanceM(a.event.point, b.point), app);
    const leave = Date.parse(a.leaveAt);
    const arrival = leave + walkMin * MIN;
    const start = Date.parse(b.startAt);
    const end = Date.parse(b.endAt);
    const next = entryOf(b, categories);
    const self = entryOf(a.event, categories);
    let verdict: LegVerdict;
    if (next.entry === 'open') {
      if (arrival >= end - app.arrival.openLastEntryMin * MIN) verdict = { kind: 'closed' };
      else if (arrival <= start)
        verdict = { kind: 'fine', spareMin: Math.floor((start - arrival) / MIN) };
      else verdict = { kind: 'openUntil', until: b.endAt };
    } else if (arrival <= start + next.graceMin * MIN) {
      verdict = { kind: 'fine', spareMin: Math.max(0, Math.floor((start - arrival) / MIN)) };
    } else {
      // An open-entry event can be left early: say by when, if that's after it starts.
      const by = start - walkMin * MIN;
      if (self.entry === 'open' && by > Date.parse(a.event.startAt))
        verdict = { kind: 'leaveEarly', by: iso(by) };
      else if (leave > start) verdict = { kind: 'overlap', min: Math.ceil((leave - start) / MIN) };
      else verdict = { kind: 'late', min: Math.ceil((arrival - start) / MIN) };
    }
    legs.push({
      from: a.event.id,
      to: b.id,
      walkMin,
      long: walkMin > app.navigation.maxMinutes,
      leaveAt: a.leaveAt,
      arrival: iso(arrival),
      verdict,
    });
  }
  return { stops, legs };
}

/** A chosen leave time one step earlier or later, on the step grid, within the event (§3). */
export function stepLeave(
  ev: Pick<HappowEvent, 'startAt' | 'endAt'>,
  current: string,
  dir: -1 | 1,
  stepMin: number,
): string {
  const start = Date.parse(ev.startAt);
  const end = Date.parse(ev.endAt);
  const step = stepMin * MIN;
  const t = Date.parse(current);
  const snapped = dir < 0 ? Math.ceil(t / step) * step - step : Math.floor(t / step) * step + step;
  return iso(Math.min(end, Math.max(start, snapped)));
}
