import ICAL from 'ical.js';
import { decodeEntities, type ExtractedEvent } from '@happow/extract';

/**
 * Readers for the event formats venue sites publish (M12 §2.2): iCalendar feeds and The Events
 * Calendar's REST API. Both become ExtractedEvent, the crawler's page format, so the crawler's
 * parse step places and times them the same way as JSON-LD from a page.
 */

export interface ReadWindow {
  /** The region's time zone: times without a known zone are local there. */
  timeZone: string;
  from: Date;
  to: Date;
}

function blank(title: string, start: string, pageUrl: string): ExtractedEvent {
  return {
    title,
    description: null,
    start,
    end: null,
    venueName: null,
    address: { street: null, postalCode: null, city: null, country: null },
    point: null,
    isFree: null,
    priceMin: null,
    priceMax: null,
    currency: null,
    url: pageUrl,
    ticketUrl: null,
    imageUrl: null,
    status: 'scheduled',
    ageMin: null,
    family: null,
    entry: null,
    online: false,
    categoryHints: [],
    categoryIds: [],
    method: 'jsonld',
    confidence: 0.9,
  };
}

const POSTAL = /^(\d{2}-\d{3}|\d{4,5})\s+(.+)$/;

/**
 * "Klub Firlej, ul. Grabiszyńska 56, 53-503 Wrocław" → venue, street, postcode and city, for the
 * geocoder. A part with a postcode is the town; the first part without digits is the venue name;
 * the first part with a number is the street.
 */
export function splitLocation(
  text: string,
): Pick<ExtractedEvent, 'venueName'> & { address: ExtractedEvent['address'] } {
  const parts = text
    .split(/\s*[,\n]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  let venueName: string | null = null;
  let street: string | null = null;
  let postalCode: string | null = null;
  let city: string | null = null;
  for (const p of parts) {
    const town = POSTAL.exec(p);
    if (town) [postalCode, city] = [town[1]!, town[2]!];
    else if (/\d/.test(p) && !street) street = p;
    else if (!venueName && !/^(polska|poland)$/i.test(p)) venueName = p;
  }
  return { venueName, address: { street, postalCode, city, country: null } };
}

/** An ICAL.Time as the crawler's time string: a date, a UTC instant, or local wall time. */
function timeString(t: ICAL.Time, timeZone: string): string {
  if (t.isDate) return t.toString().slice(0, 10);
  const tzid = t.zone?.tzid;
  if (tzid === 'UTC' || tzid === 'Z') return t.toJSDate().toISOString();
  // Floating times, the region's own zone, and zones the feed did not define are wall time in
  // the region (resolveInstant applies its DST rules).
  if (!tzid || tzid === 'floating' || tzid === timeZone || !ICAL.TimezoneService.has(tzid))
    return t.toString().slice(0, 16);
  return new Date(t.toUnixTime() * 1000).toISOString();
}

/** "2026-10-25" → "2026-10-24". */
function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}

/** Occurrences of one series beyond this are not read (a daily event for years). */
const MAX_OCCURRENCES = 500;

/**
 * Every event in an iCalendar feed that overlaps the window, one per occurrence: a repeating
 * event gives one event per date (never merged; time-first), without removed dates (EXDATE) and
 * with edited dates (RECURRENCE-ID) as edited.
 */
export function readIcal(text: string, pageUrl: string, w: ReadWindow): ExtractedEvent[] {
  const cal = new ICAL.Component(ICAL.parse(text));
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    const tzid = tz.getFirstPropertyValue('tzid');
    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid))
      ICAL.TimezoneService.register(tz);
  }
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  for (const c of cal.getAllSubcomponents('vevent')) {
    if (c.hasProperty('recurrence-id')) exceptions.push(c);
    else masters.set(String(c.getFirstPropertyValue('uid') ?? masters.size), new ICAL.Event(c));
  }
  for (const c of exceptions) {
    const master = masters.get(String(c.getFirstPropertyValue('uid')));
    if (master) master.relateException(c);
  }

  const out: ExtractedEvent[] = [];
  const from = w.from.getTime();
  const to = w.to.getTime();
  const add = (item: ICAL.Event, start: ICAL.Time | null, end: ICAL.Time | null) => {
    if (!start) return;
    const s = timeString(start, w.timeZone);
    let e = end ? timeString(end, w.timeZone) : null;
    // All-day DTEND is exclusive: the event runs through the day before.
    if (start.isDate && e) {
      e = previousDate(e);
      if (e <= s) e = null;
    }
    // No DTEND or DURATION: ical.js ends it at its start; the category default applies instead.
    if (e === s) e = null;
    const startMs = start.isDate ? Date.parse(`${s}T23:59:59Z`) : start.toJSDate().getTime();
    const endMs = end ? end.toJSDate().getTime() : startMs;
    if (endMs < from || startMs > to) return;
    const title = (item.summary ?? '').trim();
    if (!title) return;
    const comp = item.component;
    const url = comp.getFirstPropertyValue('url');
    const geo = comp.getFirstPropertyValue('geo');
    const status = String(comp.getFirstPropertyValue('status') ?? '').toUpperCase();
    const categories = comp
      .getAllProperties('categories')
      .flatMap((p) => p.getValues().map((v) => String(v).toLowerCase()));
    const ev = blank(title, s, typeof url === 'string' && /^https?:/.test(url) ? url : pageUrl);
    ev.end = e;
    // A link as the location is an online event (The Events Calendar writes the event page).
    if (item.location && /^https?:\/\//i.test(item.location.trim())) ev.online = true;
    else if (item.location) Object.assign(ev, splitLocation(item.location));
    if (Array.isArray(geo) && geo.length === 2) {
      const [lat, lng] = geo.map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) ev.point = { lat: lat!, lng: lng! };
    }
    ev.status = status === 'CANCELLED' ? 'cancelled' : 'scheduled';
    ev.categoryHints = categories;
    out.push(ev);
  };

  for (const ev of masters.values()) {
    // One broken event (no start, a bad rule) must not lose the rest of the feed.
    try {
      if (!ev.isRecurring()) {
        add(ev, ev.startDate, ev.endDate);
        continue;
      }
      const it = ev.iterator();
      for (let n = 0, next = it.next(); next && n < MAX_OCCURRENCES; n++, next = it.next()) {
        if (next.toJSDate().getTime() > to) break;
        const d = ev.getOccurrenceDetails(next);
        add(d.item, d.startDate, d.endDate);
      }
    } catch {
      continue;
    }
  }
  return out;
}

interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  zip?: string;
  geo_lat?: number | string;
  geo_lng?: number | string;
}

interface TribeEvent {
  id: number;
  url?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  utc_start_date?: string;
  utc_end_date?: string;
  all_day?: boolean;
  /** Virtual Events add-on: an online event (its venue is empty). */
  is_virtual?: boolean;
  cost_details?: { currency_code?: string; values?: (string | number)[] };
  categories?: { slug?: string; name?: string }[];
  venue?: TribeVenue | unknown[];
}

export interface TribePage {
  events?: TribeEvent[];
  next_rest_url?: string;
}

const utc = (s: string | undefined) => (s ? `${s.replace(' ', 'T')}Z` : null);

/** One page of The Events Calendar's REST API (`/wp-json/tribe/events/v1/events`). */
export function readTribe(page: TribePage, pageUrl: string): ExtractedEvent[] {
  const out: ExtractedEvent[] = [];
  for (const t of page.events ?? []) {
    const title = decodeEntities(t.title ?? '').trim();
    const start = t.all_day ? t.start_date?.slice(0, 10) : utc(t.utc_start_date);
    if (!title || !start) continue;
    const ev = blank(title, start, t.url ?? pageUrl);
    ev.end = t.all_day ? (t.end_date?.slice(0, 10) ?? null) : utc(t.utc_end_date);
    if (ev.end === ev.start) ev.end = null;
    ev.online = t.is_virtual === true;
    const v = Array.isArray(t.venue) ? null : (t.venue ?? null);
    if (v) {
      ev.venueName = v.venue ? decodeEntities(v.venue) : null;
      ev.address = {
        street: v.address || null,
        postalCode: v.zip || null,
        city: v.city || null,
        country: null,
      };
      const lat = Number(v.geo_lat);
      const lng = Number(v.geo_lng);
      if (v.geo_lat && v.geo_lng && Number.isFinite(lat) && Number.isFinite(lng))
        ev.point = { lat, lng };
    }
    const prices = (t.cost_details?.values ?? []).map(Number).filter((n) => Number.isFinite(n));
    if (prices.length) {
      ev.priceMin = Math.min(...prices);
      ev.priceMax = Math.max(...prices);
      ev.isFree = ev.priceMax === 0;
      ev.currency = t.cost_details?.currency_code || null;
    }
    ev.categoryHints = (t.categories ?? []).flatMap((c) => (c.slug ? [c.slug] : []));
    out.push(ev);
  }
  return out;
}

/** The API's first page for upcoming events, from the endpoint the website check found. */
export function tribeFirstPage(endpoint: string, from: Date): string {
  const u = new URL(endpoint);
  u.searchParams.set('per_page', '50');
  u.searchParams.set('start_date', from.toISOString().slice(0, 10));
  return u.toString();
}
