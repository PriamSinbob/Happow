import { boundFetch, type GeoResult, type KeyValueCache } from '@happow/extract';

export class SupabaseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthUser {
  id: string;
  /** Lowercased. */
  email: string;
}

interface GeneratedLink {
  email_otp?: string;
  action_link?: string;
}

/** The few Supabase calls the API needs, over plain fetch (PostgREST + GoTrue), with the service key. */
export class Supabase {
  private readonly base: string;

  constructor(
    url: string,
    private readonly serviceKey: string,
    customFetch?: typeof fetch,
  ) {
    this.base = url.replace(/\/$/, '');
    this.doFetch = boundFetch(customFetch);
  }

  private readonly doFetch: typeof fetch;

  private headers(extra: Record<string, string> = {}) {
    return {
      apikey: this.serviceKey,
      // Legacy keys are JWTs and also go in Authorization; new sb_secret_ keys go in apikey only.
      ...(this.serviceKey.startsWith('eyJ') && { Authorization: `Bearer ${this.serviceKey}` }),
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async check(res: Response): Promise<Response> {
    if (res.ok) return res;
    let body: { code?: string; message?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* not JSON */
    }
    throw new SupabaseError(
      res.status,
      body.code,
      body.message ?? `Supabase returned ${res.status}`,
    );
  }

  async rpc<T>(name: string, args: object): Promise<T> {
    const res = await this.doFetch(`${this.base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(args),
    });
    // A function that returns nothing answers 204 with an empty body (PostgREST), so an empty
    // reply is null rather than a JSON error.
    const text = await (await this.check(res)).text();
    return (text ? JSON.parse(text) : null) as T;
  }

  /** The signed-in user behind an access token, or null when the token is not valid. */
  async user(accessToken: string): Promise<AuthUser | null> {
    const res = await this.doFetch(`${this.base}/auth/v1/user`, {
      headers: { apikey: this.serviceKey, Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401 || res.status === 403) return null;
    const user = (await (await this.check(res)).json()) as { id?: string; email?: string };
    return user.id && user.email ? { id: user.id, email: user.email.toLowerCase() } : null;
  }

  /** Creates a confirmed user for an email; an existing user is left as it is. */
  async ensureUser(email: string): Promise<void> {
    const res = await this.doFetch(`${this.base}/auth/v1/admin/users`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (res.status === 422) return; // email_exists
    await this.check(res);
  }

  /**
   * A sign-in code and link for an existing user, without Supabase sending any email
   * (admin generate_link). The code works with /auth/v1/verify (type "email").
   */
  async signInCode(email: string, redirectTo: string): Promise<{ code: string; link: string }> {
    const res = await this.doFetch(`${this.base}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirectTo }),
    });
    const body = (await (await this.check(res)).json()) as GeneratedLink & {
      properties?: GeneratedLink;
    };
    // GoTrue answers with the fields at the top level; some versions nest them in "properties".
    const p = body.properties ?? body;
    if (!p.email_otp || !p.action_link) throw new SupabaseError(502, undefined, 'no code returned');
    return { code: p.email_otp, link: p.action_link };
  }

  async deleteUser(id: string): Promise<void> {
    const res = await this.doFetch(`${this.base}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (res.status === 404) return;
    await this.check(res);
  }

  /** The geocode_cache table as a cache (shared with the crawler). */
  geocodeCache(provider: string, maxAgeDays: number): KeyValueCache<GeoResult | null> {
    return {
      get: async (key) => {
        const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
        const q = new URLSearchParams({
          query_key: `eq.${key}`,
          fetched_at: `gt.${since}`,
          select: 'result',
        });
        const res = await this.check(
          await this.doFetch(`${this.base}/rest/v1/geocode_cache?${q}`, {
            headers: this.headers(),
          }),
        );
        const rows = (await res.json()) as { result: GeoResult | null }[];
        return rows.length ? rows[0]!.result : undefined;
      },
      set: async (key, value) => {
        await this.check(
          await this.doFetch(`${this.base}/rest/v1/geocode_cache?on_conflict=query_key`, {
            method: 'POST',
            headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
            body: JSON.stringify({
              query_key: key,
              provider,
              result: value,
              fetched_at: new Date().toISOString(),
            }),
          }),
        );
      },
    };
  }
}
