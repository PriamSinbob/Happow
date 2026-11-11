import { z } from 'zod';
import type { User } from './accounts.js';
import { ApiError, body, json, uuid, type Need } from './http.js';
import { SupabaseError } from './supabase.js';

/**
 * The moderator's queue (moderator or admin role).
 * - GET  /api/moderation: pending submissions, reports, trusted spot checks, organiser queues.
 * - POST /api/moderation/:kind/:id {action, note?}: a decision on one of them.
 */

export interface ModerationDeps {
  need: Need;
  requireUser: (req: Request) => Promise<User>;
  /** Claims, contributors' edits, reported posts and private events (organisers.ts). */
  organisers: {
    queues: () => Promise<object>;
    moderation: (
      kind: string,
      id: string,
      action: string,
      moderator: string,
    ) => Promise<Response | null>;
  };
  /** The reward for an approved event; null when there is none or it failed. */
  award: (submissionId: string, eventId: string | null) => Promise<object | null>;
}

const moderateSchema = z.object({
  action: z.enum(['approve', 'reject', 'dismiss', 'cancel', 'hide']),
  note: z.string().trim().max(500).nullable().optional(),
});

export function moderationRoutes({ need, requireUser, organisers, award }: ModerationDeps) {
  async function moderator(req: Request): Promise<string> {
    const user = await requireUser(req);
    if (!user.role) throw new ApiError(403, 'forbidden');
    return user.email;
  }

  async function moderation(req: Request, path: string[]): Promise<Response> {
    const email = await moderator(req);
    const { db } = need();
    if (req.method === 'GET' && path.length === 0)
      return json({
        moderator: email,
        ...(await db.rpc<object>('moderation_queue', {})),
        // Spot checks of what trusted accounts published.
        trusted: await db.rpc<object[]>('trusted_recent', { p_days: 7 }),
        // Claims, contributors' edits and reported posts.
        ...(await organisers.queues()),
      });
    if (req.method !== 'POST' || path.length !== 2) throw new ApiError(404, 'not_found');
    const [kind, id] = path as [string, string];
    if (['claims', 'edits', 'posts', 'private'].includes(kind)) {
      const { action } = await body(
        req,
        z.object({ action: z.enum(['approve', 'reject', 'revoke', 'hide', 'dismiss', 'block']) }),
      );
      const done = await organisers.moderation(kind, id, action, email);
      if (done) return done;
      throw new ApiError(400, 'invalid_input', 'action');
    }
    const { action, note } = await body(req, moderateSchema);
    try {
      if (kind === 'submissions' && (action === 'approve' || action === 'reject')) {
        const done = await db.rpc<{ id: string; eventId: string | null; action: string }>(
          'moderate_submission',
          { p_id: id, p_action: action, p_note: note ?? null, p_moderator: email },
        );
        // Rewards come only after moderation.
        const reward = action === 'approve' ? await award(id, done.eventId) : null;
        return json({ ...done, ...(reward && { reward }) });
      }
      // A weekly repeat is decided once, for all its pending dates. It earns as one
      // event, on its earliest date.
      if (kind === 'series' && (action === 'approve' || action === 'reject')) {
        if (!uuid.safeParse(id).success) throw new ApiError(404, 'not_found');
        const dates = await db.rpc<{ id: string; eventId: string | null; action: string }[]>(
          'moderate_series',
          { p_series: id, p_action: action, p_note: note ?? null, p_moderator: email },
        );
        const first = dates[0]!;
        const reward = action === 'approve' ? await award(first.id, first.eventId) : null;
        return json({ seriesId: id, action, dates, ...(reward && { reward }) });
      }
      if (kind === 'trusted' && action === 'reject')
        return json(
          await db.rpc('moderate_trusted', {
            p_id: id,
            p_note: note ?? null,
            p_moderator: email,
          }),
        );
      if (
        kind === 'reports' &&
        (action === 'dismiss' || action === 'cancel' || action === 'hide')
      ) {
        const resolved = await db.rpc<number>('resolve_reports', {
          p_event: id,
          p_action: action,
          p_note: note ?? null,
          p_moderator: email,
        });
        // Hidden as wrong: its reward stops counting, and days not yet started are taken back.
        if (action === 'hide') await db.rpc('contribution_revoke_event', { p_event: id });
        return json({ resolved });
      }
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'not_found');
      if (err instanceof SupabaseError && err.code === 'P0001')
        throw new ApiError(409, 'already_reviewed');
      throw err;
    }
    throw new ApiError(400, 'invalid_input', 'action');
  }

  return moderation;
}
