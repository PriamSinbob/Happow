/**
 * robots.txt matching (RFC 9309): the group for our product token, else "*"; longest matching rule
 * wins, Allow wins a tie; `*` and `$` wildcards.
 */
export interface Robots {
  isAllowed(url: string): boolean;
}

interface Rule {
  allow: boolean;
  pattern: string;
}

export function parseRobots(txt: string, productToken: string): Robots {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const token = productToken.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const rules = (own.length ? own : groups.filter((g) => g.agents.includes('*'))).flatMap(
    (g) => g.rules,
  );

  return {
    isAllowed(url: string) {
      const u = new URL(url);
      const path = u.pathname + u.search;
      let best: Rule | null = null;
      for (const r of rules) {
        if (!matches(r.pattern, path)) continue;
        if (
          !best ||
          r.pattern.length > best.pattern.length ||
          (r.pattern.length === best.pattern.length && r.allow)
        )
          best = r;
      }
      return best ? best.allow : true;
    },
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${re}${anchored ? '$' : ''}`).test(path);
}

/** First token of a User-Agent header ("Happow/0.4 (+url)" → "happow"). */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[\s/]/)[0] ?? userAgent).toLowerCase();
}
