import appJson from '../../../config/app.json';
import regionsJson from '../../../config/regions.json';
import type { ScheduleEnv } from './schedule.js';
import { Supabase } from './supabase.js';

/**
 * Cloudflare Cron Trigger → the week's M12 metrics row (docs/milestones/M12-more-events.md §1).
 * From `metrics.weekly` (ISO weekday and hour, in the default region's time zone) to the end of
 * that day, every tick calls `metrics_save`, which saves once and is a cheap no-op after. Read
 * straight from the JSON, like the ingest schedule: a cron tick gets 10 ms of CPU.
 */

export interface MetricsSaveResult {
  region: string;
  due: boolean;
  saved?: boolean;
  reason?: string;
}

export interface MetricsDeps {
  fetch?: typeof fetch;
  app?: Pick<typeof appJson, 'defaultRegion' | 'metrics'>;
  regions?: { id: string; timezone: string }[];
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** ISO weekday (1 = Monday) and hour of `at` on the wall clock of `timeZone`. */
export function localWeekdayHour(at: Date, timeZone: string): { weekday: number; hour: number } {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    });
    formats.set(timeZone, f);
  }
  const parts = f.formatToParts(at);
  const day = parts.find((p) => p.type === 'weekday')!.value;
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  return { weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day) + 1, hour };
}

export async function saveWeeklyMetrics(
  env: ScheduleEnv,
  now: Date,
  deps: MetricsDeps = {},
): Promise<MetricsSaveResult> {
  const app = deps.app ?? appJson;
  const regions = deps.regions ?? regionsJson.regions;
  const region = regions.find((r) => r.id === app.defaultRegion);
  if (!region) return { region: app.defaultRegion, due: false, reason: 'unknown region' };
  const { weekday, hour } = localWeekdayHour(now, region.timezone);
  const due = weekday === app.metrics.weekly.weekday && hour >= app.metrics.weekly.hour;
  if (!due) return { region: region.id, due };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    return {
      region: region.id,
      due,
      reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set',
    };
  const db = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, deps.fetch);
  const saved = await db.rpc<boolean>('metrics_save', {
    p_region: region.id,
    p_at: now.toISOString(),
    p_evening_hour: app.metrics.eveningFromHour,
  });
  return { region: region.id, due, saved };
}
