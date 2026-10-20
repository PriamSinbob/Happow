import { materializeSeed } from '@happow/core/seed';
import {
  nearby,
  overlaps,
  type Category,
  type EventQuery,
  type HappowEvent,
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
      all.filter((e) => e.status !== 'cancelled' && overlaps(e, q.from, q.to)),
      q.center,
      q.radiusM,
    );
  }
}
