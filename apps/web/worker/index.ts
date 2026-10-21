/**
 * Cloudflare Worker for /api/* (same origin as the PWA, so no CORS). Everything else is a static
 * file from apps/web/dist, served by Workers Static Assets without running this code (see
 * wrangler.jsonc). Secrets come from the Worker's Variables and Secrets: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUBMITTER_SALT, and optionally ANTHROPIC_API_KEY.
 */
import { createApi, type ApiEnv, type ExecutionCtx } from '@happow/api';

let api: ReturnType<typeof createApi> | null = null;

// Cloudflare's per-data-centre cache: area snapshots are shared by everyone nearby.
const edgeCache = (globalThis as { caches?: { default?: Cache } }).caches?.default;

export default {
  fetch(request: Request, env: ApiEnv, ctx: ExecutionCtx): Promise<Response> {
    // Config parsing and clients are reused across requests in the same isolate.
    api ??= createApi(env, { cache: edgeCache });
    return api(request, ctx);
  },
};
