import type { DensityCluster, DensityQuery, EventQuery, LatLng, NearbyEvent } from '@happow/core';

/** Where the app gets events from. Swappable: Supabase in production, bundled seed offline/dev. */
export interface EventRepository {
  readonly kind: 'supabase' | 'static';
  near(query: EventQuery, signal?: AbortSignal): Promise<NearbyEvent[]>;
  /** One event for the detail screen or a shared link; distance measured from `from`. */
  byId(id: string, from: LatLng, signal?: AbortSignal): Promise<NearbyEvent | null>;
  /** Matching events around the user counted per density cell (hotspot, chevrons, guidance). */
  density(query: DensityQuery, signal?: AbortSignal): Promise<DensityCluster[]>;
  /** "Added by" on a community event: only while its adder has the credit on (M12 §5.5). */
  credit(eventId: string, signal?: AbortSignal): Promise<Credit | null>;
  /** The district a point is in and its live events from `from` to `to` (M12 §6.2). */
  districtGoal(
    regionId: string,
    at: LatLng,
    from: Date,
    to: Date,
    signal?: AbortSignal,
  ): Promise<DistrictGoal | null>;
}

export interface DistrictGoal {
  id: string;
  name: string;
  count: number;
}

export interface Credit {
  name: string;
  level: string | null;
}
