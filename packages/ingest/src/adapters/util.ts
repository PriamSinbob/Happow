import type { Source } from '@happow/core';

/** A required adapter option from config, with a readable error when it is missing. */
export function opt<T extends 'string' | 'number'>(
  source: Source,
  key: string,
  type: T,
): T extends 'string' ? string : number {
  const v = source.options[key];
  if (typeof v !== type) throw new Error(`source "${source.id}": options.${key} must be a ${type}`);
  return v as T extends 'string' ? string : number;
}

/** http(s) URLs only; anything else (javascript:, relative, garbage) becomes null. */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
