import { can, type Entitlements, type HappowConfig } from '@happow/core';
import { fetchPage, parseRobots, productToken } from '@happow/extract';
import { z } from 'zod';
import type { User } from './accounts.js';
import {
  ApiError,
  body,
  json,
  type Limit,
  eventId,
  uuid,
  noStore,
  deviceId,
  deviceHash,
  type Need,
} from './http.js';
import { sendNotices, type NoticeKind } from './notices.js';
import { SupabaseError } from './supabase.js';

/**
 * Organisers: claims on events and venues, posts on the event page, edits by owners
 * and organisers, the organiser's reports, and "your events". Organisers are never placed or
 * ranked differently: nothing here touches how an event shows on the map.
 *
 *   GET    /api/events/:id/posts            the organiser and their posts (public, edge-cached)
 *   GET    /api/events/:id/mine             your role on it, your claim, the organiser's reports
 *   POST   /api/events/:id/posts            {kind, body, change?}
 *   POST   /api/events/:id/edit             {fields}
 *   POST   /api/events/:id/reports/:rid     {note}: the organiser answers a report
 *   DELETE /api/posts/:id                   your info or important post
 *   POST   /api/posts/:id/report            {deviceId, reason, note?}
 *   POST   /api/claims                      {kind, target, organiserName, method, evidence?}
 *   POST   /api/claims/:id/check            looks for the code on the site
 *   GET    /api/me/claims, GET /api/me/events
 */

export interface OrganiserDeps {
  config: HappowConfig;
  need: Need;
  requireUser: (req: Request) => Promise<User>;
  planOf: (user: { id: string }) => Promise<{ entitlements: Entitlements }>;
  limit: Limit;
  trusted: (userId: string) => Promise<boolean>;
  now: () => Date;
  fetch: typeof fetch;
  pushSecret: string | undefined;
}

const instant = z.string().datetime({ offset: true });
const url = z.string().url().max(500).startsWith('http').nullable();

const fieldsSchema = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().max(2000).nullable(),
    startAt: instant,
    endAt: instant,
    status: z.enum(['scheduled', 'cancelled', 'postponed']),
    isFree: z.boolean(),
    priceMin: z.number().min(0).max(100_000).nullable(),
    priceMax: z.number().min(0).max(100_000).nullable(),
    officialUrl: url,
    ticketUrl: url,
  })
  .partial()
  .strict();

/** The app's field names to the database's. */
const COLUMNS: Record<keyof z.infer<typeof fieldsSchema>, string> = {
  title: 'title',
  description: 'description',
  startAt: 'start_at',
  endAt: 'end_at',
  status: 'status',
  isFree: 'is_free',
  priceMin: 'price_min',
  priceMax: 'price_max',
  officialUrl: 'official_url',
  ticketUrl: 'ticket_url',
};

export function toColumns(fields: z.infer<typeof fieldsSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields))
    if (v !== undefined) out[COLUMNS[k as keyof typeof COLUMNS]] = v;
  return out;
}

const postSchema = z.object({
  kind: z.enum(['schedule', 'important', 'info']),
  body: z.string().trim().min(1).max(280),
  change: z
    .object({
      startAt: instant.optional(),
      endAt: instant.optional(),
      status: z.enum(['scheduled', 'cancelled', 'postponed']).optional(),
    })
    .strict()
    .optional(),
});

/** "happow-claim-7F3KQ2M9XA": what the organiser puts on their page. */
export function claimCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(10));
  return `happow-claim-${[...b].map((x) => alphabet[x % alphabet.length]).join('')}`;
}

function mapError(err: unknown): never {
  if (err instanceof SupabaseError) {
    if (err.code === 'P0002') throw new ApiError(404, 'not_found');
    if (err.code === 'P0001') throw new ApiError(409, 'already_reviewed');
    if (err.code === 'HQ020') throw new ApiError(409, 'already_claimed');
    if (err.code === 'HQ030') throw new ApiError(429, 'rate_limited');
    if (err.code === '22023') throw new ApiError(400, 'invalid_input');
  }
  throw err;
}

export function organiserRoutes(deps: OrganiserDeps) {
  const { config, need, requireUser, planOf, limit, trusted, now, pushSecret } = deps;
  const cfg = config.app.organiser;
  const rpc = async <T>(name: string, args: object): Promise<T> => {
    try {
      return await need().db.rpc<T>(name, args);
    } catch (err) {
      mapError(err);
    }
  };

  /**
   * A schedule change, an important post or a cancellation reaches everyone interested:
   * queued for the whole audience, a few sent now, the rest by the cron.
   */
  async function notify(event: string, kind: NoticeKind, text: string, except: string) {
    try {
      const queued = await rpc<number>('notice_enqueue', {
        p_event: event,
        p_kind: kind,
        p_body: text.slice(0, 200),
        p_except: except,
        p_max: config.app.notices.maxAudience,
      });
      if (queued)
        await sendNotices(
          need().db,
          pushSecret,
          config.app,
          now(),
          config.app.notices.inline,
          event,
          deps.fetch,
        );
      return queued;
    } catch (err) {
      // A notice that fails must never undo the post or the edit it follows.
      console.error(JSON.stringify({ notice: event, error: String(err) }));
      return 0;
    }
  }

  const visibility = (id: string) => rpc<string | null>('event_visibility', { p_event: id });

  /** May this request see the event? Public: anyone. Private: its owner and invitees. */
  async function mayRead(req: Request, id: string): Promise<User | null> {
    const v = await visibility(id);
    if (!v) throw new ApiError(404, 'not_found');
    if (v === 'public')
      return req.headers.has('authorization') ? requireUser(req).catch(() => null) : null;
    const user = await requireUser(req);
    if (!(await rpc<boolean>('event_visible_to', { p_event: id, p_user: user.id })))
      throw new ApiError(404, 'not_found');
    return user;
  }

  async function events(req: Request, id: string, rest: string[]): Promise<Response> {
    if (!eventId.safeParse(id).success) throw new ApiError(404, 'not_found');
    const [what, sub] = rest;
    if (what === 'posts' && !sub && req.method === 'GET') {
      const v = await visibility(id);
      if (!v) throw new ApiError(404, 'not_found');
      if (v === 'private') await mayRead(req, id);
      const data = await rpc<object>('event_posts_get', { p_event: id });
      return json(data, 200, {
        'cache-control':
          v === 'public' ? `public, max-age=${cfg.postsCacheSec}` : 'private, no-store',
      });
    }
    const user = await requireUser(req);
    if (what === 'mine' && req.method === 'GET') {
      const role = await rpc<string | null>('event_role', { p_user: user.id, p_event: id });
      const claims = await rpc<{ event_id: string | null; status: string; id: string }[]>(
        'claims_mine',
        { p_user: user.id },
      );
      const claim = claims.find((c) => c.event_id === id && c.status !== 'rejected') ?? null;
      const runs = role === 'owner' || role === 'organiser';
      return json(
        {
          role,
          claim,
          reports: runs ? await rpc('organiser_reports', { p_user: user.id, p_event: id }) : [],
          infoPosts: can((await planOf(user)).entitlements, 'organiser.infoPosts'),
        },
        200,
        noStore,
      );
    }
    if (what === 'posts' && !sub && req.method === 'POST') {
      const input = await body(req, postSchema);
      if (input.kind === 'info' && !can((await planOf(user)).entitlements, 'organiser.infoPosts'))
        throw new ApiError(403, 'forbidden', 'organiser.infoPosts is not in this plan');
      if (input.kind === 'schedule' && !input.change)
        throw new ApiError(400, 'invalid_input', 'change');
      const change = input.change ? toColumns(input.change) : null;
      if (
        change?.start_at &&
        change.end_at &&
        Date.parse(change.end_at as string) <= Date.parse(change.start_at as string)
      )
        throw new ApiError(400, 'invalid_input', 'end');
      const post = await rpc<object>('post_add', {
        p_user: user.id,
        p_event: id,
        p_kind: input.kind,
        p_body: input.body,
        p_change: change,
        p_per_day: cfg.postsPerEventPerDay,
      });
      const kind: NoticeKind | null =
        input.kind === 'important'
          ? 'important'
          : input.kind === 'schedule'
            ? change?.status === 'cancelled'
              ? 'cancelled'
              : 'schedule'
            : null;
      const notified = kind ? await notify(id, kind, input.body, user.id) : 0;
      return json({ post, notified }, 201, noStore);
    }
    if (what === 'edit' && req.method === 'POST') {
      await limit('edit', user.id, 3600, cfg.editsPerHour);
      const { fields } = await body(req, z.object({ fields: fieldsSchema }));
      const cols = toColumns(fields);
      if (!Object.keys(cols).length) throw new ApiError(400, 'invalid_input', 'fields');
      const current = await rpc<{ start_at: string; end_at: string } | null>('event_fields', {
        p_event: id,
      });
      if (!current) throw new ApiError(404, 'not_found');
      const start = Date.parse((cols.start_at as string) ?? current.start_at);
      const end = Date.parse((cols.end_at as string) ?? current.end_at);
      if (end < start) throw new ApiError(400, 'invalid_input', 'end');
      const role = await rpc<string | null>('event_role', { p_user: user.id, p_event: id });
      if (!role) throw new ApiError(404, 'not_found');
      if (role !== 'owner' && !can((await planOf(user)).entitlements, 'organiser.publish'))
        throw new ApiError(403, 'forbidden', 'organiser.publish is not in this plan');
      const r = await rpc<{ status: string; role: string }>('event_edit', {
        p_user: user.id,
        p_event: id,
        p_fields: cols,
        p_trusted: role === 'contributor' ? await trusted(user.id) : false,
      });
      // A change of time or a cancellation, once applied, reaches everyone interested.
      let notified = 0;
      if (r.status === 'applied' && ('start_at' in cols || 'end_at' in cols || 'status' in cols)) {
        const cancelled = cols.status === 'cancelled';
        notified = await notify(
          id,
          cancelled ? 'cancelled' : 'schedule',
          noticeText(cols),
          user.id,
        );
      }
      return json({ ...r, notified }, 200, noStore);
    }
    if (what === 'reports' && sub && req.method === 'POST') {
      if (!uuid.safeParse(sub).success) throw new ApiError(404, 'not_found');
      const { note } = await body(req, z.object({ note: z.string().trim().max(500) }));
      await rpc('organiser_report_answer', { p_user: user.id, p_id: sub, p_note: note });
      return json({ ok: true }, 200, noStore);
    }
    throw new ApiError(404, 'not_found');
  }

  /** A short neutral line for an edit's notice; the app's card has the detail. */
  function noticeText(cols: Record<string, unknown>): string {
    const lang = config.app.languages[0] === 'en' ? 'en' : 'pl';
    if (cols.status === 'cancelled')
      return lang === 'en' ? 'The event is cancelled' : 'Wydarzenie odwołane';
    if (cols.status === 'postponed')
      return lang === 'en' ? 'The event is postponed' : 'Wydarzenie przełożone';
    return lang === 'en' ? 'The time has changed' : 'Zmieniła się godzina';
  }

  async function posts(req: Request, path: string[]): Promise<Response> {
    const [id, action] = path;
    if (!id || !uuid.safeParse(id).success) throw new ApiError(404, 'not_found');
    if (!action && req.method === 'DELETE') {
      const user = await requireUser(req);
      if (!(await rpc<boolean>('post_delete', { p_user: user.id, p_id: id })))
        throw new ApiError(404, 'not_found');
      return json({ ok: true }, 200, noStore);
    }
    if (action === 'report' && req.method === 'POST') {
      const { salt } = need();
      const input = await body(
        req,
        z.object({
          deviceId,
          reason: z.enum(['inappropriate', 'unlawful', 'wrong_info', 'other']),
          note: z.string().trim().max(500).nullable().optional(),
        }),
      );
      const reporter = await deviceHash(salt, input.deviceId);
      await limit('report', reporter, 86_400, config.app.submissions.reportsPerDayPerDevice);
      await rpc('post_report', {
        p_post: id,
        p_reporter: reporter,
        p_reason: input.reason,
        p_note: input.note ?? null,
      });
      return json({ ok: true }, 201, noStore);
    }
    throw new ApiError(404, 'not_found');
  }

  /** Looks for the claim's code on its page, once per call (robots.txt respected). */
  async function checkSite(
    pageUrl: string,
    code: string,
  ): Promise<'found' | 'missing' | 'blocked' | 'unavailable'> {
    const ua = config.app.ingest.userAgent;
    try {
      const robotsUrl = new URL('/robots.txt', pageUrl).toString();
      const res = await deps.fetch(robotsUrl, {
        headers: { 'User-Agent': ua },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok && !parseRobots(await res.text(), productToken(ua)).isAllowed(pageUrl))
        return 'blocked';
    } catch {
      /* no robots.txt: allowed */
    }
    try {
      const page = await fetchPage(pageUrl, {
        userAgent: ua,
        fetch: deps.fetch,
        maxBytes: config.app.extraction.maxPageBytes,
      });
      return page.html.includes(code) ? 'found' : 'missing';
    } catch {
      return 'unavailable';
    }
  }

  async function claims(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    if (!path.length && req.method === 'POST') {
      await limit('claim', user.id, 3600, cfg.checksPerHour);
      const input = await body(
        req,
        z.object({
          kind: z.enum(['event', 'venue']),
          target: z.string().min(1).max(300),
          organiserName: z.string().trim().min(2).max(80),
          method: z.enum(['site', 'moderator']),
          evidence: z.string().trim().max(1000).nullable().optional(),
        }),
      );
      if (input.method === 'moderator' && !input.evidence)
        throw new ApiError(400, 'invalid_input', 'evidence');
      const claim = await rpc<object>('claim_open', {
        p_user: user.id,
        p_kind: input.kind,
        p_target: input.target,
        p_name: input.organiserName,
        p_method: input.method,
        p_code: claimCode(),
        p_evidence: input.evidence ?? null,
      });
      return json({ claim }, 201, noStore);
    }
    if (path.length === 2 && path[1] === 'check' && req.method === 'POST') {
      if (!uuid.safeParse(path[0]).success) throw new ApiError(404, 'not_found');
      await limit('claim-check', user.id, 3600, cfg.checksPerHour);
      const claim = await rpc<{
        id: string;
        code: string;
        page_url: string | null;
        status: string;
      } | null>('claim_get', { p_user: user.id, p_id: path[0] });
      if (!claim) throw new ApiError(404, 'not_found');
      if (claim.status !== 'pending') return json({ result: claim.status, claim }, 200, noStore);
      if (!claim.page_url) return json({ result: 'no_page', claim }, 200, noStore);
      const result = await checkSite(claim.page_url, claim.code);
      await rpc('claim_checked', { p_id: claim.id });
      if (result !== 'found') return json({ result, claim }, 200, noStore);
      const decided = await rpc<object>('claim_decide', {
        p_id: claim.id,
        p_action: 'approve',
        p_by: 'site',
        p_note: null,
      });
      return json({ result: 'approved', claim: decided }, 200, noStore);
    }
    throw new ApiError(404, 'not_found');
  }

  /** GET /api/me/claims, /api/me/events. */
  async function mine(req: Request, what: string): Promise<Response> {
    const user = await requireUser(req);
    if (what === 'claims')
      return json({ claims: await rpc('claims_mine', { p_user: user.id }) }, 200, noStore);
    return json({ events: await rpc('my_events', { p_user: user.id }) }, 200, noStore);
  }

  /** Moderators: claims, pending edits, reported posts, and blocking a private event's owner. */
  async function moderation(
    kind: string,
    id: string,
    action: string,
    email: string,
  ): Promise<Response | null> {
    if (kind === 'claims' && ['approve', 'reject', 'revoke'].includes(action)) {
      if (!uuid.safeParse(id).success) throw new ApiError(404, 'not_found');
      return json(
        await rpc('claim_decide', { p_id: id, p_action: action, p_by: email, p_note: null }),
      );
    }
    if (kind === 'edits' && (action === 'approve' || action === 'reject')) {
      const n = Number(id);
      if (!Number.isInteger(n)) throw new ApiError(404, 'not_found');
      return json(
        await rpc('edit_decide', { p_id: n, p_approve: action === 'approve', p_by: email }),
      );
    }
    if (kind === 'posts' && (action === 'hide' || action === 'dismiss')) {
      if (!uuid.safeParse(id).success) throw new ApiError(404, 'not_found');
      return json({ ok: await rpc('post_moderate', { p_id: id, p_action: action, p_by: email }) });
    }
    if (kind === 'private' && action === 'block')
      return json({ ok: await rpc('private_block', { p_event: id, p_by: email }) });
    return null;
  }

  const queues = async () => ({
    claims: await rpc<object[]>('claims_queue', {}),
    edits: await rpc<object[]>('edits_queue', {}),
    posts: await rpc<object[]>('post_reports_queue', {}),
  });

  return { events, posts, claims, mine, moderation, queues };
}
