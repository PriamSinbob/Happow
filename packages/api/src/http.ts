import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
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
