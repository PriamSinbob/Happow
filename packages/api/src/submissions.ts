import {
  ageMinSchema,
  can,
  entrySchema,
  getRegion,
  isInBbox,
  quota,
  shiftWall,
  splitPerformers,
  usageMonth,
  wallMinutes,
  weeklyStarts,
  type Entitlements,
  type HappowConfig,
  type Region,
} from '@happow/core';
import { checkPublicUrl, resolveInstant } from '@happow/extract';
import { normalize } from '@happow/ingest/normalize';
import { z } from 'zod';
import { quotaExceeded, type User } from './accounts.js';
import {
  ApiError,
  body,
  deviceHash,
  deviceId,
  eventId,
  json,
  latLng,
  type Limit,
  type Need,
} from './http.js';
import { SupabaseError } from './supabase.js';

/**
 * What people send in about events.
 * - POST /api/submissions: an event (or a weekly series, or a private event) from the add form.
 * - POST /api/reports: "cancelled", "wrong", "inappropriate" on an event.
 */

export interface SubmissionDeps {
  config: HappowConfig;
  need: Need;
  limit: Limit;
  now: () => Date;
  /** The default region's time zone: monthly quotas count there. */
  timeZone: string;
  clientHash: (req: Request, salt: string) => Promise<string>;
  /** The signed-in user when the request carries a token, else null. */
  optionalUser: (req: Request) => Promise<User | null>;
  planOf: (user: { id: string }) => Promise<{ entitlements: Entitlements }>;
  contributions: {
    trusted: (userId: string) => Promise<boolean>;
    firstPlace: (submissionId: string) => Promise<boolean>;
  };
  /** The reward for a published event; null when there is none or it failed. */
  award: (submissionId: string, eventId: string | null) => Promise<object | null>;
}

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const submissionSchema = z.object({
  deviceId,
  regionId: z.string().optional(),
  event: z.object({
    title: z.string().trim().min(3).max(140),
    categoryIds: z.array(z.string()).min(1).max(3),
    venueName: z.string().trim().min(2).max(140),
    address: z.string().trim().max(200).optional().default(''),
    point: latLng,
    start: localDateTime,
    end: localDateTime.nullable().optional(),
    isFree: z.boolean(),
    priceMin: z.number().min(0).max(100_000).nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
    url: z.string().url().max(500).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    /** The form offers none / 0+ / 12+ / 16+ / 18+; a prefilled page value may be another age. */
    ageMin: ageMinSchema.nullable().optional(),
    family: z.boolean().nullable().optional(),
    /** Sent only when the user changes it; otherwise the category default applies. */
    entry: entrySchema.nullable().optional(),
    /** "Who's performing": names separated by commas or new lines. */
    performers: z.string().trim().max(1000).nullable().optional(),
  }),
  /** Only invitees see it; needs `private.create`, and it can't repeat. */
  private: z.boolean().optional(),
  /** Weekly on these ISO weekdays (1 = Monday) until a day, inclusive. */
  repeat: z
    .object({
      days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
});

const reportSchema = z.object({
  deviceId,
  eventId,
  reason: z.enum([
    'cancelled',
    'venue_closed',
    'weather',
    'moved',
    'wrong_info',
    'inappropriate',
    'unlawful',
    'other',
  ]),
  note: z.string().trim().max(500).nullable().optional(),
});

export function submissionRoutes({
  config,
  need,
  limit,
  now,
  timeZone,
  clientHash,
  optionalUser,
  planOf,
  contributions,
  award,
}: SubmissionDeps) {
  const { submissions: limits } = config.app;
  const submissionsSource = config.sources.find((s) => s.adapter === 'user-submission');
  const regionFor = (id?: string): Region => getRegion(config, id);

  /** POST /api/submissions → stored for moderation; shown at once as unverified if config says so. */
  async function submit(req: Request): Promise<Response> {
    const { db, salt } = need();
    if (!submissionsSource) throw new ApiError(503, 'not_configured');
    const user = await optionalUser(req);
    if (!user && limits.account === 'required') throw new ApiError(401, 'account_required');
    const input = await body(req, submissionSchema);
    const region = regionFor(input.regionId);
    const e = input.event;
    const known = new Set(config.categories.map((c) => c.id));
    if (!e.categoryIds.every((c) => known.has(c)))
      throw new ApiError(400, 'invalid_input', 'category');
    if (!isInBbox(e.point, region.bbox)) throw new ApiError(400, 'outside_region');
    // A weekly repeat is one event per date, each its own length after its start.
    const { recurring } = limits;
    if (input.repeat && !user) throw new ApiError(401, 'account_required');
    if (input.private && !user) throw new ApiError(401, 'account_required');
    if (input.private && input.repeat) throw new ApiError(400, 'invalid_input', 'repeat');
    const starts = input.repeat
      ? weeklyStarts(e.start, input.repeat, recurring.maxWeeks)
      : [e.start];
    if (!starts.length || starts.length > recurring.maxOccurrences)
      throw new ApiError(400, 'invalid_input', 'repeat');
    const length = e.end ? wallMinutes(e.start, e.end) : null;
    const t = now().getTime();
    const dates = starts.map((wall) => {
      const start = resolveInstant(wall, region.timezone)?.at;
      if (!start || start.getTime() < t - 86_400_000 || start.getTime() > t + 366 * 86_400_000)
        throw new ApiError(400, 'invalid_input', 'start');
      const endWall = length === null ? null : shiftWall(wall, length);
      const end = endWall ? resolveInstant(endWall, region.timezone)?.at : null;
      if (length !== null && (!end || end.getTime() <= start.getTime()))
        throw new ApiError(400, 'invalid_input', 'end');
      return { wall, endWall, start, end: end ?? null };
    });
    if (e.url) {
      try {
        // Same rules as autofill: public http(s) links only.
        checkPublicUrl(e.url);
      } catch {
        throw new ApiError(400, 'unsafe_url');
      }
    }

    const submitter = await deviceHash(salt, input.deviceId);
    // An account has a monthly quota (checked as the event is stored) and an hourly guard;
    // without one, the per-device and per-IP daily caps apply.
    let quotaMax = 0;
    let trusted = false;
    let privateMax = 0;
    if (user) {
      await limit('submit-account', user.id, 3600, limits.perHourPerAccount);
      const { entitlements } = await planOf(user);
      quotaMax = quota(entitlements, 'events.perMonth');
      if (input.private) {
        if (!can(entitlements, 'private.create'))
          throw new ApiError(403, 'forbidden', 'private.create is not in this plan');
        const p = await db.rpc<{ privateBlocked?: boolean }>('profile_get', { p_user: user.id });
        if (p.privateBlocked) throw new ApiError(403, 'forbidden', 'private events are blocked');
        privateMax = quota(entitlements, 'private.perMonth');
      } else {
        trusted = await contributions.trusted(user.id);
        // The verified organiser of a venue here publishes at once.
        if (
          !trusted &&
          can(entitlements, 'organiser.publish') &&
          (await db.rpc<boolean>('organiser_at', {
            p_user: user.id,
            p_lat: e.point.lat,
            p_lng: e.point.lng,
            p_radius_m: config.app.organiser.venueRadiusM,
          }))
        )
          trusted = true;
      }
    } else {
      await limit('submit', submitter, 86_400, limits.maxPerDevicePerDay);
      await limit('submit-ip', await clientHash(req, salt), 86_400, limits.maxPerDevicePerDay * 3);
    }
    const usage = usageMonth(now(), timeZone);

    // A series shares one venue row; every date is its own submission and event.
    const seriesId = input.repeat ? crypto.randomUUID() : null;
    const items = dates.map((d) => {
      const id = crypto.randomUUID();
      const res = normalize(
        {
          externalId: id,
          sourceUrl: e.url ?? null,
          title: e.title,
          description: e.description ?? null,
          startAt: d.start.toISOString(),
          endAt: d.end ? d.end.toISOString() : null,
          categoryLabels: [],
          categoryIds: e.categoryIds,
          venue: {
            externalId: seriesId ?? id,
            name: e.venueName,
            address: e.address || null,
            point: e.point,
            website: null,
          },
          point: e.point,
          isFree: e.isFree,
          priceMin: e.isFree ? 0 : (e.priceMin ?? null),
          priceMax: e.isFree ? 0 : (e.priceMin ?? null),
          currency: e.isFree ? null : (e.currency ?? region.currency),
          rules: {},
          ageMin: e.ageMin ?? null,
          family: e.family ?? null,
          entry: e.entry ?? null,
          officialUrl: e.url ?? null,
          ticketUrl: null,
          imageUrl: null,
          status: 'scheduled',
          performers: splitPerformers(e.performers ?? ''),
        },
        {
          source: submissionsSource,
          region,
          categories: config.categories,
          h3Resolution: config.app.h3.eventResolution,
          densityResolution: config.app.h3.densityResolution,
          descriptionMaxChars: limits.maxDescriptionChars,
          now: now(),
        },
      );
      if (!res.ok) throw new ApiError(400, 'invalid_input', res.reason);
      return {
        id,
        eventId: res.value.event.id,
        // Each date keeps its own form, so "add again" copies the date it was opened from.
        p: {
          id,
          form: { ...e, start: d.wall, end: d.endWall, url: e.url ?? null },
          normalized: res.value,
        },
      };
    });
    // A private event: live at once for its owner, never moderated, no rewards.
    if (input.private && user) {
      const first = items[0]!;
      let eventId: string;
      try {
        eventId = await db.rpc<string>('submit_private', {
          p: first.p,
          p_submitter: submitter,
          p_region: region.id,
          p_user: user.id,
          p_month: usage.month,
          p_max: quotaMax,
          p_private_max: privateMax,
        });
      } catch (err) {
        if (err instanceof SupabaseError && err.code === 'HQ001')
          throw quotaExceeded('events', quotaMax, usage.resetsAt);
        if (err instanceof SupabaseError && err.code === 'HQ002')
          throw quotaExceeded('private', privateMax, usage.resetsAt);
        throw err;
      }
      return json(
        {
          id: first.id,
          eventId,
          status: 'published',
          private: true,
          trusted: false,
          firstPlace: false,
        },
        201,
      );
    }
    const publish = limits.publishBeforeModeration;
    const common = {
      p_submitter: submitter,
      p_region: region.id,
      p_publish: publish,
      p_user: user?.id ?? null,
      p_month: user ? usage.month : null,
      p_max: quotaMax,
      p_trusted: trusted,
    };
    try {
      if (seriesId)
        await db.rpc('submit_series', {
          p_series: seriesId,
          p_items: items.map((i) => i.p),
          ...common,
        });
      else await db.rpc('submit_event', { p: items[0]!.p, ...common });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'HQ001')
        throw quotaExceeded('events', quotaMax, usage.resetsAt);
      throw err;
    }
    // Published by a trusted account: the reward follows at once, as an approval would give it.
    // A series earns as one event, on its first date.
    const first = items[0]!;
    const reward = trusted ? await award(first.id, first.eventId) : null;
    // Nothing at this place lately: "first added by you" on the adder's card.
    const firstPlace = user ? await contributions.firstPlace(first.id) : false;
    const shown = publish || trusted;
    return json(
      {
        id: first.id,
        eventId: shown ? first.eventId : null,
        status: shown ? 'published' : 'pending',
        trusted,
        firstPlace,
        ...(seriesId && {
          seriesId,
          dates: items.map((i) => ({ id: i.id, eventId: shown ? i.eventId : null })),
        }),
        ...(reward && { reward }),
      },
      201,
    );
  }

  /** POST /api/reports → one open report per device per event. */
  async function report(req: Request): Promise<Response> {
    const { db, salt } = need();
    const input = await body(req, reportSchema);
    const reporter = await deviceHash(salt, input.deviceId);
    await limit('report', reporter, 86_400, limits.reportsPerDayPerDevice);
    // A private event can be reported only by someone who may see it.
    if (
      (await db.rpc<string | null>('event_visibility', { p_event: input.eventId })) === 'private'
    ) {
      const user = await optionalUser(req);
      if (
        !user ||
        !(await db.rpc<boolean>('event_visible_to', { p_event: input.eventId, p_user: user.id }))
      )
        throw new ApiError(404, 'unknown_event');
    }
    try {
      await db.rpc('report_event', {
        p_event: input.eventId,
        p_reason: input.reason,
        p_note: input.note ?? null,
        p_reporter: reporter,
      });
    } catch (err) {
      if (err instanceof SupabaseError && err.code === 'P0002')
        throw new ApiError(404, 'unknown_event');
      throw err;
    }
    return json({ ok: true }, 201);
  }

  return { submit, report };
}
