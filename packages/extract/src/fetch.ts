/**
 * Fetching untrusted URLs (crawl targets, user-pasted links): http(s) only, public hosts only,
 * redirects re-checked hop by hop, size and time bounded, HTML only.
 */
export class UnsafeUrlError extends Error {}

/**
 * A fetch that is safe to keep on an object. Cloudflare Workers throw "Illegal invocation" when
 * the global fetch is called as a method (`this.fetch(...)`); calling through a closure is fine.
 */
export function boundFetch(custom?: typeof fetch): typeof fetch {
  return (input, init) => (custom ?? globalThis.fetch)(input, init);
}
export class FetchPageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet'];

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Throws unless `raw` is an http(s) URL on a public host and default port. DNS-level tricks
 * (a public name resolving to a private address) are out of reach here; in production the fetch
 * runs on Cloudflare's edge, which cannot reach private networks anyway.
 */
export function checkPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new UnsafeUrlError('only http(s) links are supported');
  if (url.username || url.password)
    throw new UnsafeUrlError('links with credentials are not allowed');
  if (url.port && url.port !== '80' && url.port !== '443')
    throw new UnsafeUrlError('non-standard ports are not allowed');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    !host.includes('.') ||
    host.startsWith('[') ||
    isPrivateIPv4(host) ||
    BLOCKED_SUFFIXES.some((s) => host.endsWith(s))
  )
    throw new UnsafeUrlError('this host is not allowed');
  return url;
}

export interface FetchPageOptions {
  userAgent: string;
  fetch?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface FetchedPage {
  url: string;
  status: number;
  html: string;
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, out.byteLength - offset));
    out.set(part, offset);
    offset += part.byteLength;
    if (offset >= out.byteLength) break;
  }
  return out;
}

export async function fetchPage(raw: string, opts: FetchPageOptions): Promise<FetchedPage> {
  const doFetch = opts.fetch ?? fetch;
  let url = checkPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await doFetch(url.toString(), {
      redirect: 'manual',
      headers: {
        'User-Agent': opts.userAgent,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'pl,en;q=0.8',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop >= (opts.maxRedirects ?? 3)) throw new FetchPageError('too many redirects');
      url = checkPublicUrl(new URL(res.headers.get('location')!, url).toString());
      continue;
    }
    if (!res.ok) throw new FetchPageError(`page returned ${res.status}`, res.status);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type))
      throw new FetchPageError('the link is not a web page');
    const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? 'utf-8';
    const bytes = await readLimited(res, opts.maxBytes ?? 3_000_000);
    let html: string;
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      html = new TextDecoder('utf-8').decode(bytes);
    }
    return { url: url.toString(), status: res.status, html };
  }
}
