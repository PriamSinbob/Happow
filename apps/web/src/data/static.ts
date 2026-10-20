import { materializeSeed } from '@happow/core/seed';
import {
  distanceM,
  matchesFilters,
  nearby,
  overlaps,
  type Category,
  type EventQuery,
  type HappowEvent,
  type LatLng,
  type NearbyEvent,
  type Region,
} from '@happow/core';
import type { EventRepository } from './repository';

/** Serves the region's bundled seed file, anchored at app start. Used when no API is configured. */
export class StaticEventRepository implements EventRepository {
  readonly kind = 'static' as const;
  private events: Promise<HappowEvent[]>;

  constructor(
    loadSeed: () => Promise<unknown>,
    region: Region,
    categories: Category[],
    h3Resolution: number,
    now = new Date(),
  ) {
    this.events = loadSeed().then((raw) =>
      materializeSeed(raw, region, categories, now, h3Resolution),
    );
  }

  async near(q: EventQuery): Promise<NearbyEvent[]> {
    const all = await this.events;
    return nearby(
      all.filter(
        (e) => e.status !== 'cancelled' && overlaps(e, q.from, q.to) && matchesFilters(e, q),
      ),
      q.center,
      q.radiusM,
    );
  }

  async byId(id: string, from: LatLng): Promise<NearbyEvent | null> {
    const e = (await this.events).find((x) => x.id === id);
    return e ? { ...e, distanceM: distanceM(from, e.point) } : null;
  }
}
