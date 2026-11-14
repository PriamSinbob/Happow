import type { ApiErrorCode } from '@happow/core';
import { z } from 'zod';
import type { Supabase } from './supabase.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message?: string,
    /** Extra fields for the error body. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'invalid_input', parsed.error.issues[0]?.message);
  return parsed.data;
}

/** Throws 503 when Supabase or the salt are not configured. */
export type Need = () => { db: Supabase; salt: string };

/** Counts one hit in a rate-limit bucket; throws 429 past `max` per window. */
export type Limit = (
  bucket: string,
  actor: string,
  windowSeconds: number,
  max: number,
) => Promise<void>;

/** The random id a device makes for itself (apps/web `deviceId()`); only its salted hash is kept. */
export const deviceId = z.string().min(8).max(100);
/** An event id: "source:external id". */
export const eventId = z.string().min(1).max(300);
export const uuid = z.string().uuid();
export const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** A device as the database knows it: hashed with the salt, so rotating the salt forgets them. */
export const deviceHash = (salt: string, id: string) => sha256(`${salt}:device:${id}`);

/** Headers for an answer about one account: never kept by a shared cache. */
export const noStore = { 'cache-control': 'private, no-store' };

/** A public JSON answer with an ETag of its content; a revalidation that still matches gets a 304. */
export async function cached(
  req: Request,
  body: string,
  cache: Record<string, string>,
): Promise<Response> {
  const etag = `"${(await sha256(body)).slice(0, 16)}"`;
  const headers = { 'content-type': 'application/json', etag, ...cache };
  if (req.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}

async function hmac(salt: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * A short-lived pass the server hands out and checks later without storing it: "<expires>.<id>.<sig>",
 * signed with the salt for one purpose and one holder (a device hash or an account id).
 */
export async function issuePass(
  salt: string,
  purpose: string,
  holder: string,
  expiresAt: Date,
): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${exp}.${id}.${await hmac(salt, `${purpose}:${holder}:${exp}:${id}`)}`;
}

/** The pass's id when it is genuine, for this purpose and holder, and not expired; else null. */
export async function checkPass(
  salt: string,
  purpose: string,
  holder: string,
  pass: string,
  now: Date,
): Promise<string | null> {
  const m = /^(\d{1,12})\.([0-9a-f]{16})\.([0-9a-f]{32})$/.exec(pass);
  if (!m) return null;
  const [, exp, id, sig] = m;
  if (Number(exp) * 1000 <= now.getTime()) return null;
  return (await hmac(salt, `${purpose}:${holder}:${exp}:${id}`)) === sig ? id! : null;
}
