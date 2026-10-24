import { storage } from './storage';

/** Error codes the /api endpoints return (see packages/api). */
export type ApiErrorCode =
  | 'invalid_input'
  | 'invalid_json'
  | 'unsafe_url'
  | 'page_unavailable'
  | 'outside_region'
  | 'rate_limited'
  | 'not_configured'
  | 'unauthorized'
  | 'forbidden'
  | 'unknown_event'
  | 'already_reviewed'
  | 'not_found'
  | 'quota_exceeded'
  | 'account_required'
  | 'auth_failed'
  | 'server_error'
  | 'network';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
  }
}

/** Calls the same-origin API (Cloudflare Pages Function in production, Vite middleware in dev). */
export async function api<T>(
  path: string,
  options: {
    body?: unknown;
    token?: string | null;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(options.body !== undefined && { 'content-type': 'application/json' }),
        ...(options.token && { authorization: `Bearer ${options.token}` }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: ApiErrorCode };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'server_error');
  return data as T;
}

/** A random id for this device, so the server can rate-limit and moderate without accounts. */
export function deviceId(): string {
  let id = storage.get('device');
  if (!id) {
    id = crypto.randomUUID();
    storage.set('device', id);
  }
  return id;
}
