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

/** Hand-off to the device's map app for walking directions. */
export function navigationUrl(lat: number, lng: number): string {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return ios
    ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
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
