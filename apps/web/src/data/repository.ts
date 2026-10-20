import type { DensityCluster, DensityQuery, EventQuery, LatLng, NearbyEvent } from '@happow/core';

/** Where the app gets events from. Swappable: Supabase in production, bundled seed offline/dev. */
export interface EventRepository {
  readonly kind: 'supabase' | 'static';
  near(query: EventQuery, signal?: AbortSignal): Promise<NearbyEvent[]>;
  /** One event for the detail screen or a shared link; distance measured from `from`. */
  byId(id: string, from: LatLng, signal?: AbortSignal): Promise<NearbyEvent | null>;
  /** Matching events around the user counted per density cell (hotspot, chevrons, guidance). */
  density(query: DensityQuery, signal?: AbortSignal): Promise<DensityCluster[]>;
}
