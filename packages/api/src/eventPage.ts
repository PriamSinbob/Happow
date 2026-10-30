import { isInBbox, loadConfig, type HappowConfig, type Region } from '@happow/core';
import { boundFetch } from '@happow/extract';
import type { ApiDeps, ApiEnv } from './handler.js';
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
export function createEventPage(env: ApiEnv, deps: Pick<ApiDeps, 'fetch' | 'config'> = {}) {
  const config = deps.config ?? loadConfig();
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

  return async function eventPage(req: Request, indexHtml: string): Promise<Response> {
    const url = new URL(req.url);
    const id = eventIdFromPath(url.pathname);
    if (!id || !db) return page(indexHtml, id ? 200 : 404, 0);

    let row: EventRow | undefined;
    try {
      // event_by_id reads events_public, which leaves out hidden and stale events.
      [row] = await db.rpc<EventRow[]>('event_by_id', { event_id: id });
    } catch (err) {
      console.error(err);
      return page(indexHtml, 200, 0);
    }
    if (!row) return page(indexHtml, 404, MISSING_CACHE_S);

    const region = regionAt(config, row.lat, row.lng);
    const lang = config.app.languages.includes(region.locale) ? region.locale : fallback;
    const labels = config.categories.find((c) => row.category_ids.includes(c.id))?.labels as
      Record<string, string> | undefined;
    const description = [
      whenText(row.start_at, row.end_at, row.timezone || region.timezone, lang),
      row.venue_name,
      labels?.[lang] ?? labels?.[fallback],
    ]
      .filter(Boolean)
      .join(' · ');
    const html = withTags(indexHtml, {
      title: `${row.title} · Happow`,
      description,
      url: `${url.origin}/e/${encodeURIComponent(row.id)}`,
      image: `${url.origin}/icons/icon-512.png`,
      card: 'summary',
      lang,
    });
    return page(html, 200, EVENT_CACHE_S);
  };
}
