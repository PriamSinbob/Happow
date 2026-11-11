import {
  FLAG_REASONS,
  SOURCE_MISSING,
  type EventFlagReason,
  type EventStatus,
  type NearbyEvent,
  type Trust,
} from './types.js';

const isFlagReason = (r: string): r is EventFlagReason =>
  r === SOURCE_MISSING || (FLAG_REASONS as readonly string[]).includes(r);

/**
 * An event as /api sends it: the database's own column names, the same in every answer that
 * carries events (`/api/area`, `/api/events/:id`, `/api/events/lookup`, `/api/private`). The
 * area snapshot is compact and leaves the optional long fields out; a single event has them all.
 * Clients turn it into a `NearbyEvent` with `rowToEvent`.
 */
export interface EventRow {
  id: string;
  title: string;
  description?: string | null;
  category_ids: string[];
  start_at: string;
  end_at: string;
  end_estimated: boolean;
  timezone: string;
  venue_id: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_website?: string | null;
  verified?: boolean;
  flag_reason?: string | null;
  flag_count?: number;
  flag_at?: string | null;
  lat: number;
  lng: number;
  h3_r9: string;
  price_min: number | string | null;
  price_max: number | string | null;
  currency: string | null;
  is_free: boolean;
  rules: NearbyEvent['rules'];
  entry?: NearbyEvent['entry'];
  grace_min?: number | null;
  age_min?: number | null;
  family?: boolean | null;
  official_url: string | null;
  ticket_url: string | null;
  image_url?: string | null;
  density_cell?: string | null;
  status: EventStatus;
  trust: Trust;
  confidence: number;
  last_seen_at: string;
  primary_source_id?: string | null;
  source_url?: string | null;
  distance_m: number | null;
  /** Names only in the area snapshot (≤ 5), names and Ticketmaster ids elsewhere. */
  performers?: (string | { name: string; externalId?: string | null })[] | null;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

/**
 * The app's event from its row. `distance_m` is set only where the answer was measured from a
 * point (the area snapshot's grid point is not the user): callers measure from where they are.
 */
export function rowToEvent(r: EventRow): NearbyEvent {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? null,
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
    ...(r.density_cell && { densityCell: r.density_cell }),
    priceMin: num(r.price_min),
    priceMax: num(r.price_max),
    currency: r.currency,
    isFree: r.is_free,
    rules: r.rules ?? {},
    entry: r.entry ?? null,
    graceMin: r.grace_min ?? null,
    ageMin: r.age_min ?? null,
    family: r.family ?? null,
    officialUrl: r.official_url,
    ticketUrl: r.ticket_url,
    imageUrl: r.image_url ?? null,
    status: r.status,
    trust: r.trust,
    confidence: r.confidence,
    lastSeenAt: r.last_seen_at,
    sourceId: r.primary_source_id ?? null,
    sourceUrl: r.source_url ?? null,
    verified: r.verified ?? true,
    flag:
      r.flag_reason &&
      r.flag_at &&
      isFlagReason(r.flag_reason) &&
      (r.flag_count || r.flag_reason === SOURCE_MISSING)
        ? { reason: r.flag_reason, count: r.flag_count ?? 0, at: r.flag_at }
        : null,
    distanceM: r.distance_m ?? 0,
    performers: (r.performers ?? []).map((p) =>
      typeof p === 'string'
        ? { name: p }
        : p.externalId
          ? { name: p.name, externalId: p.externalId }
          : { name: p.name },
    ),
  };
}
