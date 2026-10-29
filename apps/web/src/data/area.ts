import {
  areaKey,
  densityClusters,
  matchesFilters,
  nearby,
  overlaps,
  type DensityCluster,
  type DensityQuery,
  type EventQuery,
  type HappowEvent,
  type LatLng,
  type NearbyEvent,
} from '@happow/core';
import { config } from '../config';
import type { Credit, EventRepository } from './repository';
import { rowToEvent, type Row, type SupabaseEventRepository } from './supabase';

const { refresh, density } = config.app;
/** The 24-hour snapshot follows the data step; Week and Later ones change slowly. */
const stepMs = (range: string | undefined) =>
  (range ? refresh.longCacheMinutes : refresh.dataMinutes) * 60_000;

interface Snapshot {
  key: string;
  /** Start of the server's refresh step; the snapshot is reused until the step ends. */
  from: number;
  events: HappowEvent[];
}

class AreaUnavailable extends Error {}

/**
 * Battery- and data-friendly reads: one cached snapshot of the surrounding area per refresh step
 * (`/api/area`), from which the list, the radius, time windows, filters and hotspot counts are all
 * worked out on the phone. Changing a filter or the radius, or a minute passing, costs no request.
 * Detail views still read one event fresh, so a cancellation is never 5 minutes late there.
 * The Week and Later windows read their own longer snapshot, downloaded only when chosen and
 * kept for 30 minutes; the everyday 24-hour one is unaffected.
 */
export class AreaEventRepository implements EventRepository {
  readonly kind = 'supabase' as const;
  /** One snapshot per range ('' = the 24-hour one), so switching back and forth is free. */
  private snaps = new Map<string, Snapshot>();
  private pending: { key: string; promise: Promise<Snapshot> } | null = null;
  /** Older servers without /api/area: fall back to per-query database calls. */
  private direct = false;

  constructor(
    private readonly db: SupabaseEventRepository,
    private readonly doFetch: (url: string) => Promise<Response> = (url) => fetch(url),
    private readonly clock: () => number = Date.now,
  ) {}

  private async area(center: LatLng, needM: number, range?: string): Promise<HappowEvent[]> {
    const k = areaKey(center, needM, refresh);
    const key = `lat=${k.lat}&lng=${k.lng}&r=${k.radiusM}${range ? `&range=${range}` : ''}`;
    const snap = this.snaps.get(range ?? '');
    if (snap && snap.key === key && this.clock() < snap.from + stepMs(range)) return snap.events;
    if (this.pending?.key === key) return (await this.pending.promise).events;
    // Not tied to one caller's abort signal: the list and the hotspot counts share this request.
    const promise = this.doFetch(`/api/area?${key}`).then(async (res) => {
      if (res.status === 404 || res.status === 503) throw new AreaUnavailable();
      if (!res.ok) throw new Error(`area failed: ${res.status}`);
      const data = (await res.json()) as { from: string; events: Row[] };
      return { key, from: Date.parse(data.from), events: data.events.map(rowToEvent) };
    });
    this.pending = { key, promise };
    try {
      const fresh = await promise;
      this.snaps.set(range ?? '', fresh);
      return fresh.events;
    } finally {
      if (this.pending?.promise === promise) this.pending = null;
    }
  }

  private async matching(q: EventQuery): Promise<HappowEvent[] | null> {
    if (this.direct) return null;
    try {
      const all = await this.area(q.center, Math.max(q.radiusM, density.searchRadiusM), q.range);
      return all.filter(
        (e) => e.status !== 'cancelled' && overlaps(e, q.from, q.to) && matchesFilters(e, q),
      );
    } catch (err) {
      if (!(err instanceof AreaUnavailable)) throw err;
      this.direct = true;
      return null;
    }
  }

  async near(q: EventQuery, signal?: AbortSignal): Promise<NearbyEvent[]> {
    const events = await this.matching(q);
    return events ? nearby(events, q.center, q.radiusM) : this.db.near(q, signal);
  }

  async density(q: DensityQuery, signal?: AbortSignal): Promise<DensityCluster[]> {
    const events = await this.matching(q);
    if (!events) return this.db.density(q, signal);
    const around = nearby(events, q.center, q.searchRadiusM);
    return densityClusters(around, q.radiusM, (e) => e.densityCell ?? e.h3r9);
  }

  byId(id: string, from: LatLng, signal?: AbortSignal): Promise<NearbyEvent | null> {
    return this.db.byId(id, from, signal);
  }

  /** Read live, never from the cached area, so turning the credit off hides it at once. */
  credit(eventId: string, signal?: AbortSignal): Promise<Credit | null> {
    return this.db.credit(eventId, signal);
  }
}
