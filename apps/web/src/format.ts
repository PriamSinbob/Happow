import type { Language } from '@happow/core';

export function formatDistance(m: number, lang: Language): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}

export function formatTime(iso: string, timeZone: string, lang: Language): string {
  return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

export function formatPrice(amount: number, currency: string | null, lang: Language): string {
  if (!currency) return new Intl.NumberFormat(lang).format(amount);
  return new Intl.NumberFormat(lang, {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/** Walking directions in Google Maps (its app when installed, the website otherwise). */
export function navigationUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

/** "Sat, 24 Oct" / "sob., 24 paź" in the event's timezone. */
export function formatDay(iso: string, timeZone: string, lang: Language): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(iso));
}

/**
 * "today" / "tomorrow" / "yesterday" ("dzisiaj" / "jutro" / "wczoraj") within a day of `now`,
 * else the short date, all counted in the event's timezone, so 01:00 is not mistaken for tonight.
 */
export function formatRelativeDay(
  iso: string,
  now: Date,
  timeZone: string,
  lang: Language,
): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  const days = Math.round(
    (Date.parse(f.format(new Date(iso))) - Date.parse(f.format(now))) / 86_400_000,
  );
  if (Math.abs(days) > 1) return formatDay(iso, timeZone, lang);
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(days, 'day');
}

export function isSameDay(a: string | Date, b: string | Date, timeZone: string): boolean {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  return f.format(new Date(a)) === f.format(new Date(b));
}

/** "5 min ago" / "5 min temu"; `justNow` under a minute. */
export function formatAgo(iso: string, now: Date, lang: Language, justNow: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  const min = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (Math.abs(min) < 1) return justNow;
  if (Math.abs(min) < 60) return rtf.format(min, 'minute');
  const h = Math.round(min / 60);
  if (Math.abs(h) < 48) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}
