/**
 * Cloudflare Pages Function for /api/* (same origin as the PWA, so no CORS). Secrets come from the
 * Pages project's environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUBMITTER_SALT,
 * and optionally ANTHROPIC_API_KEY.
 */
import { createApi, type ApiEnv } from '@happow/api';

let api: ReturnType<typeof createApi> | null = null;

export const onRequest = (ctx: { request: Request; env: ApiEnv }): Promise<Response> => {
  // Config parsing and clients are reused across requests in the same isolate.
  api ??= createApi(ctx.env);
  return api(ctx.request);
};
