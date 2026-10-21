import type { ExtractedEvent } from './types.js';
import { decodeEntities } from './html.js';

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

/** "https://schema.org/MusicEvent" / "schema:MusicEvent" / "MusicEvent" → "musicevent". */
function typeName(t: unknown): string {
  return typeof t === 'string' ? (t.split(/[/:#]/).pop() ?? t).toLowerCase() : '';
}

function types(n: Node): string[] {
  return asArray(n['@type'] as unknown)
    .map(typeName)
    .filter(Boolean);
}

/** schema.org Event and its subtypes (MusicEvent, TheaterEvent, Festival, …). */
export function isEventType(t: string): boolean {
  return (
    (t.endsWith('event') && t !== 'eventseries' && t !== 'eventreservation') || t === 'festival'
  );
}

/** Text from a string, a language-tagged value or an array of them. */
function text(v: unknown): string | null {
  if (typeof v === 'string') return decodeEntities(v).replace(/\s+/g, ' ').trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (isNode(v)) return text(v['@value'] ?? v.name ?? v.url);
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function url(v: unknown, base: string): string | null {
  const s = text(isNode(v) ? (v.url ?? v.contentUrl ?? v['@id']) : v);
  if (!s) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Fields a sub-event (one date of a series) takes from its parent when it does not say. */
const INHERITED = [
  'name',
  'description',
  'location',
  'offers',
  'isAccessibleForFree',
  'image',
  'url',
  'eventAttendanceMode',
  'eventStatus',
  'organizer',
] as const;

/** All nodes in a JSON-LD document: arrays, @graph, ItemList elements and nested values. */
function* walk(v: unknown, depth = 0): Generator<Node> {
  if (depth > 8) return;
  if (Array.isArray(v)) {
    for (const x of v) yield* walk(x, depth + 1);
    return;
  }
  if (!isNode(v)) return;
  yield v;
  for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity']) {
    if (key in v) yield* walk(v[key], depth + 1);
  }
  // EventSeries (and events with dates) list occurrences as sub-events that often hold only a date.
  for (const sub of asArray(v.subEvent as unknown).filter(isNode)) {
    const inherited = Object.fromEntries(INHERITED.filter((k) => k in v).map((k) => [k, v[k]]));
    yield* walk({ '@type': 'Event', ...inherited, ...sub }, depth + 1);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function date(v: unknown): string | null {
  const s = text(v);
  return s && DATE.test(s) ? s : null;
}

function status(v: unknown): ExtractedEvent['status'] {
  const s = typeName(text(v) ?? '');
  if (s === 'eventcancelled') return 'cancelled';
  if (s === 'eventpostponed') return 'postponed';
  return 'scheduled';
}

function place(v: unknown): {
  venueName: string | null;
  address: ExtractedEvent['address'];
  point: ExtractedEvent['point'];
  virtual: boolean;
} {
  const locs = asArray(v);
  const physical = locs.find((l) => !isNode(l) || !types(l).includes('virtuallocation'));
  const virtual = locs.length > 0 && !physical;
  const empty = { street: null, postalCode: null, city: null, country: null };
  if (physical === undefined) return { venueName: null, address: empty, point: null, virtual };
  if (!isNode(physical)) return { venueName: text(physical), address: empty, point: null, virtual };

  const a = physical.address;
  const address = isNode(a)
    ? {
        street: text(a.streetAddress),
        postalCode: text(a.postalCode),
        city: text(a.addressLocality),
        country: text(a.addressCountry),
      }
    : { ...empty, street: text(a) };
  const geo = isNode(physical.geo) ? physical.geo : null;
  const lat = num(geo?.latitude);
  const lng = num(geo?.longitude);
  const point =
    lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)
      ? { lat, lng }
      : null;
  return { venueName: text(physical.name), address, point, virtual };
}

function offers(v: unknown, isFreeFlag: unknown, base: string) {
  const list = asArray(v).filter(isNode);
  const prices: number[] = [];
  let currency: string | null = null;
  let ticketUrl: string | null = null;
  for (const o of list) {
    for (const k of ['price', 'lowPrice', 'highPrice']) {
      const p = num(o[k]);
      if (p !== null && p >= 0) prices.push(p);
    }
    currency ??= text(o.priceCurrency)?.toUpperCase().slice(0, 3) ?? null;
    ticketUrl ??= url(o.url, base);
  }
  const free = isFreeFlag === true || isFreeFlag === 'true';
  // Ticket shops put 0 on offers with no price yet or sold out, so 0 alone does not mean free:
  // only an explicit isAccessibleForFree does. Real prices win over placeholder zeros.
  const paid = prices.filter((p) => p > 0);
  return {
    isFree: free ? true : paid.length ? false : null,
    priceMin: free ? 0 : paid.length ? Math.min(...paid) : null,
    priceMax: free ? 0 : paid.length ? Math.max(...paid) : null,
    currency,
    ticketUrl,
  };
}

/** schema.org Events in a page's JSON-LD, mapped to the common extraction shape. */
export function eventsFromJsonLd(docs: unknown[], pageUrl: string): ExtractedEvent[] {
  const out: ExtractedEvent[] = [];
  const seen = new Set<string>();
  for (const node of walk(docs)) {
    const ts = types(node);
    if (!ts.some(isEventType)) continue;
    const title = text(node.name);
    const start = date(node.startDate);
    if (!title || !start) continue;
    const key = `${title}|${start}|${text(node.url) ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const loc = place(node.location);
    const mode = typeName(text(node.eventAttendanceMode) ?? '');
    const price = offers(node.offers, node.isAccessibleForFree, pageUrl);
    out.push({
      title,
      description: text(node.description),
      start,
      end: date(node.endDate),
      venueName: loc.venueName,
      address: loc.address,
      point: loc.point,
      ...price,
      url: url(node.url, pageUrl),
      imageUrl: url(asArray(node.image as unknown)[0], pageUrl),
      status: status(node.eventStatus),
      online:
        mode === 'onlineeventattendancemode' ||
        (loc.virtual && mode !== 'mixedeventattendancemode'),
      categoryHints: ts.filter((t) => t !== 'event'),
      categoryIds: [],
      method: 'jsonld',
      // Published structured data: trust the facts, but the place still has to be geocoded.
      confidence: 0.9,
    });
  }
  return out;
}
