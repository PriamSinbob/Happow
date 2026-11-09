import type { EventFilters, HappowEvent, PriceFilter, TimeWindow } from './types.js';
import { dayBounds, daysBounds } from './time.js';

/**
 * Same rules as the `events_near` SQL function, for the offline repository and tests, plus the
 * excluded categories, which only the phone applies (the SQL functions don't know them).
 */
export function matchesFilters(
  event: Pick<HappowEvent, 'categoryIds' | 'isFree'>,
  filters: Partial<EventFilters>,
): boolean {
  const cats = filters.categories ?? [];
  if (cats.length && !event.categoryIds.some((c) => cats.includes(c))) return false;
  // Hidden only when every category it has is hidden: an event spanning kinds stays visible.
  const out = filters.excluded ?? [];
  const hidden = event.categoryIds.length > 0 && event.categoryIds.every((c) => out.includes(c));
  if (out.length && hidden) return false;
  if (filters.price === 'free' && !event.isFree) return false;
  if (filters.price === 'paid' && event.isFree) return false;
  return true;
}

/**
 * The [from, to] range a time-window chip stands for. Events overlapping it are shown, so
 * "now" (zero hours) means start ≤ now ≤ end.
 */
export function windowRange(
  window: TimeWindow,
  now: Date,
  timeZone: string,
): { from: Date; to: Date } {
  if ('endOfDay' in window) return { from: now, to: dayBounds(now, timeZone).end };
  if ('days' in window) return { from: now, to: daysBounds(now, timeZone, window.days).end };
  return { from: now, to: new Date(now.getTime() + window.hours * 3_600_000) };
}

/** The two price toggles in settings: free and paid, both on = any. */
export function priceToggles(price: PriceFilter): { free: boolean; paid: boolean } {
  return { free: price !== 'paid', paid: price !== 'free' };
}

/** Back from the toggles; null when both are off, which the sheet does not allow. */
export function priceFromToggles(free: boolean, paid: boolean): PriceFilter | null {
  if (free && paid) return 'any';
  if (free) return 'free';
  if (paid) return 'paid';
  return null;
}

/** "5/s" → minimum milliseconds between requests. */
export function rateLimitIntervalMs(rate: string): number {
  const m = /^(\d+)\/(s|m|h)$/.exec(rate);
  if (!m) throw new Error(`bad rate limit "${rate}"`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000 }[m[2] as 's' | 'm' | 'h'];
  return Math.ceil(unit / Number(m[1]));
}

/** "30m" / "2h" → milliseconds. */
export function intervalMs(interval: string): number {
  const m = /^(\d+)(m|h)$/.exec(interval);
  if (!m) throw new Error(`bad interval "${interval}"`);
  return Number(m[1]) * (m[2] === 'h' ? 3_600_000 : 60_000);
}
