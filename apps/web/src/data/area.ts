import {
  areaKey,
  densityClusters,
  distanceM,
  matchesFilters,
  nearby,
  overlaps,
  rowToEvent,
  type DensityCluster,
  type DensityQuery,
  type EventQuery,
  type EventRow,
  type HappowEvent,
  type LatLng,
  type NearbyEvent,
} from '@happow/core';
import { config } from '../config';
import type { Credit, DistrictGoal, EventRepository } from './repository';

const { refresh, density } = config.app;
/** The 24-hour snapshot follows the data step; multi-day ones change slowly. */
const stepMs = (range: string | undefined) =>
  (range ? refresh.longCacheMinutes : refresh.dataMinutes) * 60_000;

interface Snapshot {
  key: string;
  /** Start of the server's refresh step; the snapshot is reused until the step ends. */
  from: number;
  events: HappowEvent[];
}

/** An event measured from where the reader is: /api rows carry no distance of their own. */
const from = (row: EventRow, at: LatLng): NearbyEvent => {
  const ev = rowToEvent(row);
  return { ...ev, distanceM: distanceM(at, ev.point) };
};

/**
 * Where the app reads events with a backend: everything through /api, nothing from the database
 * directly, so a native app reads exactly the same way.
 *
 * Battery- and data-friendly: one cached snapshot of the surrounding area per refresh step
 * (`/api/area`), from which the list, the radius, time windows, filters and hotspot counts are all
 * worked out on the phone. Changing a filter or the radius, or a minute passing, costs no request.
 * Detail views still read one event fresh (`/api/events/:id`), so a cancellation is never a
 * snapshot late there. The 14-day and future windows each read their own longer snapshot,
 * downloaded only when chosen and kept for 30 minutes; the everyday 24-hour one is unaffected.
 */
export class AreaEventRepository implements EventRepository {
  readonly kind = 'api' as const;
  /** One snapshot per range ('' = the 24-hour one), so switching back and forth is free. */
  private snaps = new Map<string, Snapshot>();
  private pending: { key: string; promise: Promise<Snapshot> } | null = null;

  constructor(
    private readonly doFetch: (url: string, init?: RequestInit) => Promise<Response> = (
      url,
      init,
    ) => fetch(url, init),
    private readonly clock: () => number = Date.now,
  ) {}

  /** One JSON answer from /api; `missing` statuses mean "nothing there", anything else throws. */
  private async read<T>(
    url: string,
    init?: RequestInit,
    missing: readonly number[] = [],
  ): Promise<T | null> {
    const res = await this.doFetch(url, init);
    if (missing.includes(res.status)) return null;
    if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  private async area(
    center: LatLng,
    needM: number,
    range?: string,
    step?: number,
  ): Promise<HappowEvent[]> {
    const k = areaKey(center, needM, refresh);
    const part = range ? `&range=${range}${step === undefined ? '' : `&step=${step}`}` : '';
    const key = `lat=${k.lat}&lng=${k.lng}&r=${k.radiusM}${part}`;
    // One snapshot per range and step, so stepping back and forth through months is free.
    const slot = range ? `${range}:${step ?? ''}` : '';
    const snap = this.snaps.get(slot);
    if (snap && snap.key === key && this.clock() < snap.from + stepMs(range)) return snap.events;
    if (this.pending?.key === key) return (await this.pending.promise).events;
    // Not tied to one caller's abort signal: the list and the hotspot counts share this request.
    const promise = this.doFetch(`/api/area?${key}`).then(async (res) => {
      if (!res.ok) throw new Error(`area failed: ${res.status}`);
      const data = (await res.json()) as { from: string; events: EventRow[] };
      return { key, from: Date.parse(data.from), events: data.events.map(rowToEvent) };
    });
    this.pending = { key, promise };
    try {
      const fresh = await promise;
      this.snaps.set(slot, fresh);
      return fresh.events;
    } finally {
      if (this.pending?.promise === promise) this.pending = null;
    }
  }

  private async matching(q: EventQuery): Promise<HappowEvent[]> {
    const all = await this.area(
      q.center,
      Math.max(q.radiusM, density.searchRadiusM),
      q.range,
      q.range ? q.step : undefined,
    );
    return all.filter(
      (e) => e.status !== 'cancelled' && overlaps(e, q.from, q.to) && matchesFilters(e, q),
    );
  }

  async near(q: EventQuery): Promise<NearbyEvent[]> {
    return nearby(await this.matching(q), q.center, q.radiusM);
  }

  async density(q: DensityQuery): Promise<DensityCluster[]> {
    const around = nearby(await this.matching(q), q.center, q.searchRadiusM);
    return densityClusters(around, q.radiusM, (e) => e.densityCell ?? e.h3r9);
  }

  /** Read live, not from the snapshot: the long fields, and a cancellation at once. */
  async byId(id: string, at: LatLng, signal?: AbortSignal): Promise<NearbyEvent | null> {
    const data = await this.read<{ event: EventRow }>(
      `/api/events/${encodeURIComponent(id)}`,
      { signal },
      [404],
    );
    return data ? from(data.event, at) : null;
  }

  /** Read live: the agenda's events can be anywhere and any day. */
  async byIds(ids: readonly string[], at: LatLng, signal?: AbortSignal): Promise<NearbyEvent[]> {
    if (!ids.length) return [];
    const data = await this.read<{ events: EventRow[] }>('/api/events/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
      signal,
    });
    return (data?.events ?? []).map((row) => from(row, at));
  }

  /** Read live, never from the cached area, so turning the credit off hides it at once. */
  async credit(eventId: string, signal?: AbortSignal): Promise<Credit | null> {
    const data = await this.read<{ credit: Credit | null }>(
      `/api/events/${encodeURIComponent(eventId)}/credit`,
      { signal },
      [404],
    );
    return data?.credit ?? null;
  }

  /** Live as well: a small count, asked only while the reach is empty. */
  async districtGoal(
    regionId: string,
    at: LatLng,
    start: Date,
    end: Date,
    signal?: AbortSignal,
  ): Promise<DistrictGoal | null> {
    const q = new URLSearchParams({
      region: regionId,
      lat: String(at.lat),
      lng: String(at.lng),
      from: start.toISOString(),
      to: end.toISOString(),
    });
    const data = await this.read<{ goal: DistrictGoal | null }>(`/api/district-goal?${q}`, {
      signal,
    });
    return data?.goal ?? null;
  }
}
