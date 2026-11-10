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
