import {
  effectivePlan,
  entitlementsFor,
  languageSchema,
  quota,
  usageMonth,
  type AppConfig,
  type Entitlements,
  type PlanGrant,
  type PlansConfig,
} from '@happow/core';
import { z } from 'zod';
import { ApiError, body, json, sha256 } from './http.js';
import { SupabaseError, type AuthUser, type Supabase } from './supabase.js';

/** A checked user, with their staff role (null for everyone who isn't staff). */
export interface User extends AuthUser {
  role: 'moderator' | 'admin' | null;
}

export interface AccountDeps {
  app: AppConfig;
  plans: PlansConfig;
  /** The default region's time zone: the promotion ends at midnight there. */
  timeZone: string;
  /** Throws 503 when Supabase or the salt are not configured. */
  need: () => { db: Supabase; salt: string };
  now: () => Date;
  limit: (bucket: string, actor: string, windowSeconds: number, max: number) => Promise<void>;
  clientHash: (req: Request, salt: string) => Promise<string>;
}

const meSchema = z
  .object({
    locale: languageSchema.optional(),
    termsVersion: z.string().min(1).max(60).optional(),
    /** "Show my name on events I add" (M12 §5.5), off by default, and the name it shows. */
    showName: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
const trustSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
const codeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: languageSchema,
});
const uuid = z.string().uuid();
const grantSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    plan: z.enum(['account', 'premium']).default('premium'),
    /** Null = no end. */
    endsAt: z.string().datetime({ offset: true }).nullable(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

/** A decision on a website-check candidate (M12 §2.2, the Sources tab). */
const sourceActionSchema = z
  .object({ action: z.enum(['accept', 'reject', 'stop', 'resume', 'restore']) })
  .strict();

/** 429 for a used-up monthly quota, with what the add form needs to say so (M8 §5). */
export const quotaExceeded = (kind: 'events' | 'autofill', limit: number, resetsAt: Date) =>
  new ApiError(429, 'quota_exceeded', undefined, {
    kind,
    limit,
    resetsAt: resetsAt.toISOString(),
  });

/** Account endpoints (M8 §2–§5): /api/me, /api/auth/*, /api/admin/*. */
export function accountRoutes({ app, plans, timeZone, need, now, limit, clientHash }: AccountDeps) {
  const { auth, legal } = app;
  /** Checked tokens, so a burst of requests asks Supabase once. Per isolate, short-lived. */
  const cache = new Map<string, { user: User; until: number }>();

  async function requireUser(req: Request): Promise<User> {
    const token = /^Bearer (.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!token) throw new ApiError(401, 'unauthorized');
    const t = now().getTime();
    const hit = cache.get(token);
    if (hit && hit.until > t) return hit.user;
    const { db } = need();
    const authUser = await db.user(token);
    if (!authUser) throw new ApiError(401, 'unauthorized');
    const role = await db.rpc<string | null>('staff_role', { p_email: authUser.email });
    const user: User = {
      ...authUser,
      role: role === 'admin' || role === 'moderator' ? role : null,
    };
    if (auth.userCacheSec > 0) {
      if (cache.size > 500) cache.clear();
      cache.set(token, { user, until: t + auth.userCacheSec * 1000 });
    }
    return user;
  }

  const forget = (userId: string) => {
    for (const [k, v] of cache) if (v.user.id === userId) cache.delete(k);
  };

  /** The plan in force for a signed-in user and what it allows (M8 §3–§4). */
  async function planOf(user: { id: string }) {
    const { db } = need();
    const grants = await db.rpc<PlanGrant[]>('grants_active', { p_user: user.id });
    const p = effectivePlan({
      signedIn: true,
      grants,
      now: now(),
      earlyAccess: plans.earlyAccess,
      timeZone,
    });
    return {
      plan: p.plan,
      planSource: p.source,
      planEndsAt: p.endsAt?.toISOString() ?? null,
      entitlements: entitlementsFor(plans, p.plan),
    };
  }

  /** This month's use of both quotas, their limits and when they reset (M8 §5). */
  async function usageOf(user: { id: string }, entitlements: Entitlements) {
    const { db } = need();
    const { month, resetsAt } = usageMonth(now(), timeZone);
    const used = await db.rpc<{ events: number; autofills: number }>('usage_get', {
      p_user: user.id,
      p_month: month,
    });
    return {
      month: month.slice(0, 7),
      resetsAt: resetsAt.toISOString(),
      events: { used: used.events, limit: quota(entitlements, 'events.perMonth') },
      autofill: { used: used.autofills, limit: quota(entitlements, 'autofill.perMonth') },
    };
  }

  async function profile(user: User) {
    const { db } = need();
    const [p, plan] = await Promise.all([
      db.rpc<object>('profile_get', { p_user: user.id }),
      planOf(user),
    ]);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      ...p,
      ...plan,
      usage: await usageOf(user, plan.entitlements),
    };
  }

  /** GET/PUT/DELETE /api/me, GET /api/me/export. */
  async function me(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    const { db } = need();
    const sub = path.join('/');
    if (req.method === 'GET' && sub === '') return json(await profile(user));
    if (req.method === 'PUT' && sub === '') {
      const { locale, termsVersion, showName, displayName } = await body(req, meSchema);
      if (termsVersion !== undefined && termsVersion !== legal.termsVersion)
        throw new ApiError(400, 'invalid_input', 'termsVersion');
      await db.rpc('profile_update', {
        p_user: user.id,
        p_locale: locale ?? null,
        p_terms_version: termsVersion ?? null,
      });
      if (showName !== undefined || displayName !== undefined)
        await db.rpc('profile_prefs', {
          p_user: user.id,
          p_show_name: showName ?? null,
          p_display_name: displayName ?? null,
        });
      return json(await profile(user));
    }
    if (req.method === 'GET' && path[0] === 'submissions' && path.length === 2) {
      // "Add again" (M12 §4.4): the owner's own form, for another date. Anyone else gets 404.
      const id = path[1]!;
      if (!uuid.safeParse(id).success) throw new ApiError(404, 'not_found');
      const form = await db.rpc<object | null>('submission_form', { p_user: user.id, p_id: id });
      if (!form) throw new ApiError(404, 'not_found');
      return json({ form }, 200, { 'cache-control': 'private, no-store' });
    }
    if (req.method === 'GET' && sub === 'export') {
      const data = await db.rpc<object>('account_export', { p_user: user.id });
      const day = now().toISOString().slice(0, 10);
      return json(
        { format: 'happow-account', exportedAt: now().toISOString(), email: user.email, ...data },
        200,
        {
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename="happow-account-${day}.json"`,
        },
      );
    }
    if (req.method === 'DELETE' && sub === '') {
      await db.rpc('account_forget', { p_user: user.id, p_email: user.email });
      await db.deleteUser(user.id);
      forget(user.id);
      return new Response(null, { status: 204, headers: { 'cache-control': 'private, no-store' } });
    }
    throw new ApiError(404, 'not_found');
  }

  /**
   * POST /api/auth/code-request {email, locale}: files a request for a sign-in code that the
   * admin sends by hand. Always the same answer, so it never tells whether an account exists.
   */
  async function authRoutes(req: Request, path: string[]): Promise<Response> {
    if (
      req.method !== 'POST' ||
      path.join('/') !== 'code-request' ||
      auth.emailDelivery !== 'manual'
    )
      throw new ApiError(404, 'not_found');
    const { db, salt } = need();
    const { email, locale } = await body(req, codeRequestSchema);
    const client = await clientHash(req, salt);
    await limit('code-request', client, 3600, auth.codeRequestsPerHourPerClient);
    await limit(
      'code-request-email',
      await sha256(`${salt}:email:${email}`),
      86_400,
      auth.codeRequestsPerDayPerEmail,
    );
    await db.rpc('request_code', { p_email: email, p_locale: locale, p_client: client });
    return json({ ok: true }, 202);
  }

  function codeEmail(locale: string, code: string, link: string) {
    const t = auth.codeEmail[languageSchema.catch('en').parse(locale)];
    const fill = (s: string) =>
      s
        .replaceAll('{code}', code)
        .replaceAll('{link}', link)
        .replaceAll('{hours}', String(auth.codeValidHours));
    return { subject: fill(t.subject), body: fill(t.body) };
  }

  /** /api/admin/grants[/:id] for the admin only: manual plan grants (M8 §4). */
  async function grants(req: Request, path: string[], user: User): Promise<Response> {
    const { db } = need();
    const id = path[1];
    if (req.method === 'GET' && path.length === 1) return json(await db.rpc('grants_list', {}));
    if (req.method === 'POST' && path.length === 1) {
      const g = await body(req, grantSchema);
      if (g.endsAt !== null && Date.parse(g.endsAt) <= now().getTime())
        throw new ApiError(400, 'invalid_input', 'endsAt');
      // A grant can go to someone who has never signed in: their account is made for it.
      await db.ensureUser(g.email);
      try {
        const grant = await db.rpc('grant_add', {
          p_email: g.email,
          p_plan: g.plan,
          p_ends_at: g.endsAt,
          p_note: g.note ?? null,
          p_created_by: user.email,
        });
        return json(grant, 201);
      } catch (err) {
        if (err instanceof SupabaseError && err.code === 'P0002')
          throw new ApiError(404, 'not_found');
        throw err;
      }
    }
    if (req.method === 'DELETE' && path.length === 2 && uuid.safeParse(id).success) {
      if (!(await db.rpc<boolean>('grant_end', { p_id: id }))) throw new ApiError(404, 'not_found');
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    throw new ApiError(404, 'not_found');
  }

  /** /api/admin/sources[/:id] for the admin only: the website check's candidates (M12 §2.2). */
  async function sources(req: Request, path: string[], user: User): Promise<Response> {
    const { db } = need();
    if (req.method === 'GET' && path.length === 1)
      return json(await db.rpc('source_candidates_list', {}));
    const id = Number(path[1]);
    if (req.method === 'POST' && path.length === 2 && Number.isSafeInteger(id) && id > 0) {
      const { action } = await body(req, sourceActionSchema);
      try {
        const done = await db.rpc<{ id: number; status: string } | null>(
          'source_candidate_decide',
          { p_id: id, p_action: action, p_by: user.email },
        );
        if (!done) throw new ApiError(404, 'not_found');
        return json(done);
      } catch (err) {
        // Its status changed meanwhile (another tab, or a run paused it): reload and look again.
        if (err instanceof SupabaseError && err.code === 'HQ002')
          throw new ApiError(409, 'already_reviewed');
        throw err;
      }
    }
    throw new ApiError(404, 'not_found');
  }

  /** /api/admin/code-requests[/:id[/generate]], /grants and /sources for the admin only. */
  async function admin(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    if (user.role !== 'admin') throw new ApiError(403, 'forbidden');
    const { db } = need();
    const [kind, id, action] = path;
    if (kind === 'grants') return grants(req, path, user);
    if (kind === 'sources') return sources(req, path, user);
    // Events per district and category, today and the week, with the weekly metrics (M12 §3).
    if (kind === 'coverage' && req.method === 'GET' && path.length === 1) {
      const region = new URL(req.url).searchParams.get('region') ?? app.defaultRegion;
      try {
        return json(
          await db.rpc('coverage', {
            p_region: region,
            p_at: now().toISOString(),
            p_evening_hour: app.metrics.eveningFromHour,
          }),
          200,
          { 'cache-control': 'private, no-store' },
        );
      } catch (err) {
        if (err instanceof SupabaseError && err.code === 'P0002')
          throw new ApiError(404, 'not_found');
        throw err;
      }
    }
    // Trust back after a rejection (M12 §5.3).
    if (kind === 'trust' && req.method === 'POST' && path.length === 1) {
      const { email } = await body(req, trustSchema);
      if (!(await db.rpc<boolean>('trust_restore', { p_email: email })))
        throw new ApiError(404, 'not_found');
      return json({ ok: true });
    }
    if (kind !== 'code-requests') throw new ApiError(404, 'not_found');
    if (req.method === 'GET' && path.length === 1)
      return json(
        await db.rpc('code_requests_list', { p_retention_days: auth.codeRequestRetentionDays }),
      );
    if (!uuid.safeParse(id).success) throw new ApiError(404, 'not_found');
    if (req.method === 'DELETE' && path.length === 2) {
      if (!(await db.rpc<boolean>('code_request_delete', { p_id: id })))
        throw new ApiError(404, 'not_found');
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    if (req.method === 'POST' && path.length === 3 && action === 'generate') {
      const r = await db.rpc<{ email: string; locale: string } | null>('code_request_get', {
        p_id: id,
      });
      if (!r) throw new ApiError(404, 'not_found');
      await db.ensureUser(r.email);
      let code: { code: string; link: string };
      try {
        // The sign-in link lands on the app the admin is using (an allowed redirect in Supabase).
        code = await db.signInCode(r.email, `${new URL(req.url).origin}/`);
      } catch (err) {
        if (err instanceof SupabaseError) throw new ApiError(502, 'auth_failed', err.message);
        throw err;
      }
      await db.rpc('code_request_mark', { p_id: id });
      const mail = codeEmail(r.locale, code.code, code.link);
      const crlf = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, '\r\n'));
      return json({
        email: r.email,
        locale: r.locale,
        ...code,
        ...mail,
        mailto: `mailto:${encodeURIComponent(r.email)}?subject=${crlf(mail.subject)}&body=${crlf(mail.body)}`,
      });
    }
    throw new ApiError(404, 'not_found');
  }

  return { requireUser, planOf, usageOf, me, auth: authRoutes, admin };
}
