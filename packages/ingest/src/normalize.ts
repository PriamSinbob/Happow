import {
  isInBbox,
  resolveEnd,
  type Category,
  type HappowEvent,
  type Region,
  type Source,
} from '@happow/core';
import { h3Cell } from './geo.js';
import type { NormalizedEvent, ParsedEvent, VenueRecord } from './types.js';

export interface NormalizeContext {
  source: Source;
  region: Region;
  categories: Category[];
  h3Resolution: number;
  /** Optional: coarser cell for density counts; omitted, the store keeps what it has. */
  densityResolution?: number;
  descriptionMaxChars: number;
  now: Date;
  /** Labels every source understands (schema.org event types), under the source's own map. */
  sharedCategoryMap?: Record<string, string>;
}

export type RejectReason = 'no-title' | 'bad-date' | 'no-location' | 'outside-region';

export type NormalizeResult =
  { ok: true; value: NormalizedEvent } | { ok: false; reason: RejectReason; externalId: string };

/** Turns a parsed source item into the app's event model. All source-specific mapping comes from config. */
export function normalize(p: ParsedEvent, ctx: NormalizeContext): NormalizeResult {
  const reject = (reason: RejectReason): NormalizeResult => ({
    ok: false,
    reason,
    externalId: p.externalId,
  });
  const title = cleanText(p.title);
  if (!title) return reject('no-title');

  const start = new Date(p.startAt);
  if (Number.isNaN(start.getTime())) return reject('bad-date');
  let end = p.endAt ? new Date(p.endAt) : null;
  if (end && !(end.getTime() > start.getTime())) end = null;

  const point = p.point ?? p.venue?.point ?? null;
  if (!point) return reject('no-location');
  if (!isInBbox(point, ctx.region.bbox)) return reject('outside-region');

  const known = new Set(ctx.categories.map((c) => c.id));
  const direct = (p.categoryIds ?? []).filter((c) => known.has(c));
  const categoryIds = direct.length
    ? direct
    : mapCategories(p.categoryLabels, ctx.source, ctx.sharedCategoryMap);
  const durations = new Map(ctx.categories.map((c) => [c.id, c.defaultDurationMin]));
  const { endAt, endEstimated } = resolveEnd(start, end, categoryIds, (c) => durations.get(c));

  const isFree = p.isFree ?? (p.priceMax !== null && p.priceMax === 0);
  const h3r9 = h3Cell(point, ctx.h3Resolution);
  const venue: VenueRecord | null = p.venue
    ? {
        id: `${ctx.source.id}:${p.venue.externalId ?? slug(`${p.venue.name}-${h3r9}`)}`,
        name: cleanText(p.venue.name),
        address: p.venue.address ? cleanText(p.venue.address) : null,
        point: p.venue.point ?? point,
        h3r9: h3Cell(p.venue.point ?? point, ctx.h3Resolution),
        website: p.venue.website,
      }
    : null;

  const nowIso = ctx.now.toISOString();
  const event: HappowEvent = {
    id: `${ctx.source.id}:${p.externalId}`,
    title,
    description:
      p.description && ctx.source.republishDescription
        ? truncate(stripHtml(p.description), ctx.descriptionMaxChars)
        : null,
    categoryIds,
    startAt: start.toISOString(),
    endAt: endAt.toISOString(),
    endEstimated,
    timezone: ctx.region.timezone,
    venue: venue
      ? { id: venue.id, name: venue.name, address: venue.address, website: venue.website }
      : null,
    point,
    h3r9,
    ...(ctx.densityResolution !== undefined && {
      densityCell: h3Cell(point, ctx.densityResolution),
    }),
    priceMin: isFree ? 0 : p.priceMin,
    priceMax: isFree ? 0 : (p.priceMax ?? p.priceMin),
    currency: p.currency,
    isFree,
    rules: p.rules,
    entry: p.entry ?? null,
    graceMin: null,
    ageMin: p.ageMin ?? null,
    family: p.family ?? null,
    officialUrl: p.officialUrl,
    ticketUrl: p.ticketUrl,
    imageUrl: ctx.source.republishImages ? p.imageUrl : null,
    status: p.status,
    trust: ctx.source.trustLevel,
    confidence: p.confidence ?? 1,
    lastSeenAt: nowIso,
  };
  const staleAfter = ctx.source.maxCacheAgeHours
    ? new Date(ctx.now.getTime() + ctx.source.maxCacheAgeHours * 3_600_000).toISOString()
    : null;
  return {
    ok: true,
    value: {
      event,
      venue,
      sourceId: ctx.source.id,
      externalId: p.externalId,
      sourceUrl: p.sourceUrl,
      staleAfter,
    },
  };
}

/**
 * Source classifications → category ids via the source's categoryMap. Each classification
 * contributes its most specific mapped label, so a broad parent ("Arts & Theatre") never adds a
 * second category next to its genre ("Fine Art"). "other" is dropped when anything more specific
 * matched; nothing matched → the source default.
 */
export function mapCategories(
  classifications: string[][],
  source: Source,
  shared: Record<string, string> = {},
): string[] {
  const out: string[] = [];
  for (const labels of classifications) {
    const id = labels
      .map((l) => {
        const key = l.trim().toLowerCase();
        return source.categoryMap[key] ?? shared[key];
      })
      .find((c): c is string => !!c);
    if (id && !out.includes(id)) out.push(id);
  }
  const specific = out.filter((c) => c !== 'other');
  if (specific.length) return specific;
  return out.length ? out : [...source.defaultCategories];
}

export function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function stripHtml(s: string): string {
  return cleanText(
    s
      .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
        if (e[0] === '#')
          return String.fromCodePoint(
            e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
          );
        return ENTITIES[e.toLowerCase()] ?? m;
      })
      // Markdown emphasis and links (Meetup descriptions), keeping the text.
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1'),
  );
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
