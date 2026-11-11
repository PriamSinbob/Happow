import { getRegion, type EventRow, type HappowConfig } from '@happow/core';
import { z } from 'zod';
import { ApiError, body, eventId, json } from './http.js';
import type { Supabase } from './supabase.js';

/**
 * Public reads of single events, for every client (the map itself comes from /api/area).
 * - GET  /api/events/:id          one listed event with its long fields; briefly cached.
 * - POST /api/events/lookup {ids} the listed events among `ids` (a device's plans), ended ones
 *                                 included, by start.
 * - GET  /api/events/:id/credit   "added by" on a community event, while its adder shows it.
 * - GET  /api/district-goal       the district a point is in and its events in a time span.
 *
 * Only public, listed events: the database functions read `events_public`. Private events go
 * through /api/private with a sign-in. Rows carry no distance: the caller measures from where
 * it is, so one cached answer serves everyone.
 */

export interface EventDeps {
  config: HappowConfig;
  /** Null while Supabase is not configured: the routes answer 503. */
  db: Supabase | null;
}

const lookupSchema = z.object({ ids: z.array(eventId).max(500) });
const goalSchema = z.object({
  region: z.string().min(1).max(60).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export function eventRoutes({ config, db }: EventDeps) {
  const { eventSeconds } = config.app.refresh;
  const need = () => {
    if (!db) throw new ApiError(503, 'not_configured');
    return db;
  };

  async function byId(id: string): Promise<Response> {
    if (!eventId.safeParse(id).success) throw new ApiError(404, 'unknown_event');
    const [event] = await need().rpc<EventRow[]>('event_by_id', { event_id: id });
    if (!event) throw new ApiError(404, 'unknown_event');
    // Short and public: a cancellation shows within the step, and a shared link that many
    // people open at once asks the database once.
    return json({ event }, 200, { 'cache-control': `public, max-age=${eventSeconds}` });
  }

  async function lookup(req: Request): Promise<Response> {
    const { ids } = await body(req, lookupSchema);
    const events = ids.length ? await need().rpc<EventRow[]>('events_by_ids', { ids }) : [];
    return json({ events });
  }

  async function credit(id: string): Promise<Response> {
    if (!eventId.safeParse(id).success) throw new ApiError(404, 'unknown_event');
    // Never cached, so turning the credit off hides the name at once.
    const value = await need().rpc<{ name: string; level: string | null } | null>('event_credit', {
      p_event: id,
    });
    return json({ credit: value ?? null });
  }

  async function districtGoal(req: Request): Promise<Response> {
    const q = goalSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!q.success) throw new ApiError(400, 'invalid_input', q.error.issues[0]?.message);
    const region = config.regions.find((r) => r.id === (q.data.region ?? getRegion(config).id));
    if (!region) throw new ApiError(400, 'invalid_input', 'region');
    const goal = await need().rpc<{ id: string; name: string; count: number } | null>(
      'district_goal',
      {
        p_region: region.id,
        p_lat: q.data.lat,
        p_lng: q.data.lng,
        p_from: q.data.from,
        p_to: q.data.to,
      },
    );
    return json({ goal: goal ?? null });
  }

  return { byId, lookup, credit, districtGoal };
}
