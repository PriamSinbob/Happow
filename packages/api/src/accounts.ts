import { languageSchema, type AppConfig } from '@happow/core';
import { z } from 'zod';
import { ApiError, body, json, sha256 } from './http.js';
import { SupabaseError, type AuthUser, type Supabase } from './supabase.js';

/** A checked user, with their staff role (null for everyone who isn't staff). */
export interface User extends AuthUser {
  role: 'moderator' | 'admin' | null;
}

export interface AccountDeps {
  app: AppConfig;
  /** Throws 503 when Supabase or the salt are not configured. */
  need: () => { db: Supabase; salt: string };
  now: () => Date;
  limit: (bucket: string, actor: string, windowSeconds: number, max: number) => Promise<void>;
  clientHash: (req: Request, salt: string) => Promise<string>;
}

const meSchema = z
  .object({ locale: languageSchema.optional(), termsVersion: z.string().min(1).max(60).optional() })
  .strict();
const codeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: languageSchema,
});
const uuid = z.string().uuid();

/** Account endpoints (M8 §2): /api/me, /api/auth/*, /api/admin/*. */
export function accountRoutes({ app, need, now, limit, clientHash }: AccountDeps) {
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

  async function profile(user: User) {
    const { db } = need();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      ...(await db.rpc<object>('profile_get', { p_user: user.id })),
    };
  }

  /** GET/PUT/DELETE /api/me, GET /api/me/export. */
  async function me(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    const { db } = need();
    const sub = path.join('/');
    if (req.method === 'GET' && sub === '') return json(await profile(user));
    if (req.method === 'PUT' && sub === '') {
      const { locale, termsVersion } = await body(req, meSchema);
      if (termsVersion !== undefined && termsVersion !== legal.termsVersion)
        throw new ApiError(400, 'invalid_input', 'termsVersion');
      await db.rpc('profile_update', {
        p_user: user.id,
        p_locale: locale ?? null,
        p_terms_version: termsVersion ?? null,
      });
      return json(await profile(user));
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

  /** /api/admin/code-requests[/:id[/generate]] for the admin only. */
  async function admin(req: Request, path: string[]): Promise<Response> {
    const user = await requireUser(req);
    if (user.role !== 'admin') throw new ApiError(403, 'forbidden');
    const { db } = need();
    const [kind, id, action] = path;
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

  return { requireUser, me, auth: authRoutes, admin };
}
