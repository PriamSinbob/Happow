import { localToInstant } from '@happow/core';
import { coveringCircle, geohash } from '../geo.js';
import type { AdapterContext, ParsedEvent, RawEvent, SourceAdapter } from '../types.js';
import { opt, safeUrl, toNumber } from './util.js';

/** Fields of a Discovery API v2 event that we read. Everything is optional: the API omits freely. */
interface TmEvent {
  id: string;
  name?: string;
  url?: string;
  info?: string;
  description?: string;
  pleaseNote?: string;
  dates?: {
    start?: {
      dateTime?: string;
      localDate?: string;
      localTime?: string;
      dateTBA?: boolean;
      timeTBA?: boolean;
      noSpecificTime?: boolean;
    };
    end?: { dateTime?: string; localDate?: string; localTime?: string };
    status?: { code?: string };
  };
  classifications?: {
    primary?: boolean;
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }[];
  priceRanges?: { type?: string; min?: number; max?: number; currency?: string }[];
  images?: { url: string; ratio?: string; width?: number }[];
  ageRestrictions?: { legalAgeEnforced?: boolean };
  accessibility?: { info?: string };
  _embedded?: {
    venues?: {
      id?: string;
      name?: string;
      url?: string;
      postalCode?: string;
      address?: { line1?: string };
      city?: { name?: string };
      location?: { latitude?: string; longitude?: string };
    }[];
  };
}

interface TmPage {
  _embedded?: { events?: TmEvent[] };
  page?: { size: number; totalElements: number; totalPages: number; number: number };
}

/** Discovery API refuses pages beyond the first 1,000 results (size × page). */
const DEEP_PAGING_LIMIT = 1000;

/** The API wants "2026-10-20T14:00:00Z", without milliseconds. */
const tmDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export const ticketmaster: SourceAdapter = {
  async fetch(ctx: AdapterContext): Promise<RawEvent[]> {
    const { source, region, window, http, env } = ctx;
    const apiKey = env.TICKETMASTER_API_KEY;
    if (!apiKey) throw new Error('TICKETMASTER_API_KEY is not set');
    const endpoint = opt(source, 'endpoint', 'string');
    const size = opt(source, 'pageSize', 'number');
    const maxPages = opt(source, 'maxPages', 'number');
    const { center, radiusM } = coveringCircle(region);

    const out: RawEvent[] = [];
    for (let page = 0; page < maxPages && (page + 1) * size <= DEEP_PAGING_LIMIT; page++) {
      const params = new URLSearchParams({
        apikey: apiKey,
        geoPoint: geohash(center, 9),
        radius: String(Math.ceil(radiusM / 1000)),
        unit: 'km',
        startDateTime: tmDate(window.from),
        endDateTime: tmDate(window.to),
        size: String(size),
        page: String(page),
        sort: 'date,asc',
      });
      const locale = source.options.locale;
      if (typeof locale === 'string') params.set('locale', locale);
      if (region.countryCode) params.set('countryCode', region.countryCode);

      const body = await http.json<TmPage>(`${endpoint}?${params}`);
      const fetchedAt = ctx.now.toISOString();
      for (const e of body._embedded?.events ?? [])
        out.push({
          sourceId: source.id,
          externalId: e.id,
          sourceUrl: safeUrl(e.url),
          fetchedAt,
          payload: e,
        });
      const totalPages = body.page?.totalPages ?? 0;
      if (page + 1 >= totalPages) break;
    }
    return out;
  },

  parse(raw: RawEvent, { region }): ParsedEvent | null {
    const e = raw.payload as TmEvent;
    const tz = region.timezone;
    const start = e.dates?.start;
    if (!start || start.dateTBA) return null;

    let startAt: Date | null = null;
    let endAt: Date | null = null;
    if (start.dateTime && !start.timeTBA) startAt = new Date(start.dateTime);
    else if (start.localDate && start.localTime && !start.timeTBA)
      startAt = localToInstant(start.localDate, start.localTime, tz);
    else if (start.localDate && (start.noSpecificTime || start.timeTBA)) {
      // Day-long listing (exhibitions, fairs): the whole local day.
      startAt = localToInstant(start.localDate, null, tz);
      endAt = localToInstant(nextDay(start.localDate), null, tz);
    }
    if (!startAt || Number.isNaN(startAt.getTime())) return null;

    const end = e.dates?.end;
    if (end?.dateTime) endAt = new Date(end.dateTime);
    else if (end?.localDate) endAt = localToInstant(end.localDate, end.localTime ?? '23:59', tz);

    const classes = [...(e.classifications ?? [])].sort(
      (a, b) => Number(b.primary ?? false) - Number(a.primary ?? false),
    );
    const categoryLabels = classes.map((c) =>
      [c.subGenre?.name, c.genre?.name, c.segment?.name].filter(
        (l): l is string => !!l && l.toLowerCase() !== 'undefined',
      ),
    );

    const v = e._embedded?.venues?.[0];
    const lat = toNumber(v?.location?.latitude);
    const lng = toNumber(v?.location?.longitude);
    const point = lat !== null && lng !== null && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
    const venue = v?.name
      ? {
          externalId: v.id ?? null,
          name: v.name,
          address:
            [v.address?.line1, [v.postalCode, v.city?.name].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(', ') || null,
          point,
          website: safeUrl(v.url),
        }
      : null;

    // "standard including fees" repeats the base price with fees; prefer plain standard ranges.
    const ranges = (e.priceRanges ?? []).filter((p) => typeof p.min === 'number');
    const standard = ranges.filter((p) => p.type === 'standard');
    const prices = standard.length ? standard : ranges;
    const priceMin = prices.length ? Math.min(...prices.map((p) => p.min!)) : null;
    const priceMax = prices.length ? Math.max(...prices.map((p) => p.max ?? p.min!)) : null;
    const status = e.dates?.status?.code?.toLowerCase();
    const accessibility = e.accessibility?.info?.trim();

    return {
      externalId: e.id,
      sourceUrl: safeUrl(e.url),
      title: e.name ?? '',
      description: e.info ?? e.description ?? e.pleaseNote ?? null,
      startAt: startAt.toISOString(),
      endAt: endAt && !Number.isNaN(endAt.getTime()) ? endAt.toISOString() : null,
      categoryLabels,
      venue,
      point,
      isFree: priceMax === 0 ? true : null,
      priceMin,
      priceMax,
      currency: prices[0]?.currency?.toUpperCase() ?? null,
      rules: {
        ...(e.ageRestrictions?.legalAgeEnforced ? { age: '18+' } : {}),
        ...(accessibility && accessibility.length <= 160 ? { accessibility } : {}),
      },
      officialUrl: null,
      ticketUrl: safeUrl(e.url),
      imageUrl: pickImage(e.images),
      status:
        status === 'cancelled' ? 'cancelled' : status === 'postponed' ? 'postponed' : 'scheduled',
    };
  },
};

/** A 16:9 image around 640 px wide: sharp on phones without pulling the 2048 px original. */
function pickImage(images: TmEvent['images']): string | null {
  const ok = (images ?? []).filter((i) => safeUrl(i.url));
  const wide = ok.filter((i) => i.ratio === '16_9');
  const pool = wide.length ? wide : ok;
  const sorted = [...pool].sort(
    (a, b) => Math.abs((a.width ?? 0) - 640) - Math.abs((b.width ?? 0) - 640),
  );
  return sorted[0]?.url ?? null;
}

/** "2026-10-31" → "2026-11-01". */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}
