import {
  eventsFromJsonLd,
  extractJsonLd,
  findLinks,
  resolveInstant,
  type ExtractedEvent,
} from '@happow/extract';
import { HttpError, type HttpClient } from '../http.js';
import { readIcal, readTribe, tribeFirstPage, type TribePage } from './formats.js';

/**
 * The website check (M12 §2.2): does a venue's site publish its events as an iCal feed, through
 * The Events Calendar's REST API, or as schema.org Event JSON-LD on its home or events page?
 * At most five requests per site: the home page, one events page, the REST API, two feeds.
 */

export type CandidateKind = 'ical' | 'tribe' | 'jsonld';

export interface FoundCandidate {
  url: string;
  kind: CandidateKind;
  /** Upcoming events within the horizon. */
  count: number;
  sample: { title: string; start: string }[];
}

export interface ProbeResult {
  status: 'found' | 'none' | 'blocked' | 'error';
  error?: string;
  candidates: FoundCandidate[];
}

export interface ProbeDeps {
  http: HttpClient;
  /** robots.txt says yes for this URL. */
  allowed: (url: string) => Promise<boolean>;
  timeZone: string;
  now: Date;
  horizonDays: number;
  eventsPageWords: string[];
}

const FEED_LINK = /\.ics(?:\?|$)|[?&]ical=1(?:&|$)/i;
const TRIBE_PATH = '/wp-json/tribe/events/v1/events';

/** Calendar feeds a page links to: <link rel=alternate type=text/calendar>, .ics and ?ical=1 links. */
export function feedLinks(html: string, base: string): string[] {
  const page = html.replace(/webcals?:\/\//gi, 'https://');
  const out = new Set(findLinks(page, base, FEED_LINK));
  for (const m of page.matchAll(/<link\b[^>]*>/gi)) {
    if (!/type\s*=\s*["']text\/calendar["']/i.test(m[0])) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (!href) continue;
    try {
      out.add(new URL(href, base).toString());
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

/** The first same-site link whose path has one of the words ("/wydarzenia", "/kalendarz"). */
export function eventsPageLink(html: string, base: string, words: string[]): string | null {
  const origin = new URL(base).origin;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^?]*(${escaped.join('|')})`,
    'i',
  );
  return findLinks(html, base, pattern).find((u) => u !== base) ?? null;
}

const isWordPress = (html: string) => /\/wp-content\/|\/wp-json\//i.test(html);

export function summarize(
  url: string,
  kind: CandidateKind,
  events: ExtractedEvent[],
  d: Pick<ProbeDeps, 'timeZone' | 'now' | 'horizonDays'>,
): FoundCandidate | null {
  const from = d.now.getTime();
  const to = from + d.horizonDays * 86_400_000;
  const upcoming = events
    .filter((e) => !e.online)
    .map((e) => ({ e, at: resolveInstant(e.start, d.timeZone)?.at.getTime() }))
    .filter(
      (x): x is { e: ExtractedEvent; at: number } =>
        x.at !== undefined && x.at >= from - 86_400_000 && x.at <= to,
    )
    .sort((a, b) => a.at - b.at);
  if (!upcoming.length) return null;
  return {
    url,
    kind,
    count: upcoming.length,
    sample: upcoming.slice(0, 3).map(({ e }) => ({ title: e.title, start: e.start })),
  };
}

export async function probeSite(site: string, d: ProbeDeps): Promise<ProbeResult> {
  const found = new Map<string, FoundCandidate>();
  const keep = (c: FoundCandidate | null) => {
    if (c && !found.has(c.url)) found.set(c.url, c);
  };
  const get = async (url: string): Promise<string | null> => {
    if (!(await d.allowed(url))) return null;
    try {
      return await d.http.text(url);
    } catch (err) {
      // A missing page is an answer; anything else ends the check of this site.
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) return null;
      throw err;
    }
  };
  const window = {
    timeZone: d.timeZone,
    from: new Date(d.now.getTime() - 86_400_000),
    to: new Date(d.now.getTime() + d.horizonDays * 86_400_000),
  };

  try {
    if (!(await d.allowed(site))) return { status: 'blocked', candidates: [] };
    const home = await get(site);
    if (home === null) return { status: 'error', error: 'home page not found', candidates: [] };
    keep(summarize(site, 'jsonld', eventsFromJsonLd(extractJsonLd(home), site), d));
    const feeds = feedLinks(home, site);

    const eventsPage = eventsPageLink(home, site, d.eventsPageWords);
    if (eventsPage) {
      const html = await get(eventsPage);
      if (html !== null) {
        keep(summarize(eventsPage, 'jsonld', eventsFromJsonLd(extractJsonLd(html), eventsPage), d));
        for (const f of feedLinks(html, eventsPage)) if (!feeds.includes(f)) feeds.push(f);
      }
    }

    if (isWordPress(home)) {
      const endpoint = new URL(TRIBE_PATH, site).toString();
      const body = await get(tribeFirstPage(endpoint, d.now));
      if (body !== null) {
        try {
          const page = JSON.parse(body) as TribePage;
          if (Array.isArray(page.events))
            keep(summarize(endpoint, 'tribe', readTribe(page, site), d));
        } catch {
          /* not the plugin's JSON */
        }
      }
    }

    for (const feed of feeds.slice(0, 2)) {
      const text = await get(feed);
      if (!text || !/BEGIN:VCALENDAR/.test(text.slice(0, 2000))) continue;
      try {
        keep(summarize(feed, 'ical', readIcal(text, feed, window), d));
      } catch {
        /* a broken feed is not a candidate */
      }
    }
  } catch (err) {
    return {
      status: 'error',
      error: (err as Error).message.slice(0, 300),
      candidates: [...found.values()],
    };
  }
  const candidates = [...found.values()];
  return { status: candidates.length ? 'found' : 'none', candidates };
}
