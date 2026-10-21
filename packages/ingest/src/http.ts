/** Minimal HTTP client for adapters: per-source throttling, retries with backoff, Retry-After. */
export interface HttpOptions {
  userAgent: string;
  /** Minimum spacing between requests (from the source's rateLimit). */
  minIntervalMs?: number;
  retries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called with every successful response body; used to record fixtures. */
  onResponse?: (url: string, body: string) => void;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${redact(url)}: ${body.slice(0, 200)}`);
  }
}

/** Hide credentials that providers expect in the query string. */
export function redact(url: string): string {
  return url.replace(/([?&](?:apikey|api_key|key|token|access_token)=)[^&]+/gi, '$1***');
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpClient {
  private next = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpOptions) {
    // Through a closure: the global fetch must not be called as a method (Workers, some runtimes).
    this.fetchImpl = (input, init) => (opts.fetch ?? globalThis.fetch)(input, init);
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async throttle(): Promise<void> {
    const wait = this.next - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.next = Math.max(Date.now(), this.next) + (this.opts.minIntervalMs ?? 0);
  }

  async text(url: string, init: RequestInit = {}): Promise<string> {
    const retries = this.opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          headers: { 'User-Agent': this.opts.userAgent, ...init.headers },
          signal: init.signal ?? AbortSignal.timeout(20_000),
        });
      } catch (err) {
        if (attempt >= retries) throw err;
        await this.sleep(backoff(attempt));
        continue;
      }
      const body = await res.text();
      if (res.ok) {
        this.opts.onResponse?.(url, body);
        return body;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) throw new HttpError(res.status, url, body);
      const after = Number(res.headers.get('retry-after'));
      await this.sleep(after > 0 ? Math.min(after, 60) * 1000 : backoff(attempt));
    }
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    return JSON.parse(await this.text(url, init)) as T;
  }
}

function backoff(attempt: number): number {
  return 1000 * 2 ** attempt;
}
