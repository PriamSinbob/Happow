/**
 * Cloudflare Worker for /api/* (same origin as the PWA, so no CORS). Everything else is a static
 * file from apps/web/dist, served by Workers Static Assets without running this code, and
 * cacheable API responses (area snapshots) are served by Workers Caching in front of it (see
 * wrangler.jsonc). Secrets come from the Worker's Variables and Secrets: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUBMITTER_SALT, and optionally ANTHROPIC_API_KEY.
 */
import { createApi, type ApiEnv } from '@happow/api';

let api: ReturnType<typeof createApi> | null = null;

export default {
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    // Config parsing and clients are reused across requests in the same isolate.
    api ??= createApi(env);
    return api(request);
  },
};
