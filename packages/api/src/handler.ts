import { API_VERSION, CLIENT_HEADER, getRegion, loadConfig, type HappowConfig } from '@happow/core';
import {
  boundFetch,
  CachedGeocoder,
  ClaudeExtractor,
  MemoryCache,
  NominatimGeocoder,
  type Extractor,
  type Geocoder,
} from '@happow/extract';
import { accountRoutes } from './accounts.js';
import { areaRoutes } from './area.js';
import { attendanceRoutes } from './attendance.js';
import { autofillRoutes } from './autofill.js';
import { clientConfig, versionBelow } from './clientConfig.js';
import { contributionRoutes } from './contributions.js';
import { emailSender, type EmailSender } from './email.js';
import { eventRoutes } from './events.js';
import { feedRoutes } from './feeds.js';
import { followRoutes } from './follows.js';
import { ApiError, cached, json, sha256, type Limit, type Need } from './http.js';
import { moderationRoutes } from './moderation.js';
import { organiserRoutes } from './organisers.js';
import { placeEditRoutes } from './placeEdits.js';
import { privateRoutes } from './private.js';
import { reminderRoutes } from './reminders.js';
import { routingRoutes } from './routing.js';
import { savedRoutes } from './saved.js';
import { dispatchDueIngest, type ScheduleEnv } from './schedule.js';
import { submissionRoutes } from './submissions.js';
import { serviceDb } from './supabase.js';

/** Secrets and settings from the host (Worker env, or .env in development). */
export interface ApiEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Salt for hashing device ids and IPs; rotate to forget them. */
  SUBMITTER_SALT?: string;
  ANTHROPIC_API_KEY?: string;
  /** Walking routes for "Going there" (name set in config: navigation.routing.secret). */
  ORS_API_KEY?: string;
}

export interface ApiDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  config?: HappowConfig;
  /** Overrides for tests. */
  geocoder?: Geocoder;
  extractor?: Extractor | null;
  /** Instead of the sender named in config (email.provider); null = email off. */
  email?: EmailSender | null;
}

/** GET endpoints anyone may read from another site (embeds): public data, no account. */
const PUBLIC_READS = new Set(['area', 'places', 'events', 'district-goal', 'config']);

/**
 * The /api fetch handler. This file only builds what the routes share (config, the database
 * client, rate limits, the geocoder and extractor) and sends each request to its module; every
 * endpoint lives in the module named after what it is about.
 */
export function createApi(env: ApiEnv, deps: ApiDeps = {}) {
  const config = deps.config ?? loadConfig();
  const doFetch = boundFetch(deps.fetch);
  const now = deps.now ?? (() => new Date());
  const { extraction, geocoding, ingest } = config.app;
  /** A secret whose name comes from config (push.secret, navigation.routing.secret, …). */
  const secret = (name: string) => {
    const value = (env as Record<string, unknown>)[name];
    return typeof value === 'string' && value ? value : undefined;
  };
  const db = serviceDb(env, doFetch);
  const need: Need = () => {
    if (!db || !env.SUBMITTER_SALT) throw new ApiError(503, 'not_configured');
    return { db, salt: env.SUBMITTER_SALT };
  };
  const geocoder =
    deps.geocoder ??
    new CachedGeocoder(
      new NominatimGeocoder({
        endpoint: geocoding.endpoint,
        userAgent: ingest.userAgent,
        minIntervalMs: geocoding.minIntervalMs,
        fetch: doFetch,
      }),
      db ? db.geocodeCache(geocoding.provider, geocoding.cacheDays) : new MemoryCache(),
    );
  const extractor =
    deps.extractor !== undefined
      ? deps.extractor
      : env.ANTHROPIC_API_KEY
        ? new ClaudeExtractor({
            apiKey: env.ANTHROPIC_API_KEY,
            model: extraction.model,
            effort: extraction.effort,
            maxInputChars: extraction.maxInputChars,
            maxTokens: extraction.maxTokens,
            fetch: doFetch,
          })
        : null;

  const limit: Limit = async (bucket, actor, windowSeconds, max) => {
    const { db } = need();
    const ok = await db.rpc<boolean>('rate_limit_hit', {
      p_bucket: bucket,
      p_actor: actor,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (!ok) throw new ApiError(429, 'rate_limited');
  };
  const clientHash = async (req: Request, salt: string) =>
    sha256(
      `${salt}:ip:${req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'local'}`,
    );

  // Quotas count per calendar month, and the promotion ends, in the default region's time zone.
  const timeZone = getRegion(config).timezone;
  const email =
    deps.email !== undefined
      ? deps.email
      : emailSender(config.app.email, env as Record<string, unknown>, doFetch);
  const pushSecret = secret(config.app.push.secret);

  const accounts = accountRoutes({
    email,
    app: config.app,
    plans: config.plans,
    timeZone,
    need,
    now,
    limit,
    clientHash,
  });
  const { requireUser, optionalUser, planOf } = accounts;
  const contributions = contributionRoutes({ config, timeZone, need, now, limit });
  /** A reward that fails must not undo the approval or the submission it follows. */
  const award = async (submissionId: string, eventId: string | null) => {
    try {
      return await contributions.award(submissionId, eventId);
    } catch (err) {
      console.error(JSON.stringify({ award: submissionId, error: String(err) }));
      return null;
    }
  };
  const organisers = organiserRoutes({
    config,
    need,
    requireUser,
    planOf,
    limit,
    trusted: contributions.trusted,
    now,
    fetch: doFetch,
    pushSecret,
  });

  const { area, places } = areaRoutes({ config, db, now });
  const events = eventRoutes({ config, db });
  const attendance = attendanceRoutes({ config, need, now, limit, userOf: optionalUser });
  const autofill = autofillRoutes({
    config,
    need,
    limit,
    now,
    timeZone,
    clientHash,
    requireUser,
    planOf,
    geocoder,
    extractor,
    fetch: doFetch,
  });
  const feeds = feedRoutes({ config, need, requireUser, limit });
  const follows = followRoutes({
    config,
    env: env as Record<string, string | undefined>,
    need,
    limit,
    clientHash,
    requireUser,
    planOf,
    now,
    fetch: doFetch,
  });
  const moderation = moderationRoutes({ need, requireUser, organisers, award });
  const placeEdits = placeEditRoutes({ config, need, requireUser, limit, now });
  const privateApi = privateRoutes({ config, need, requireUser, limit });
  const reminders = reminderRoutes({ config, need, limit, userOf: optionalUser, pushSecret });
  const walkingRoute = routingRoutes({
    config,
    need,
    limit,
    clientHash,
    routingKey: secret(config.app.navigation.routing.secret),
    fetch: doFetch,
  });
  const saved = savedRoutes({ config, need, requireUser, planOf, limit });
  const submissions = submissionRoutes({
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
  });

  /**
   * GET /api/ingest/status → what the Cron Trigger would start right now, and whether its token
   * is configured. Read-only; reveals source ids only, never the token or run errors.
   */
  async function ingestStatus(): Promise<Response> {
    const t = now();
    const r = await dispatchDueIngest(
      env as ScheduleEnv,
      t,
      { fetch: doFetch, config },
      { dryRun: true },
    );
    return json({ checkedAt: t.toISOString(), ...r });
  }

  /** GET /api/config: the client's config, public and cached like the area snapshot. */
  const configBody = JSON.stringify(clientConfig(config));
  const appConfig = (req: Request) =>
    cached(req, configBody, {
      'cache-control': `public, max-age=${config.app.refresh.longCacheMinutes * 60}`,
    });

  /** 426 for an app build below its platform's minimum; web and unnamed clients pass. */
  function checkClient(req: Request) {
    const [platform, version] = (req.headers.get(CLIENT_HEADER) ?? '').split('/');
    const min =
      platform === 'android' || platform === 'ios' ? config.app.native[platform].minVersion : null;
    if (min && version && versionBelow(version, min))
      throw new ApiError(426, 'client_outdated', undefined, { minVersion: min });
  }

  /** The path under /api as decoded segments: event ids carry ':', which clients percent-encode. */
  function segments(req: Request): string[] {
    try {
      return new URL(req.url).pathname
        .replace(/^\/api\/?/, '')
        .split('/')
        .filter(Boolean)
        .map(decodeURIComponent);
    } catch {
      // A broken escape ("%zz") is the caller's mistake, not ours.
      throw new ApiError(400, 'invalid_input', 'path');
    }
  }

  /** Routes /api/*. Everything else is 404. */
  return async function handle(req: Request): Promise<Response> {
    const res = await route(req);
    // Every answer names the contract it follows.
    const headers = new Headers(res.headers);
    headers.set('x-happow-api', String(API_VERSION));
    // Public reads can be embedded on other sites; they carry no sign-in and no cookies.
    const head = new URL(req.url).pathname.split('/')[2] ?? '';
    if (req.method === 'GET' && PUBLIC_READS.has(head))
      headers.set('access-control-allow-origin', '*');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };

  async function route(req: Request): Promise<Response> {
    try {
      const [head, ...rest] = segments(req);
      // The config is how an outdated app learns it should update, so it is never refused.
      if (head === 'config' && req.method === 'GET' && !rest.length) return await appConfig(req);
      checkClient(req);
      const sub = rest.join('/');
      const { method } = req;
      if (head === 'moderation') return await moderation(req, rest);
      if (head === 'me' && sub === 'contributions' && method === 'GET')
        return json(await contributions.mine((await requireUser(req)).id));
      if (head === 'me' && rest[0] === 'feeds') return await feeds.mine(req, rest.slice(1));
      if (head === 'me' && rest[0] === 'saved') return await saved(req, rest.slice(1));
      if (head === 'me' && rest[0] === 'follows') return await follows.mine(req, rest.slice(1));
      if (head === 'search' && method === 'GET' && !rest.length) return await follows.search(req);
      if (head === 'follows' && method === 'POST' && sub === 'match')
        return await follows.match(req);
      if (head === 'me' && rest.length === 1 && (rest[0] === 'claims' || rest[0] === 'events'))
        return await organisers.mine(req, rest[0]);
      if (head === 'private') return await privateApi.privateEvents(req, rest);
      if (head === 'invitations') return await privateApi.invitations(req, rest);
      if (head === 'contacts') return await privateApi.contacts(req, rest);
      if (head === 'friends') return await privateApi.friends(req, rest);
      if (head === 'events' && method === 'GET' && rest.length === 1)
        return await events.byId(rest[0]!);
      if (head === 'events' && method === 'POST' && sub === 'lookup')
        return await events.lookup(req);
      if (head === 'events' && method === 'GET' && rest.length === 2 && rest[1] === 'credit')
        return await events.credit(rest[0]!);
      if (head === 'district-goal' && method === 'GET' && !rest.length)
        return await events.districtGoal(req);
      if (head === 'events' && rest.length >= 2)
        return await organisers.events(req, rest[0]!, rest.slice(1));
      if (head === 'posts') return await organisers.posts(req, rest);
      if (head === 'claims') return await organisers.claims(req, rest);
      if (head === 'me') return await accounts.me(req, rest);
      if (head === 'auth') return await accounts.auth(req, rest);
      if (head === 'admin' && rest[0] === 'feeds') return await feeds.admin(req, rest.slice(1));
      if (head === 'admin') return await accounts.admin(req, rest);
      if (head === 'push') return await reminders.push(req, rest);
      if (head === 'reminders') return await reminders.reminders(req, rest);
      if (head === 'attendance' || head === 'share') return await attendance.route(req, head, rest);
      if (head === 'area' && method === 'GET' && !rest.length) return await area(req);
      if (head === 'places' && method === 'GET' && !rest.length) return await places(req);
      if (head === 'places' && method === 'POST' && !rest.length) return await placeEdits.add(req);
      if (head === 'places' && method === 'POST' && sub === 'change')
        return await placeEdits.change(req);
      if (head === 'ingest' && method === 'GET' && sub === 'status') return await ingestStatus();
      if (head === 'autofill' && method === 'POST' && sub === 'photo')
        return await autofill.photo(req);
      // What is left is a POST to a single segment.
      if (method !== 'POST' || rest.length) throw new ApiError(404, 'not_found');
      if (head === 'autofill') return await autofill.autofill(req);
      if (head === 'geocode') return await autofill.geocode(req);
      if (head === 'submissions') return await submissions.submit(req);
      if (head === 'reports') return await submissions.report(req);
      if (head === 'thanks') return await contributions.thanks(req);
      if (head === 'counts') return await contributions.counts(req);
      if (head === 'route') return await walkingRoute(req);
      throw new ApiError(404, 'not_found');
    } catch (err) {
      if (err instanceof ApiError)
        return json({ error: err.code, message: err.message, ...err.details }, err.status);
      console.error(err);
      return json({ error: 'server_error' }, 500);
    }
  }
}
