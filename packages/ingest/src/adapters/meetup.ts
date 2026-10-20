import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { coveringCircle } from '../geo.js';
import type { AdapterContext, ParsedEvent, RawEvent, SourceAdapter } from '../types.js';
import { opt, safeUrl, toNumber } from './util.js';

const QUERY = readFileSync(new URL('./meetup.graphql', import.meta.url), 'utf8');
const METRES_PER_MILE = 1609.344;

interface MuVenue {
  id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  lng?: number | string | null;
}

interface MuEvent {
  id: string;
  title?: string | null;
  eventUrl?: string | null;
  description?: string | null;
  dateTime?: string | null;
  endTime?: string | null;
  duration?: string | null;
  eventType?: string | null;
  isOnline?: boolean | null;
  status?: string | null;
  venues?: MuVenue[] | null;
  venue?: MuVenue | null;
  feeSettings?: { amount?: number | null; currency?: string | null } | null;
  featuredEventPhoto?: { id?: string | null; baseUrl?: string | null } | null;
  group?: {
    name?: string | null;
    topicCategory?: { name?: string | null } | null;
    category?: { name?: string | null } | null;
  } | null;
}

interface MuResponse {
  data?: {
    eventSearch?: {
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      edges?: { node?: MuEvent | null }[];
    } | null;
  } | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

/** Signed RS256 assertion for Meetup's JWT bearer flow. */
export function meetupAssertion(env: AdapterContext['env'], now: Date): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ kid: env.MEETUP_SIGNING_KEY_ID, typ: 'JWT', alg: 'RS256' });
  const claims = b64({
    sub: env.MEETUP_MEMBER_ID,
    iss: env.MEETUP_CLIENT_KEY,
    aud: 'api.meetup.com',
    exp: Math.floor(now.getTime() / 1000) + 120,
  });
  // GitHub Secrets and .env files often hold the PEM with literal "\n".
  const key = (env.MEETUP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const sig = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key, 'base64url');
  return `${header}.${claims}.${sig}`;
}

async function accessToken(ctx: AdapterContext): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: meetupAssertion(ctx.env, ctx.now),
  });
  const res = await ctx.http.json<{ access_token?: string }>(
    opt(ctx.source, 'tokenEndpoint', 'string'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.access_token) throw new Error('Meetup token response had no access_token');
  return res.access_token;
}

export const meetup: SourceAdapter = {
  async fetch(ctx: AdapterContext): Promise<RawEvent[]> {
    const { source, region, window, http } = ctx;
    const endpoint = opt(source, 'endpoint', 'string');
    const first = opt(source, 'pageSize', 'number');
    const maxPages = opt(source, 'maxPages', 'number');
    const token = await accessToken(ctx);
    const { center, radiusM } = coveringCircle(region);
    const filter = {
      query: '',
      lat: center.lat,
      lon: center.lng,
      radius: Math.ceil(radiusM / METRES_PER_MILE),
      startDateRange: window.from.toISOString(),
      endDateRange: window.to.toISOString(),
      ...((source.options.filter as Record<string, unknown> | undefined) ?? {}),
    };

    const out: RawEvent[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const res: MuResponse = await http.json<MuResponse>(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { filter, first, after } }),
      });
      const search = res.data?.eventSearch;
      if (!search) {
        const msg = res.errors?.map((e) => e.extensions?.code ?? e.message).join('; ');
        throw new Error(`Meetup eventSearch failed: ${msg ?? 'no data'}`);
      }
      const fetchedAt = ctx.now.toISOString();
      for (const edge of search.edges ?? []) {
        const n = edge.node;
        if (!n?.id) continue;
        out.push({
          sourceId: source.id,
          externalId: n.id,
          sourceUrl: safeUrl(n.eventUrl),
          fetchedAt,
          payload: n,
        });
      }
      after = search.pageInfo?.endCursor ?? null;
      if (!search.pageInfo?.hasNextPage || !after) break;
    }
    return out;
  },

  parse(raw: RawEvent): ParsedEvent | null {
    const e = raw.payload as MuEvent;
    const type = (e.eventType ?? '').toLowerCase().replace(/[_-]/g, '');
    if (type === 'online' || (e.isOnline && !type)) return null;
    if (!e.dateTime) return null;
    const start = new Date(e.dateTime);
    if (Number.isNaN(start.getTime())) return null;

    let end: Date | null = e.endTime ? new Date(e.endTime) : null;
    if (!end || Number.isNaN(end.getTime())) {
      const ms = isoDurationMs(e.duration);
      end = ms ? new Date(start.getTime() + ms) : null;
    }

    const v = e.venues?.[0] ?? e.venue ?? null;
    const lat = toNumber(v?.lat);
    const lng = toNumber(v?.lon ?? v?.lng);
    const point = lat !== null && lng !== null && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
    // Meetup uses a placeholder venue named "Online event" for virtual meetups.
    const venueName = v?.name?.trim();
    const venue =
      venueName && !/^online event$/i.test(venueName)
        ? {
            externalId: v?.id ?? null,
            name: venueName,
            address:
              [v?.address, [v?.postalCode, v?.city].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(', ') || null,
            point,
            website: null,
          }
        : null;

    const fee = e.feeSettings;
    const paid = typeof fee?.amount === 'number' && fee.amount > 0;
    const photo = e.featuredEventPhoto;
    const status = (e.status ?? '').toLowerCase();

    return {
      externalId: e.id,
      sourceUrl: safeUrl(e.eventUrl),
      title: e.title ?? '',
      description: e.description ?? null,
      startAt: start.toISOString(),
      endAt: end ? end.toISOString() : null,
      categoryLabels: [
        [e.group?.topicCategory?.name, e.group?.category?.name].filter((l): l is string => !!l),
      ],
      venue,
      point,
      isFree: !paid,
      priceMin: paid ? fee!.amount! : 0,
      priceMax: paid ? fee!.amount! : 0,
      currency: fee?.currency ? fee.currency.toUpperCase() : null,
      rules: {},
      officialUrl: safeUrl(e.eventUrl),
      ticketUrl: null,
      imageUrl:
        photo?.baseUrl && photo.id ? safeUrl(`${photo.baseUrl}${photo.id}/676x380.webp`) : null,
      status: status === 'cancelled' ? 'cancelled' : 'scheduled',
    };
  },
};

/** "PT2H30M" → ms; null for zero or unparseable. */
export function isoDurationMs(d: string | null | undefined): number | null {
  const m = d && /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d);
  if (!m) return null;
  const ms =
    ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60_000 + +(m[4] ?? 0) * 1000;
  return ms > 0 ? ms : null;
}
