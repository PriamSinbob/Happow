/**
 * Cloudflare Worker for /api/* (same origin as the PWA, so no CORS). Everything else is a static
 * file from apps/web/dist, served by Workers Static Assets without running this code, and
 * cacheable API responses (area snapshots) are served by Workers Caching in front of it (see
 * wrangler.jsonc). Secrets come from the Worker's Variables and Secrets: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUBMITTER_SALT, optionally ANTHROPIC_API_KEY, and GITHUB_DISPATCH_TOKEN
 * for the ingest schedule.
 *
 * The Cron Trigger (`triggers.crons` in wrangler.jsonc) starts the GitHub ingest workflow when a
 * source is due (packages/api/src/schedule.ts, docs/SETUP.md), and on Mondays it saves the week's
 * M12 metrics row (packages/api/src/metrics.ts).
 */
import {
  createApi,
  dispatchDueIngest,
  saveWeeklyMetrics,
  type ApiEnv,
  type ScheduleEnv,
} from '@happow/api';

/** The parts of Cloudflare's ScheduledController this Worker reads. */
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

let api: ReturnType<typeof createApi> | null = null;

export default {
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    // Config parsing and clients are reused across requests in the same isolate.
    api ??= createApi(env);
    return api(request);
  },

  async scheduled(controller: ScheduledController, env: ApiEnv & ScheduleEnv): Promise<void> {
    const now = new Date(controller.scheduledTime);
    // Independent jobs: one failing must not stop the other.
    const [ingest, metrics] = await Promise.allSettled([
      dispatchDueIngest(env, now),
      saveWeeklyMetrics(env, now),
    ]);
    const out = (r: PromiseSettledResult<object>) =>
      r.status === 'fulfilled' ? r.value : { error: String(r.reason) };
    // One line per tick in Observability → Logs: what was due and what happened.
    console.log(JSON.stringify({ cron: controller.cron, ...out(ingest), metrics: out(metrics) }));
  },
};
