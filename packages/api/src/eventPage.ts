import {
  isInBbox,
  loadConfig,
  type Category,
  type HappowConfig,
  type LatLng,
  type Region,
} from '@happow/core';
import { boundFetch } from '@happow/extract';
import type { ApiDeps, ApiEnv } from './handler.js';
import { sha256 } from './http.js';
import { Supabase } from './supabase.js';

/** The event_by_id columns a link preview needs. */
interface EventRow {
  id: string;
  title: string;
  category_ids: string[];
  start_at: string;
  end_at: string;
  timezone: string;
  venue_name: string | null;
  lat: number;
  lng: number;
}

/** How far around the event the preview image's map reaches, in metres (M9 §2). */
export const PREVIEW_MAP_RADIUS_M = 1500;

/** A district on the preview map, from district_outlines(). */
export interface Outline {
  name: string;
  /** The district the event is in. */
  here: boolean;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

/** Everything the preview image shows; no prices and no counts (M9 §2). */
export interface PreviewData {
  title: string;
  when: string;
  venue: string | null;
  category: Category | null;
  categoryLabel: string | null;
  lang: string;
  point: LatLng;
  outlines: Outline[];
  /** Short hash of what's drawn; the image URL carries it so an edited event gets a new image. */
  version: string;
}

/** How long a shared link's tagged page is cached at the edge (M9 §1). */
const EVENT_CACHE_S = 300;
const MISSING_CACHE_S = 60;

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** The event id in /e/<id>[/…], or null. Ids carry ':' (source:id), which links percent-encode. */
export function eventIdFromPath(pathname: string): string | null {
  const m = /^\/e\/([^/]+)/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!) || null;
  } catch {
    return null;
  }
}

/** The region an event is in (by its point), else the default region. */
function regionAt(config: HappowConfig, lat: number, lng: number): Region {
  return (
    config.regions.find((r) => isInBbox({ lat, lng }, r.bbox)) ??
    config.regions.find((r) => r.id === config.app.defaultRegion)!
  );
}

/** "sob., 31 paź, 19:00–21:30" in the event's language and time zone; the end only on the same day. */
export function whenText(startAt: string, endAt: string, timeZone: string, lang: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const day = new Intl.DateTimeFormat(lang, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = new Intl.DateTimeFormat(lang, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const sameDay = day.format(start) === day.format(end);
  return `${day.format(start)}, ${time.format(start)}${sameDay ? `–${time.format(end)}` : ''}`;
}

export interface PreviewTags {
  title: string;
  description: string;
  url: string;
  image: string;
  /** "summary_large_image" once the event has its own 1200×630 card (slice B). */
  card: 'summary' | 'summary_large_image';
  lang: string;
}

/** Puts the preview tags into the app's index.html, replacing its generic title and description. */
export function withTags(indexHtml: string, t: PreviewTags): string {
  const tags = [
    `<title>${escape(t.title)}</title>`,
    `<meta name="description" content="${escape(t.description)}" />`,
    `<link rel="canonical" href="${escape(t.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Happow" />`,
    `<meta property="og:title" content="${escape(t.title)}" />`,
    `<meta property="og:description" content="${escape(t.description)}" />`,
    `<meta property="og:url" content="${escape(t.url)}" />`,
    `<meta property="og:image" content="${escape(t.image)}" />`,
    `<meta property="og:locale" content="${escape(t.lang)}" />`,
    `<meta name="twitter:card" content="${t.card}" />`,
    `<meta name="twitter:title" content="${escape(t.title)}" />`,
    `<meta name="twitter:description" content="${escape(t.description)}" />`,
    `<meta name="twitter:image" content="${escape(t.image)}" />`,
  ].join('\n    ');
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/i, '')
    .replace(/<html lang="[^"]*"/i, `<html lang="${escape(t.lang)}"`)
    .replace(/<\/head>/i, `  ${tags}\n  </head>`);
}

/**
 * GET /e/<id>: the app's own index.html with Open Graph and Twitter Card tags for that event, so
 * a link pasted in a chat previews as the event (M9 §1). Crawlers don't run JavaScript and never
 * see a #fragment, so the tags have to be in the HTML. The app itself turns the path into its
 * event route. An unknown or hidden event gets the generic tags and a 404; a database error still
 * serves the app, so a shared link never breaks.
 */
export function createEventPage(env: ApiEnv, deps: Pick<ApiDeps, 'fetch' | 'config' | 'now'> = {}) {
  const config = deps.config ?? loadConfig();
  const now = deps.now ?? (() => new Date());
  const db =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, boundFetch(deps.fetch))
      : null;
  const fallback = config.app.fallbackLanguage;

  const page = (html: string, status: number, cacheS: number) =>
    new Response(html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': cacheS ? `public, max-age=${cacheS}` : 'no-store',
      },
    });

  /** The public event and what both the tags and the image say about it; null when there's none. */
  async function load(db: Supabase, id: string) {
    // event_by_id reads events_public, which leaves out hidden and stale events.
    const [row] = await db.rpc<EventRow[]>('event_by_id', { event_id: id });
    if (!row) return null;
    const region = regionAt(config, row.lat, row.lng);
    const lang = config.app.languages.includes(region.locale) ? region.locale : fallback;
    const category = config.categories.find((c) => row.category_ids.includes(c.id));
    const labels = category?.labels as Record<string, string> | undefined;
    const when = whenText(row.start_at, row.end_at, row.timezone || region.timezone, lang);
    const categoryLabel = labels?.[lang] ?? labels?.[fallback] ?? null;
    // An old link still previews, marked as ended (§4); the image is kept as it was.
    const ended = new Date(row.end_at) < now();
    // Changes exactly when something drawn on the image changes, so edited events get a new one.
    const version = (
      await sha256(
        JSON.stringify([row.title, when, row.venue_name, category?.id, row.lat, row.lng, lang]),
      )
    ).slice(0, 12);
    return { row, lang, category, categoryLabel, when, version, ended };
  }

  return {
    async page(req: Request, indexHtml: string): Promise<Response> {
      const url = new URL(req.url);
      const id = eventIdFromPath(url.pathname);
      if (!id || !db) return page(indexHtml, id ? 200 : 404, 0);

      let ev: Awaited<ReturnType<typeof load>>;
      try {
        ev = await load(db, id);
      } catch (err) {
        console.error(err);
        return page(indexHtml, 200, 0);
      }
      if (!ev) return page(indexHtml, 404, MISSING_CACHE_S);

      const link = `${url.origin}/e/${encodeURIComponent(ev.row.id)}`;
      const html = withTags(indexHtml, {
        title: `${ev.row.title} · Happow`,
        description: [
          ev.ended && (config.app.sharing.endedLabel as Record<string, string>)[ev.lang],
          ev.when,
          ev.row.venue_name,
          ev.categoryLabel,
        ]
          .filter(Boolean)
          .join(' · '),
        url: link,
        image: `${link}/preview.png?v=${ev.version}`,
        card: 'summary_large_image',
        lang: ev.lang,
      });
      return page(html, 200, EVENT_CACHE_S);
    },

    /**
     * What the preview image shows (M9 §2), or null for an unknown or hidden event. Districts
     * that fail to load leave the map plain rather than failing the image.
     */
    async preview(id: string): Promise<PreviewData | null> {
      if (!db) return null;
      const ev = await load(db, id);
      if (!ev) return null;
      const outlines = await db
        .rpc<Outline[] | null>('district_outlines', {
          p_lat: ev.row.lat,
          p_lng: ev.row.lng,
          p_radius_m: PREVIEW_MAP_RADIUS_M,
        })
        .catch((err) => {
          console.error(err);
          return null;
        });
      return {
        title: ev.row.title,
        when: ev.when,
        venue: ev.row.venue_name,
        category: ev.category ?? null,
        categoryLabel: ev.categoryLabel,
        lang: ev.lang,
        point: { lat: ev.row.lat, lng: ev.row.lng },
        outlines: outlines ?? [],
        version: ev.version,
      };
    },
  };
}
