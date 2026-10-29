import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  effectivePlan,
  entitlementsFor,
  getRegion,
  quota,
  rateLimitIntervalMs,
  usageMonth,
  type PlanGrant,
} from '@happow/core';
import { resolveInstant, type ExtractedEvent } from '@happow/extract';
import { sha256 } from './adapters/extraction.js';
import { HttpClient } from './http.js';
import { normalize } from './normalize.js';
import { readIcal } from './venues/formats.js';
import type { JobStats, VenueJob } from './venues/jobs.js';

/**
 * Calendar feeds accounts added (M12 §4.6): each active feed in the region is read once a run and
 * its upcoming events come in as the account's submissions, through `feed_import`, so they count
 * against the month, go to moderation until the feed's first event is approved, and are never
 * imported twice. Robots.txt is not asked: the account owner gave us the address to read.
 */

export interface DueFeed {
  id: number;
  userId: string;
  url: string;
  approved: boolean;
}

/** Postgres for account feeds, on the ingest connection. */
export class FeedStore {
  constructor(private readonly db: pg.ClientBase) {}

  async due(regionId: string): Promise<DueFeed[]> {
    const { rows } = await this.db.query<{ r: DueFeed[] }>('select feeds_due($1) as r', [regionId]);
    return rows[0]!.r;
  }

  async grants(userId: string): Promise<PlanGrant[]> {
    const { rows } = await this.db.query<{ r: PlanGrant[] }>('select grants_active($1) as r', [
      userId,
    ]);
    return rows[0]!.r;
  }

  /** Null when the feed already gave this event (or was stopped meanwhile). */
  async import(args: {
    feed: number;
    key: string;
    payload: object;
    submitter: string;
    publish: boolean;
    month: string;
    max: number;
    trustedAfter: number;
  }): Promise<{ id: string; trusted: boolean } | null> {
    const { rows } = await this.db.query<{ r: { id: string; trusted: boolean } | null }>(
      'select feed_import($1, $2, $3, $4, $5, $6, $7, $8) as r',
      [
        args.feed,
        args.key,
        JSON.stringify(args.payload),
        args.submitter,
        args.publish,
        args.month,
        args.max,
        args.trustedAfter,
      ],
    );
    return rows[0]!.r;
  }

  async record(feed: number, error: string | null, events: number): Promise<void> {
    await this.db.query('select feed_record($1, $2, $3)', [feed, error, events]);
  }
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
/** "2026-11-07T19:00" from an extracted value that may carry seconds or an offset. */
const wall = (v: string) => v.slice(0, 16);

export const accountFeedsJob: VenueJob = async (ctx) => {
  if (!ctx.store) return { skipped: 'dry run: the feeds are in the database' };
  const { config, region, now } = ctx;
  const source = config.sources.find((s) => s.adapter === 'user-submission');
  if (!source) throw new Error('no user-submission source in config');
  const db = ctx.store.feeds();
  const feeds = await db.due(region.id);
  const http = new HttpClient({
    userAgent: config.app.ingest.userAgent,
    minIntervalMs: ctx.source.rateLimit ? rateLimitIntervalMs(ctx.source.rateLimit) : 0,
    retries: 1,
    fetch: ctx.fetch,
    sleep: ctx.sleep,
  });
  const horizonDays = num(ctx.source.options.horizonDays, 60);
  const to = new Date(now.getTime() + horizonDays * 86_400_000);
  // Months and promotions count in the default region, as the API counts them.
  const accountZone = getRegion(config).timezone;
  const usage = usageMonth(now, accountZone);
  const { contributions } = config.plans;
  const stats: JobStats = {
    feeds: feeds.length,
    imported: 0,
    known: 0,
    skipped: 0,
    failed: 0,
    quota: 0,
  };
  const count = (k: string) => (stats[k] = (stats[k] as number) + 1);

  for (const f of feeds) {
    let events: ExtractedEvent[];
    try {
      events = readIcal(await http.text(f.url), f.url, {
        timeZone: region.timezone,
        from: now,
        to,
      });
    } catch (err) {
      await db.record(f.id, (err as Error).message.slice(0, 300), 0);
      count('failed');
      continue;
    }
    const plan = effectivePlan({
      signedIn: true,
      grants: await db.grants(f.userId),
      now,
      earlyAccess: config.plans.earlyAccess,
      timeZone: accountZone,
    });
    const max = quota(entitlementsFor(config.plans, plan.plan), 'events.perMonth');
    const submitter = await sha256(`feed:${f.id}`);
    let imported = 0;
    let error: string | null = null;
    for (const e of events) {
      const start = resolveInstant(e.start, region.timezone)?.at;
      // Upcoming, in person, with a place: the rest isn't an event the map can show.
      if (!start || start < now || e.online) {
        count('skipped');
        continue;
      }
      let point = e.point;
      const street = e.address.street;
      if (!point && (e.venueName || street) && ctx.geocoder) {
        const hit = await ctx.geocoder
          .geocode(
            {
              venueName: e.venueName,
              street,
              postalCode: e.address.postalCode,
              city: e.address.city || region.localities?.[0] || region.name[region.locale],
              countryCode: region.countryCode,
            },
            region.bbox,
          )
          .catch(() => null);
        point = hit?.point ?? null;
      }
      const venueName = (e.venueName ?? street ?? '').trim();
      if (!point || venueName.length < 2) {
        count('skipped');
        continue;
      }
      const end = e.end ? resolveInstant(e.end, region.timezone)?.at : null;
      const id = randomUUID();
      const res = normalize(
        {
          externalId: id,
          sourceUrl: e.url,
          title: e.title,
          description: null,
          startAt: start.toISOString(),
          endAt: end && end > start ? end.toISOString() : null,
          categoryLabels: e.categoryHints.length ? [e.categoryHints] : [],
          venue: {
            externalId: `feed:${f.id}:${venueName}`,
            name: venueName,
            address: street,
            point,
            website: null,
          },
          point,
          isFree: e.isFree,
          priceMin: e.priceMin,
          priceMax: e.priceMax,
          currency: e.currency,
          rules: {},
          ageMin: e.ageMin ?? null,
          family: e.family ?? null,
          entry: e.entry ?? null,
          officialUrl: e.url,
          ticketUrl: e.ticketUrl,
          imageUrl: null,
          status: e.status,
        },
        {
          source,
          region,
          categories: config.categories,
          h3Resolution: config.app.h3.eventResolution,
          densityResolution: config.app.h3.densityResolution,
          descriptionMaxChars: config.app.submissions.maxDescriptionChars,
          now,
        },
      );
      if (!res.ok) {
        count('skipped');
        continue;
      }
      const form = {
        title: res.value.event.title,
        categoryIds: res.value.event.categoryIds,
        venueName,
        address: street ?? '',
        point,
        start: wall(e.start),
        end: e.end ? wall(e.end) : null,
        isFree: e.isFree ?? false,
        priceMin: e.priceMin,
        currency: e.currency,
        url: e.url,
      };
      try {
        const done = await db.import({
          feed: f.id,
          key: (await sha256(`${e.url ?? ''}|${e.start}|${e.title}`)).slice(0, 32),
          payload: { id, form, normalized: res.value },
          submitter,
          publish: config.app.submissions.publishBeforeModeration,
          month: usage.month,
          max,
          trustedAfter: contributions.trustedAfter,
        });
        if (done) {
          imported++;
          count('imported');
        } else count('known');
      } catch (err) {
        // The month's events are used up: the rest waits for the next run (or month).
        if ((err as { code?: string }).code === 'HQ001') {
          error = 'quota';
          count('quota');
          break;
        }
        throw err;
      }
    }
    await db.record(f.id, error, imported);
  }
  return stats;
};
