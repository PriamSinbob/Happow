import type { EventQuery, NearbyEvent } from '@happow/core';

/** Where the app gets events from. Swappable: Supabase in production, bundled seed offline/dev. */
export interface EventRepository {
  readonly kind: 'supabase' | 'static';
  near(query: EventQuery, signal?: AbortSignal): Promise<NearbyEvent[]>;
}
