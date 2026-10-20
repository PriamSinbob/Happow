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
      Authorization: `Bearer ${this.serviceKey}`,
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
    return (await (await this.check(res)).json()) as T;
  }

  /** Email of the signed-in user behind an access token, or null when the token is not valid. */
  async userEmail(accessToken: string): Promise<string | null> {
    const res = await this.doFetch(`${this.base}/auth/v1/user`, {
      headers: { apikey: this.serviceKey, Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401 || res.status === 403) return null;
    const user = (await (await this.check(res)).json()) as { email?: string };
    return user.email?.toLowerCase() ?? null;
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
