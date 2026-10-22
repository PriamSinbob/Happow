import type { HappowConfig } from '@happow/core';
import { dispatchLookbackMs, dueForDispatch, type RunRecord } from '@happow/ingest/schedule';
import appJson from '../../../config/app.json';
import regionsJson from '../../../config/regions.json';
import sourcesJson from '../../../config/sources.json';

/**
 * Cloudflare Cron Trigger → GitHub ingest workflow. The Worker reads the latest `source_runs`
 * and starts the workflow (workflow_dispatch) only when some source is due, so a 15-minute cron
 * costs CI minutes only for runs that fetch something. The workflow then applies the same
 * schedule rules itself and fetches only the due sources.
 */

export interface ScheduleEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Any other Worker secret, including the dispatch token named in config. */
  [secret: string]: unknown;
}

export interface ScheduleDeps {
  fetch?: typeof fetch;
  config?: HappowConfig;
}

export interface DispatchResult {
  due: string[];
  dispatched: boolean;
  /** Whether the dispatch token secret is present (its value is never returned). */
  tokenSet: boolean;
  /** Why nothing was dispatched, when that was not simply "nothing due". */
  reason?: string;
}

interface RunRow {
  source_id: string;
  region_id: string;
  started_at: string;
  status: RunRecord['status'];
}

type ScheduleConfig = Pick<HappowConfig, 'regions' | 'sources'>;

/**
 * Regions and sources straight from the JSON, without schema parsing: a Cron Trigger on the
 * Workers Free plan gets 10 ms of CPU, and parsing every config file in a cold isolate takes
 * longer than that. The same files are validated by `loadConfig` on every API request and in CI,
 * and a test checks that both readings plan the same runs.
 */
export function scheduleConfig(): ScheduleConfig {
  return {
    regions: regionsJson.regions,
    sources: sourcesJson.sources,
  } as unknown as ScheduleConfig;
}

export async function dispatchDueIngest(
  env: ScheduleEnv,
  now: Date,
  deps: ScheduleDeps = {},
  /** Work out what is due without starting anything (the status endpoint). */
  opts: { dryRun?: boolean } = {},
): Promise<DispatchResult> {
  const config = deps.config ?? scheduleConfig();
  const doFetch = deps.fetch ?? fetch;
  const { dispatch, userAgent } = (deps.config?.app ?? appJson).ingest;
  const token = env[dispatch.tokenSecret];
  const tokenSet = typeof token === 'string' && token.length > 0;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    return {
      due: [],
      dispatched: false,
      tokenSet,
      reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set',
    };

  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const since = new Date(now.getTime() - dispatchLookbackMs(config, dispatch)).toISOString();
  const query = new URLSearchParams({
    select: 'source_id,region_id,started_at,status',
    started_at: `gte.${since}`,
    order: 'started_at.desc',
    limit: '2000',
  });
  const res = await doFetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/source_runs?${query}`, {
    headers: {
      apikey: key,
      // Legacy keys are JWTs and also go in Authorization; new sb_secret_ keys go in apikey only.
      ...(key.startsWith('eyJ') && { Authorization: `Bearer ${key}` }),
    },
  });
  if (!res.ok) throw new Error(`source_runs read failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as RunRow[];
  const runs: RunRecord[] = rows.map((r) => ({
    sourceId: r.source_id,
    regionId: r.region_id,
    startedAt: new Date(r.started_at),
    status: r.status,
  }));

  const due = dueForDispatch(config, runs, now, dispatch);
  if (!due.length) return { due, dispatched: false, tokenSet };
  if (!tokenSet)
    return { due, dispatched: false, tokenSet, reason: `${dispatch.tokenSecret} not set` };
  if (opts.dryRun) return { due, dispatched: false, tokenSet, reason: 'dry run' };

  const gh = await doFetch(
    `https://api.github.com/repos/${dispatch.repo}/actions/workflows/${dispatch.workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': userAgent,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: dispatch.ref }),
    },
  );
  if (gh.status !== 204)
    throw new Error(`workflow dispatch failed: ${gh.status} ${await gh.text()}`);
  return { due, dispatched: true, tokenSet };
}
