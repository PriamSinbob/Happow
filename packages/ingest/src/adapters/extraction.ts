import type { ExtractedEvent } from '@happow/extract';
import type { AdapterContext, AdapterServices } from '../types.js';

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const norm = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').toLowerCase().trim();

/**
 * Listings and posts often name other cities. Keep an item when it names no city, or a city
 * the region config lists (`localities`, else the region's own names).
 */
export function inRegion(e: ExtractedEvent, ctx: Pick<AdapterContext, 'region'>): boolean {
  const city = e.address.city;
  if (!city) return true;
  const names = ctx.region.localities ?? Object.values(ctx.region.name);
  return names.some((n) => norm(n) === norm(city));
}

/** Local calendar date (YYYY-MM-DD) of an instant in the region's time zone. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
}

/**
 * LLM extraction of free text, cached by extractor + text so unchanged pages and posts are
 * never sent twice. `today` anchors relative dates ("this Saturday"); it is part of the cache
 * key only with `keyByDate` (posts, where it is the fixed posting date), so an unchanged page
 * is not re-extracted every day.
 */
export async function llmExtract(
  services: AdapterServices,
  ctx: Pick<AdapterContext, 'region'>,
  input: { url: string; text: string; today: string },
  keyByDate = false,
): Promise<ExtractedEvent[]> {
  const extractor = services.extractor;
  if (!extractor) return [];
  const key = await sha256(
    keyByDate ? `${extractor.id}\n${input.today}\n${input.text}` : `${extractor.id}\n${input.text}`,
  );
  const cached = await services.extractionCache.get(key);
  if (cached) return cached;
  const events = await extractor.extract({
    ...input,
    timeZone: ctx.region.timezone,
    categories: services.categories.map((c) => ({
      id: c.id,
      label: c.labels[ctx.region.locale],
    })),
  });
  await services.extractionCache.set(key, events);
  return events;
}
