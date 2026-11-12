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
import type { EmailSender } from './email.js';
import { ApiError, body, json, sha256, type Limit, uuid, noStore, type Need } from './http.js';
import { SupabaseError, type AuthUser } from './supabase.js';

/** A checked user, with their staff role (null for everyone who isn't staff). */
export interface User extends AuthUser {
  role: 'moderator' | 'admin' | null;
  /**
   * The account waits for its code: `email` is a placeholder, and only invitations and its own
   * profile are open to it (`requireAnyUser`).
   */
  pending?: boolean;
}

export interface AccountDeps {
  app: AppConfig;
  plans: PlansConfig;
  /** The default region's time zone: the promotion ends at midnight there. */
  timeZone: string;
  need: Need;
  now: () => Date;
  limit: Limit;
  clientHash: (req: Request, salt: string) => Promise<string>;
  /** The app's email sender, null while email is off. */
  email?: EmailSender | null;
}

const meSchema = z
  .object({
    locale: languageSchema.optional(),
    termsVersion: z.string().min(1).max(60).optional(),
    /** "Show my name on events I add", off by default, and the name it shows. */
    showName: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
    /** "Show my friends when I'm going", off by default. */
    friendsVisible: z.boolean().optional(),
  })
  .strict();
const trustSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
const codeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: languageSchema,
});
const activateSchema = z.object({ pendingToken: z.string().min(20).max(4000) }).strict();
const grantSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    plan: z.enum(['account', 'premium']).default('premium'),
    /** Null = no end. */
    endsAt: z.string().datetime({ offset: true }).nullable(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

/** A decision on a website-check candidate (the Sources tab). */
const sourceActionSchema = z
  .object({ action: z.enum(['accept', 'reject', 'stop', 'resume', 'restore']) })
  .strict();

/** 429 for a used-up monthly quota, with what the add form needs to say so. */
export const quotaExceeded = (
  kind: 'events' | 'autofill' | 'private',
  limit: number,
  resetsAt: Date,
) =>
  new ApiError(429, 'quota_exceeded', undefined, {
    kind,
    limit,
    resetsAt: resetsAt.toISOString(),
  });

/** Account endpoints: /api/me, /api/auth/*, /api/admin/*. */
export function accountRoutes({
  app,
  plans,
  timeZone,
  need,
  now,
  limit,
  clientHash,
  email: sender = null,
}: AccountDeps) {
  const { auth, legal } = app;
  /** Checked tokens, so a burst of requests asks Supabase once. Per isolate, short-lived. */
  const cache = new Map<string, { user: User; until: number }>();

  /** A waiting account's placeholder address: never deliverable, never a real account's. */
  const isPendingEmail = (email: string) => email.endsWith(`@${auth.pending.domain}`);

  /** The account behind a token, checked with Supabase (and cached); null for a bad token. */
  async function userOf(token: string): Promise<User | null> {
    const t = now().getTime();
    const hit = cache.get(token);
    if (hit && hit.until > t) return hit.user;
    const { db } = need();
    const authUser = await db.user(token);
    if (!authUser) return null;
    const pending = isPendingEmail(authUser.email);
    // A waiting account is never staff: its address is a placeholder.
    const role = pending
      ? null
      : await db.rpc<string | null>('staff_role', { p_email: authUser.email });
    const user: User = {
      ...authUser,
      role: role === 'admin' || role === 'moderator' ? role : null,
      ...(pending && { pending: true }),
    };
    if (auth.userCacheSec > 0) {
      if (cache.size > 500) cache.clear();
      cache.set(token, { user, until: t + auth.userCacheSec * 1000 });
    }
    return user;
  }

  /** Any signed-in account, one waiting for activation included. */
  async function requireAnyUser(req: Request): Promise<User> {
    const token = /^Bearer (.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
    const user = token ? await userOf(token) : null;
    if (!user) throw new ApiError(401, 'unauthorized');
    return user;
  }

  /** An activated account: one that waits for its code gets 403 activation_required. */
  async function requireUser(req: Request): Promise<User> {
    const user = await requireAnyUser(req);
    if (user.pending) throw new ApiError(403, 'activation_required');
    return user;
  }

  /**
   * The activated account when the request carries a token (a bad token is 401), else null. A
   * waiting account counts as none here: what it does without one is all it may do.
   */
  const optionalUser = async (req: Request): Promise<User | null> => {
    if (!req.headers.has('authorization')) return null;
    const user = await requireAnyUser(req);
    return user.pending ? null : user;
  };
  /** As `optionalUser`, with waiting accounts: their devices' notifications follow them. */
  const optionalAnyUser = (req: Request): Promise<User | null> =>
    req.headers.has('authorization') ? requireAnyUser(req) : Promise.resolve(null);

  const forget = (userId: string) => {
    for (const [k, v] of cache) if (v.user.id === userId) cache.delete(k);
  };

  /** The plan in force for a signed-in user and what it allows. */
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

  /** This month's use of both quotas, their limits and when they reset. */
  async function usageOf(user: { id: string }, entitlements: Entitlements) {
    const { db } = need();
    const { month, resetsAt } = usageMonth(now(), timeZone);
    const used = await db.rpc<{ events: number; autofills: number; private?: number }>(
      'usage_get',
      {
        p_user: user.id,
        p_month: month,
      },
    );
    return {
      month: month.slice(0, 7),
      resetsAt: resetsAt.toISOString(),
      events: { used: used.events, limit: quota(entitlements, 'events.perMonth') },
      autofill: { used: used.autofills, limit: quota(entitlements, 'autofill.perMonth') },
      private: { used: used.private ?? 0, limit: quota(entitlements, 'private.perMonth') },
    };
  }

  async function profile(user: User) {
    const { db } = need();
    if (user.pending) {
      // Waiting for the code: the email it waits for, the name and terms, and nothing a plan gives.
      const [p, email] = await Promise.all([
        db.rpc<object>('profile_get', { p_user: user.id }),
        db.rpc<string | null>('pending_email', { p_user: user.id }),
      ]);
      const entitlements = entitlementsFor(plans, 'anonymous');
      const none = { used: 0, limit: 0 };
      return {
        id: user.id,
        email: email ?? '',
        role: null,
        pending: true,
        ...p,
        plan: 'anonymous' as const,
        planSource: null,
        planEndsAt: null,
        entitlements,
        usage: {
          month: usageMonth(now(), timeZone).month.slice(0, 7),
          resetsAt: usageMonth(now(), timeZone).resetsAt.toISOString(),
          events: none,
          autofill: none,
          private: none,
        },
      };
    }
    const [p, plan] = await Promise.all([
      db.rpc<object>('profile_get', { p_user: user.id }),
      planOf(user),
    ]);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      pending: false,
      ...p,
      ...plan,
      usage: await usageOf(user, plan.entitlements),
    };
  }

  /** GET/PUT/DELETE /api/me, GET /api/me/export. */
  async function me(req: Request, path: string[]): Promise<Response> {
    const user = await requireAnyUser(req);
    const { db } = need();
    const sub = path.join('/');
    if (req.method === 'GET' && sub === '') return json(await profile(user));
    // A waiting account reads and sets its profile and can be deleted; the rest needs the code.
    if (user.pending && !(sub === '' && (req.method === 'PUT' || req.method === 'DELETE')))
      throw new ApiError(403, 'activation_required');
    if (req.method === 'PUT' && sub === '') {
      const { locale, termsVersion, showName, displayName, friendsVisible } = await body(
        req,
        meSchema,
      );
      if (termsVersion !== undefined && termsVersion !== legal.termsVersion)
        throw new ApiError(400, 'invalid_input', 'termsVersion');
      await db.rpc('profile_update', {
        p_user: user.id,
        p_locale: locale ?? null,
        p_terms_version: termsVersion ?? null,
      });
      if (user.pending && (showName !== undefined || friendsVisible !== undefined))
        throw new ApiError(403, 'activation_required');
      if (showName !== undefined || displayName !== undefined)
        await db.rpc('profile_prefs', {
          p_user: user.id,
          p_show_name: showName ?? null,
          p_display_name: displayName ?? null,
        });
      if (friendsVisible !== undefined)
        await db.rpc('profile_friends', { p_user: user.id, p_on: friendsVisible });
      return json(await profile(user));
    }
    if (req.method === 'GET' && path[0] === 'submissions' && path.length === 2) {
      // "Add again": the owner's own form, for another date. Anyone else gets 404.
      const id = path[1]!;
      if (!uuid.safeParse(id).success) throw new ApiError(404, 'not_found');
      const form = await db.rpc<object | null>('submission_form', { p_user: user.id, p_id: id });
      if (!form) throw new ApiError(404, 'not_found');
      return json({ form }, 200, noStore);
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
      // A waiting account has nothing under the email it typed: only its own rows go.
      if (!user.pending) await db.rpc('account_forget', { p_user: user.id, p_email: user.email });
      await db.deleteUser(user.id);
      forget(user.id);
      return new Response(null, { status: 204, headers: noStore });
    }
    throw new ApiError(404, 'not_found');
  }

  /**
   * POST /api/auth/pending {email, locale}: signs the device in at once as an account that waits
   * for activation. The email is not proven, so this is never the email's own account: it is a
   * new one that may only accept invitations, and `POST /api/auth/activate` folds it into the
   * real account once the code is typed. Sent with a waiting account's own token, it changes the
   * email that account waits for. The answer is the same whether or not the email has an account.
   */
  async function pendingAccount(req: Request): Promise<Response> {
    const { db, salt } = need();
    const { email } = await body(req, codeRequestSchema);
    if (isPendingEmail(email)) throw new ApiError(400, 'invalid_input', 'email');
    const current = req.headers.has('authorization') ? await requireAnyUser(req) : null;
    if (current && !current.pending) throw new ApiError(409, 'already_reviewed');
    if (current) {
      await limit('pending-email', current.id, 3600, auth.pending.perHourPerClient);
      await db.rpc('pending_add', { p_user: current.id, p_email: email });
      return json({ email }, 200, noStore);
    }
    await limit('pending', await clientHash(req, salt), 3600, auth.pending.perHourPerClient);
    let session: Awaited<ReturnType<typeof db.createSession>>;
    try {
      session = await db.createSession(`p-${crypto.randomUUID()}@${auth.pending.domain}`);
    } catch (err) {
      if (err instanceof SupabaseError) throw new ApiError(502, 'auth_failed', err.message);
      throw err;
    }
    const { id, ...tokens } = session;
    await db.rpc('pending_add', { p_user: id, p_email: email });
    return json({ session: tokens, email }, 201, noStore);
  }

  /**
   * POST /api/auth/activate {pendingToken} 🔑: the code was typed (or Google signed in), so the
   * waiting account behind `pendingToken` is folded into this one and deleted. Holding both
   * tokens is the proof; a token of an activated account is refused.
   */
  async function activate(req: Request): Promise<Response> {
    const user = await requireUser(req);
    const { db } = need();
    const { pendingToken } = await body(req, activateSchema);
    const from = await userOf(pendingToken);
    if (!from) throw new ApiError(404, 'not_found');
    if (!from.pending) throw new ApiError(400, 'invalid_input', 'pendingToken');
    const merged = await db.rpc<boolean>('pending_merge', { p_from: from.id, p_to: user.id });
    await db.deleteUser(from.id);
    forget(from.id);
    return json({ merged: merged === true }, 200, noStore);
  }

  /**
   * POST /api/auth/code-request {email, locale}: with manual delivery, files a request for a
   * sign-in code that the admin sends by hand; with "app" delivery, makes the code and
   * emails it at once. Always the same answer, so it never tells whether an account exists.
   */
  async function authRoutes(req: Request, path: string[]): Promise<Response> {
    if (req.method === 'POST' && path.join('/') === 'pending') return pendingAccount(req);
    if (req.method === 'POST' && path.join('/') === 'activate') return activate(req);
    if (
      req.method !== 'POST' ||
      path.join('/') !== 'code-request' ||
      (auth.emailDelivery !== 'manual' && auth.emailDelivery !== 'app')
    )
      throw new ApiError(404, 'not_found');
    if (auth.emailDelivery === 'app' && !sender) throw new ApiError(503, 'not_configured');
    const { db, salt } = need();
    const { email, locale } = await body(req, codeRequestSchema);
    if (isPendingEmail(email)) throw new ApiError(400, 'invalid_input', 'email');
    const client = await clientHash(req, salt);
    await limit('code-request', client, 3600, auth.codeRequestsPerHourPerClient);
    await limit(
      'code-request-email',
      await sha256(`${salt}:email:${email}`),
      86_400,
      auth.codeRequestsPerDayPerEmail,
    );
    if (auth.emailDelivery === 'app') {
      await db.ensureUser(email);
      let code: { code: string; link: string };
      try {
        code = await db.signInCode(email, `${app.site.url}/`);
      } catch (err) {
        if (err instanceof SupabaseError) throw new ApiError(502, 'auth_failed', err.message);
        throw err;
      }
      const mail = codeEmail(locale, code.code, code.link);
      try {
        await sender!.send({ to: email, subject: mail.subject, text: mail.body });
      } catch (err) {
        console.error(JSON.stringify({ email: 'code', error: String(err) }));
        throw new ApiError(502, 'email_failed');
      }
      return json({ ok: true }, 202);
    }
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

  /** /api/admin/grants[/:id] for the admin only: manual plan grants. */
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

  /** /api/admin/sources[/:id] for the admin only: the website check's candidates. */
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
    // Events per district and category, today and the week, with the weekly metrics.
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
          noStore,
        );
      } catch (err) {
        if (err instanceof SupabaseError && err.code === 'P0002')
          throw new ApiError(404, 'not_found');
        throw err;
      }
    }
    // Trust back after a rejection.
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

  return {
    requireUser,
    requireAnyUser,
    optionalUser,
    optionalAnyUser,
    planOf,
    usageOf,
    me,
    auth: authRoutes,
    admin,
  };
}
