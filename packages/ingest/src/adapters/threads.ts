import { intervalMs, type Source } from '@happow/core';
import { resolveInstant } from '@happow/extract';
import type { AdapterContext, ParsedEvent, RawEvent, SourceAdapter } from '../types.js';
import { crawler, type CrawlPayload } from './crawler.js';
import { inRegion, llmExtract, localDate, sha256 } from './extraction.js';
import { opt, safeUrl } from './util.js';

/** One post as the keyword search returns it. Author fields are never requested. */
interface ThreadsPost {
  id: string;
  text?: string | null;
  permalink?: string | null;
  timestamp?: string | null;
}

/** Search terms per region id, from `options.keywords`. */
function keywordsByRegion(source: Source): Record<string, string[]> {
  const k = source.options.keywords;
  if (!k || typeof k !== 'object') return {};
  return Object.fromEntries(
    Object.entries(k as Record<string, unknown>).map(([region, list]) => [
      region,
      Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && !!s) : [],
    ]),
  );
}

/**
 * Queries a week of scheduled runs uses across every region, against the API's 7-day quota.
 * Checked before any request, so a config change cannot quietly burn through the quota.
 */
export function weeklyQueries(source: Source): number {
  if (!source.schedule) return 0;
  const runsPerWeek = Math.ceil((7 * 24 * 3_600_000) / intervalMs(source.schedule));
  const perRun = Object.values(keywordsByRegion(source)).reduce((n, l) => n + l.length, 0);
  return runsPerWeek * perRun;
}

/**
 * Threads keyword search (official API; needs the `threads_keyword_search` permission). Recent
 * public posts matching the region's keywords go through LLM extraction; only event facts and a
 * link to the post are kept, never the author or the post text.
 */
export const threads: SourceAdapter = {
  async fetch(ctx: AdapterContext): Promise<RawEvent[]> {
    const { source, region, http, env, now } = ctx;
    const services = ctx.services;
    if (!services?.extractor) throw new Error('threads needs LLM extraction (ANTHROPIC_API_KEY)');
    const token = env.THREADS_ACCESS_TOKEN;
    if (!token) throw new Error('THREADS_ACCESS_TOKEN is not set');
    const quota = opt(source, 'queriesPer7Days', 'number');
    const planned = weeklyQueries(source);
    if (planned > quota) {
      throw new Error(
        `source "${source.id}": ${planned} queries a week (keywords × runs) exceed the quota of ${quota}`,
      );
    }
    const endpoint = opt(source, 'endpoint', 'string');
    const lookbackH = opt(source, 'postLookbackHours', 'number');
    const since = Math.floor((now.getTime() - lookbackH * 3_600_000) / 1000);

    const posts = new Map<string, ThreadsPost>();
    for (const q of keywordsByRegion(source)[region.id] ?? []) {
      const params = new URLSearchParams({
        q,
        search_type: String(source.options.searchType ?? 'RECENT'),
        fields: 'id,text,permalink,timestamp',
        limit: String(opt(source, 'limit', 'number')),
        since: String(since),
      });
      const body = await http.json<{ data?: ThreadsPost[] }>(`${endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      for (const p of body.data ?? []) if (p.id && p.text?.trim()) posts.set(p.id, p);
    }

    const out: RawEvent[] = [];
    const earliest = ctx.window.from.getTime();
    const latest = ctx.window.to.getTime();
    for (const post of posts.values()) {
      const permalink = safeUrl(post.permalink);
      if (!permalink) continue;
      const postedAt = post.timestamp ? new Date(post.timestamp) : now;
      // Relative dates in a post ("this Saturday") count from the day it was posted.
      const today = localDate(Number.isNaN(postedAt.getTime()) ? now : postedAt, region.timezone);
      const events = await llmExtract(
        services,
        ctx,
        { url: permalink, text: post.text!.slice(0, services.maxInputChars), today },
        true,
      );
      for (const event of events) {
        if (event.online || !inRegion(event, ctx)) continue;
        const start = resolveInstant(event.start, region.timezone)?.at.getTime();
        if (start === undefined || start < earliest || start > latest) continue;
        const id = (await sha256(`${post.id}|${event.start}|${event.title}`)).slice(0, 24);
        out.push({
          sourceId: source.id,
          externalId: id,
          sourceUrl: permalink,
          fetchedAt: now.toISOString(),
          // Facts only: no post text or images; the post itself is the event's link.
          payload: {
            pageUrl: permalink,
            event: { ...event, url: null, imageUrl: null, description: null },
          } satisfies CrawlPayload,
        });
      }
    }
    return out;
  },

  parse(raw: RawEvent, ctx): ParsedEvent | null {
    const parsed = crawler.parse(raw, ctx);
    // The permalink's path (/@user/post/…) is not a category hint.
    return parsed && { ...parsed, categoryLabels: [] };
  },
};
