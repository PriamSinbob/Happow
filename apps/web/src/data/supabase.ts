import type {
  DensityCluster,
  DensityQuery,
  EventQuery,
  EventStatus,
  LatLng,
  NearbyEvent,
  Trust,
} from '@happow/core';
import type { EventRepository } from './repository';

interface Row {
  id: string;
  title: string;
  description: string | null;
  category_ids: string[];
  start_at: string;
  end_at: string;
  end_estimated: boolean;
  timezone: string;
  venue_id: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_website?: string | null;
  lat: number;
  lng: number;
  h3_r9: string;
  price_min: number | string | null;
  price_max: number | string | null;
  currency: string | null;
  is_free: boolean;
  rules: NearbyEvent['rules'];
  official_url: string | null;
  ticket_url: string | null;
  image_url: string | null;
  status: EventStatus;
  trust: Trust;
  confidence: number;
  last_seen_at: string;
  primary_source_id?: string | null;
  source_url?: string | null;
  distance_m: number | null;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

interface DensityRow {
  cell: string;
  center_lat: number;
  center_lng: number;
  event_count: number;
  outside_count: number;
  nearest_lat: number | null;
  nearest_lng: number | null;
  nearest_m: number | null;
  top_venue: string | null;
}

export function rowToCluster(r: DensityRow): DensityCluster {
  return {
    cell: r.cell,
    center: { lat: r.center_lat, lng: r.center_lng },
    count: r.event_count,
    outsideCount: r.outside_count,
    nearestOutside:
      r.nearest_m !== null && r.nearest_lat !== null && r.nearest_lng !== null
        ? { point: { lat: r.nearest_lat, lng: r.nearest_lng }, distanceM: r.nearest_m }
        : null,
    topVenue: r.top_venue,
  };
}

export function rowToEvent(r: Row): NearbyEvent {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    categoryIds: r.category_ids,
    startAt: r.start_at,
    endAt: r.end_at,
    endEstimated: r.end_estimated,
    timezone: r.timezone,
    venue: r.venue_id
      ? {
          id: r.venue_id,
          name: r.venue_name ?? '',
          address: r.venue_address,
          website: r.venue_website ?? null,
        }
      : null,
    point: { lat: r.lat, lng: r.lng },
    h3r9: r.h3_r9,
    priceMin: num(r.price_min),
    priceMax: num(r.price_max),
    currency: r.currency,
    isFree: r.is_free,
    rules: r.rules ?? {},
    officialUrl: r.official_url,
    ticketUrl: r.ticket_url,
    imageUrl: r.image_url,
    status: r.status,
    trust: r.trust,
    confidence: r.confidence,
    lastSeenAt: r.last_seen_at,
    sourceId: r.primary_source_id ?? null,
    sourceUrl: r.source_url ?? null,
    distanceM: r.distance_m ?? 0,
  };
}

/** Calls the `events_near` Postgres function through Supabase's PostgREST endpoint. */
export class SupabaseEventRepository implements EventRepository {
  readonly kind = 'supabase' as const;
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {}

  private async rpc<T = Row>(name: string, body: object, signal?: AbortSignal): Promise<T[]> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      signal,
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
    return (await res.json()) as T[];
  }

  async near(q: EventQuery, signal?: AbortSignal): Promise<NearbyEvent[]> {
    const rows = await this.rpc(
      'events_near',
      {
        lat: q.center.lat,
        lng: q.center.lng,
        radius_m: q.radiusM,
        from_ts: q.from.toISOString(),
        to_ts: q.to.toISOString(),
        categories: q.categories?.length ? q.categories : null,
        price: q.price ?? 'any',
      },
      signal,
    );
    return rows.map(rowToEvent);
  }

  async density(q: DensityQuery, signal?: AbortSignal): Promise<DensityCluster[]> {
    const rows = await this.rpc<DensityRow>(
      'density_near',
      {
        lat: q.center.lat,
        lng: q.center.lng,
        radius_m: q.radiusM,
        search_m: q.searchRadiusM,
        from_ts: q.from.toISOString(),
        to_ts: q.to.toISOString(),
        categories: q.categories?.length ? q.categories : null,
        price: q.price ?? 'any',
      },
      signal,
    );
    return rows.map(rowToCluster);
  }

  async byId(id: string, from: LatLng, signal?: AbortSignal): Promise<NearbyEvent | null> {
    const [row] = await this.rpc(
      'event_by_id',
      { event_id: id, lat: from.lat, lng: from.lng },
      signal,
    );
    return row ? rowToEvent(row) : null;
  }
}
