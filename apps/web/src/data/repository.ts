import type { EventQuery, LatLng, NearbyEvent } from '@happow/core';

/** Where the app gets events from. Swappable: Supabase in production, bundled seed offline/dev. */
export interface EventRepository {
  readonly kind: 'supabase' | 'static';
  near(query: EventQuery, signal?: AbortSignal): Promise<NearbyEvent[]>;
  /** One event for the detail screen or a shared link; distance measured from `from`. */
  byId(id: string, from: LatLng, signal?: AbortSignal): Promise<NearbyEvent | null>;
}
