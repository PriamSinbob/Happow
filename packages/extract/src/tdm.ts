/**
 * Text and data mining reservations (EU DSM Directive art. 4; W3C TDMRep). A reserved
 * page is never sent to the LLM; its published structured data is still read.
 */

export interface TdmRule {
  /** A path pattern from tdmrep.json: "/", "/events/*", "*.html". */
  location: string;
  reserved: boolean;
}

/** /.well-known/tdmrep.json → rules; anything malformed reads as no rules. */
export function parseTdmRep(text: string): TdmRule[] {
  try {
    const v: unknown = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v.flatMap((r): TdmRule[] => {
      if (!r || typeof r !== 'object') return [];
      const o = r as Record<string, unknown>;
      if (typeof o.location !== 'string') return [];
      return [{ location: o.location, reserved: Number(o['tdm-reservation']) === 1 }];
    });
  } catch {
    return [];
  }
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${pattern.endsWith('*') ? '' : '(?:$|[?#])'}`,
  );
  // A bare directory pattern ("/events/") covers what is under it, as TDMRep's examples do.
  return re.test(path) || (pattern.endsWith('/') && path.startsWith(pattern));
}

/** The most specific (longest) matching rule decides; no match means no reservation. */
export function reservedByRules(rules: TdmRule[], path: string): boolean {
  const hit = rules
    .filter((r) => matches(r.location, path))
    .sort((a, b) => b.location.length - a.location.length)[0];
  return hit?.reserved ?? false;
}

/** `<meta name="tdm-reservation" content="1">` in the page. */
export function reservedByMeta(html: string): boolean {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/name\s*=\s*["']?tdm-reservation["']?/i.test(tag)) continue;
    const content = /content\s*=\s*["']?\s*([^"'\s>]+)/i.exec(tag)?.[1];
    if (content === '1') return true;
  }
  return false;
}

/** The `tdm-reservation: 1` response header. */
export function reservedByHeader(headers: Headers): boolean {
  return headers.get('tdm-reservation')?.trim() === '1';
}
