import type { HappowEvent, Source, Trust } from '@happow/core';

export interface DedupConfig {
  startToleranceMin: number;
  titleSimilarity: number;
}

/** An event already stored, with the listing that currently owns its primary fields. */
export interface StoredEvent {
  event: HappowEvent;
  primarySourceId: string | null;
  primaryExternalId: string | null;
}

const TRUST_RANK: Record<Trust, number> = { api: 3, crawled: 2, community: 1 };

/**
 * Higher wins: trust level first, then position in sources.json (earlier = preferred).
 * Unknown sources rank lowest.
 */
export function sourceRanker(sources: Source[]): (sourceId: string | null) => number {
  const byId = new Map(sources.map((s, i) => [s.id, { trust: s.trustLevel, index: i }]));
  return (id) => {
    const s = id ? byId.get(id) : undefined;
    return s ? TRUST_RANK[s.trust] * 1000 - s.index : -1;
  };
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'of',
  'in',
  'at',
  'live',
  'w',
  'i',
  'z',
  'na',
  'do',
  'oraz',
  'feat',
  'ft',
]);

/** Lower-case, strip diacritics and punctuation, drop filler words. "Koncert: Ewa Bem – LIVE!" → "koncert ewa bem". */
export function normalizeTitle(title: string): string {
  return title
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ');
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/**
 * 0–1 similarity of two titles: the larger of the Sørensen–Dice bigram score and token containment
 * (one listing often adds a tour name or venue: "Dawid Podsiadło" vs "Dawid Podsiadło – Trasa 2026").
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const dice = total ? (2 * overlap) / total : 0;

  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const contained = [...small].filter((w) => big.has(w)).length;
  // Containment only counts when the shorter title carries real content (2+ words or one long word).
  const meaningful = small.size >= 2 || [...small].some((w) => w.length >= 6);
  const containment = meaningful ? (contained / small.size) * 0.9 : 0;
  return Math.max(dice, containment);
}

/**
 * Best stored event that is the same real-world event: nearby cell (the caller pre-selects by H3
 * neighbourhood), start within the tolerance, similar title. Null when nothing qualifies.
 */
export function findDuplicate(
  candidate: HappowEvent,
  stored: StoredEvent[],
  cfg: DedupConfig,
): StoredEvent | null {
  const start = new Date(candidate.startAt).getTime();
  let best: { s: StoredEvent; score: number } | null = null;
  for (const s of stored) {
    if (s.event.id === candidate.id) continue;
    const dt = Math.abs(new Date(s.event.startAt).getTime() - start) / 60_000;
    if (dt > cfg.startToleranceMin) continue;
    const score = titleSimilarity(candidate.title, s.event.title);
    if (score >= cfg.titleSimilarity && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

/** Primary fields from `primary`; anything it lacks is filled from `other`. */
export function mergeEvents(primary: HappowEvent, other: HappowEvent): HappowEvent {
  const pick = <K extends keyof HappowEvent>(k: K): HappowEvent[K] => primary[k] ?? other[k];
  const takeOtherEnd = primary.endEstimated && !other.endEstimated;
  return {
    ...primary,
    description: pick('description'),
    venue: pick('venue'),
    densityCell: primary.densityCell ?? other.densityCell,
    priceMin: pick('priceMin'),
    priceMax: pick('priceMax'),
    currency: pick('currency'),
    officialUrl: pick('officialUrl'),
    ticketUrl: pick('ticketUrl'),
    imageUrl: pick('imageUrl'),
    rules: { ...other.rules, ...primary.rules },
    endAt: takeOtherEnd ? other.endAt : primary.endAt,
    endEstimated: takeOtherEnd ? false : primary.endEstimated,
    trust: rankTrust(primary.trust) >= rankTrust(other.trust) ? primary.trust : other.trust,
    lastSeenAt: primary.lastSeenAt > other.lastSeenAt ? primary.lastSeenAt : other.lastSeenAt,
  };
}

function rankTrust(t: Trust): number {
  return TRUST_RANK[t];
}

export interface Listing {
  sourceId: string;
  externalId: string;
}

export type Decision =
  | { action: 'insert'; event: HappowEvent; owner: Listing }
  | { action: 'update'; event: HappowEvent; owner: Listing; merged: boolean };

/**
 * What to do with one incoming listing.
 * - `linked`: the stored event this listing already points at, if any.
 * - `nearby`: stored events in the same H3 neighbourhood and time span, for duplicate search.
 * The listing writes the primary fields when it owns the event or its source ranks strictly higher
 * than the owner's; otherwise it only fills gaps. Equal rank keeps the first owner, so a second
 * listing of the same show never flips the title back and forth between runs.
 */
export function decide(
  incoming: HappowEvent,
  listing: Listing,
  linked: StoredEvent | null,
  nearby: StoredEvent[],
  rank: (sourceId: string | null) => number,
  cfg: DedupConfig,
): Decision {
  const target = linked ?? findDuplicate(incoming, nearby, cfg);
  if (!target) return { action: 'insert', event: incoming, owner: listing };
  const owns =
    target.primarySourceId === listing.sourceId && target.primaryExternalId === listing.externalId;
  const takesOver = owns || rank(listing.sourceId) > rank(target.primarySourceId);
  const withId = { ...incoming, id: target.event.id };
  const event = takesOver ? mergeEvents(withId, target.event) : mergeEvents(target.event, withId);
  const owner =
    takesOver || !target.primarySourceId || !target.primaryExternalId
      ? listing
      : { sourceId: target.primarySourceId, externalId: target.primaryExternalId };
  return { action: 'update', event: { ...event, id: target.event.id }, owner, merged: !linked };
}
