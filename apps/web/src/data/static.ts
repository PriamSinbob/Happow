import { materializeSeed } from '@happow/core/seed';
import {
  densityClusters,
  distanceM,
  matchesFilters,
  nearby,
  overlaps,
  type Category,
  type DensityCluster,
  type DensityQuery,
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
    h3: { eventResolution: number; densityResolution: number },
    now = new Date(),
  ) {
    this.events = loadSeed().then((raw) =>
      materializeSeed(raw, region, categories, now, h3.eventResolution, h3.densityResolution),
    );
  }

  private async matching(q: EventQuery): Promise<HappowEvent[]> {
    return (await this.events).filter(
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

  async byId(id: string, from: LatLng): Promise<NearbyEvent | null> {
    const e = (await this.events).find((x) => x.id === id);
    return e ? { ...e, distanceM: distanceM(from, e.point) } : null;
  }
}
