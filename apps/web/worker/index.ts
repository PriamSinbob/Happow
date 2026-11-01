/**
 * Cloudflare Worker for /api/* (same origin as the PWA, so no CORS) and for shared event links
 * /e/<id>, which get the app's index.html with that event's preview tags (M9 §1). Everything else is a static
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
  createEventPage,
  dispatchDueIngest,
  eventIdFromPath,
  saveWeeklyMetrics,
  type ApiEnv,
  type ScheduleEnv,
} from '@happow/api';
import { loadConfig, type ThemeConfig } from '@happow/core';
// Bundled by wrangler: the .wasm as a compiled module, the fonts as bytes (`rules` in wrangler.jsonc).
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import interRegular from './fonts/Inter_400Regular.ttf';
import interBold from './fonts/Inter_700Bold.ttf';
import { previewSvg, renderPng } from './preview';

/** The parts of Cloudflare's ScheduledController this Worker reads. */
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

/** The static files (Workers Static Assets binding, `assets.binding` in wrangler.jsonc). */
interface AssetsEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

let api: ReturnType<typeof createApi> | null = null;
let eventPage: ReturnType<typeof createEventPage> | null = null;
const fonts = [new Uint8Array(interRegular), new Uint8Array(interBold)];
let theme: ThemeConfig | null = null;

/**
 * GET /e/<id>/preview.png: the event's 1200×630 preview image (M9 §2). Its URL carries a version
 * of what's drawn, so a long edge cache is safe: an edited event links to a new image.
 */
async function previewImage(pages: NonNullable<typeof eventPage>, id: string): Promise<Response> {
  try {
    const data = await pages.preview(id);
    if (!data)
      return new Response(null, {
        status: 404,
        headers: { 'cache-control': 'public, max-age=60' },
      });
    const png = await renderPng(previewSvg(data, (theme ??= loadConfig().theme)), resvgWasm, fonts);
    return new Response(png as Uint8Array<ArrayBuffer>, {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' },
    });
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

export default {
  async fetch(request: Request, env: ApiEnv & AssetsEnv): Promise<Response> {
    // Config parsing and clients are reused across requests in the same isolate.
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/e/')) {
      eventPage ??= createEventPage(env);
      const id = eventIdFromPath(pathname);
      if (id && /^\/e\/[^/]+\/preview\.png$/.test(pathname)) return previewImage(eventPage, id);
      const index = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
      return eventPage.page(request, await index.text());
    }
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
