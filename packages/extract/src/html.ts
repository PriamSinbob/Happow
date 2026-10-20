/** Small, dependency-free HTML helpers. Pages are untrusted input: everything here is tolerant and bounded. */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  oacute: 'ó',
  Oacute: 'Ó',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Every parseable `<script type="application/ld+json">` block on the page. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    for (const candidate of [raw, sanitizeJson(raw)]) {
      try {
        out.push(JSON.parse(candidate));
        break;
      } catch {
        /* try the sanitized form, then give up on this block */
      }
    }
  }
  return out;
}

/** Common publisher mistakes: HTML comments, raw control characters, trailing commas. */
function sanitizeJson(s: string): string {
  return s
    .replace(/^\s*<!--|-->\s*$/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/,\s*([}\]])/g, '$1');
}

const DROP =
  /<(script|style|noscript|svg|template|iframe|head|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK = /<\/?(p|div|li|ul|ol|tr|td|th|h[1-6]|section|article|br|dd|dt|time|table)\b[^>]*>/gi;

/** Visible text of a page, one block per line, for the LLM. Navigation and chrome are dropped. */
export function htmlToText(html: string, maxChars = 20_000): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = decodeEntities(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(DROP, ' ')
      .replace(BLOCK, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  canonical: string | null;
  siteName: string | null;
}

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${key}["'][^>]*content\\s*=\\s*["']([^"']*)["']` +
      `|<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${key}["']`,
    'i',
  );
  const m = re.exec(html);
  const v = m?.[1] ?? m?.[2];
  return v ? decodeEntities(v).trim() || null : null;
}

export function pageMeta(html: string): PageMeta {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const canonical = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(
    html,
  )?.[1];
  return {
    title: metaContent(html, 'og:title') ?? (title ? decodeEntities(title).trim() || null : null),
    description: metaContent(html, 'og:description') ?? metaContent(html, 'description'),
    image: metaContent(html, 'og:image'),
    canonical: canonical ?? metaContent(html, 'og:url'),
    siteName: metaContent(html, 'og:site_name'),
  };
}

/** Absolute http(s) links on the page whose URL matches `pattern`, without fragments, deduplicated. */
export function findLinks(html: string, baseUrl: string, pattern: RegExp): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(m[1]!), baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    url.hash = '';
    const s = url.toString();
    if (pattern.test(s)) out.add(s);
  }
  return [...out];
}
