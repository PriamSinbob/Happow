import type { EventQuery, EventStatus, NearbyEvent, Trust } from '@happow/core';
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
  distance_m: number;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

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
      ? { id: r.venue_id, name: r.venue_name ?? '', address: r.venue_address }
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
    distanceM: r.distance_m,
  };
}

/** Calls the `events_near` Postgres function through Supabase's PostgREST endpoint. */
export class SupabaseEventRepository implements EventRepository {
  readonly kind = 'supabase' as const;
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {}

  async near(q: EventQuery, signal?: AbortSignal): Promise<NearbyEvent[]> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/events_near`, {
      method: 'POST',
      signal,
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lat: q.center.lat,
        lng: q.center.lng,
        radius_m: q.radiusM,
        from_ts: q.from.toISOString(),
        to_ts: q.to.toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`events_near failed: ${res.status}`);
    return ((await res.json()) as Row[]).map(rowToEvent);
  }
}
