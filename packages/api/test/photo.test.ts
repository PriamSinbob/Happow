import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent, Extractor, Geocoder } from '@happow/extract';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';

/** POST /api/autofill/photo (M12 slice G): a poster photo read into the add form. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
const now = () => new Date('2026-10-29T10:00:00Z');
const base = loadConfig();
const config = {
  ...base,
  app: { ...base.app, submissions: { ...base.app.submissions, autofill: 'account' as const } },
};
const geocoder: Geocoder = {
  geocode: async () => ({ point: { lat: 51.12, lng: 17.04 }, precision: 'venue', label: 'x' }),
};

type Rpc = Record<string, (args: Record<string, unknown>) => unknown>;
function backend(rpc: Rpc = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const handlers: Rpc = {
    staff_role: () => null,
    grants_active: () => [],
    usage_get: () => ({ events: 0, autofills: 0 }),
    usage_take: () => true,
    rate_limit_hit: () => true,
    ...rpc,
  };
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
      const name = url.slice(`${SB}/rest/v1/rpc/`.length);
      const args = JSON.parse(String(init.body ?? '{}'));
      calls.push({ name, args });
      const h = handlers[name];
      return h ? new Response(JSON.stringify(h(args))) : new Response('{}', { status: 404 });
    }
    if (url === `${SB}/auth/v1/user`) {
      const auth = new Headers(init.headers).get('authorization');
      return auth === 'Bearer user-token'
        ? new Response(JSON.stringify({ id: 'u1', email: 'ala@example.org' }))
        : new Response('{}', { status: 401 });
    }
    return new Response('not found', { status: 404 });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

const poster: ExtractedEvent = {
  title: 'Jazz na podwórku',
  description: null,
  start: '2026-11-07T19:00',
  end: '2026-11-07T21:00',
  venueName: 'Podwórko Nadodrze',
  address: { street: 'Jedności Narodowej 1', postalCode: null, city: 'Wrocław', country: null },
  point: null,
  isFree: true,
  priceMin: null,
  priceMax: null,
  currency: null,
  url: null,
  ticketUrl: null,
  imageUrl: null,
  status: 'scheduled',
  ageMin: null,
  family: null,
  entry: 'fixed',
  online: false,
  categoryHints: [],
  categoryIds: ['music'],
  method: 'llm',
  confidence: 0.85,
};

const reader = (events: ExtractedEvent[] = [poster]) => {
  const extractImage = vi.fn(async () => events);
  const extractor: Extractor = { id: 'fake', extract: async () => [], extractImage };
  return { extractor, extractImage };
};

const JPEG = Buffer.from('fake jpeg bytes').toString('base64');
const send = (
  payload: object,
  headers: Record<string, string> = { authorization: 'Bearer user-token' },
) => {
  const body = JSON.stringify(payload);
  return new Request('https://happow.example/api/autofill/photo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(body.length),
      ...headers,
    },
    body,
  });
};
const photo = { image: JPEG, mediaType: 'image/jpeg' };

describe('POST /api/autofill/photo (M12 slice G)', () => {
  it('reads the poster into prefills and takes one autofill', async () => {
    const web = backend();
    const { extractor, extractImage } = reader();
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor });
    const res = await api(send(photo));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ method: 'llm', url: null });
    expect(data.events).toEqual([
      expect.objectContaining({
        title: 'Jazz na podwórku',
        venueName: 'Podwórko Nadodrze',
        start: '2026-11-07T19:00',
        url: null,
        point: { lat: 51.12, lng: 17.04 },
      }),
    ]);
    expect(extractImage).toHaveBeenCalledWith(
      expect.objectContaining({ data: JPEG, mediaType: 'image/jpeg', today: '2026-10-29' }),
    );
    expect(web.calls.filter((c) => c.name === 'usage_take')).toHaveLength(1);
    expect(web.calls.find((c) => c.args.p_bucket === 'autofill-llm')?.args).toMatchObject({
      p_actor: 'global',
      p_max: config.app.extraction.autofillLlmPerDay,
    });
  });

  it('takes nothing when the photo gives no upcoming event, or reading fails', async () => {
    for (const extractImage of [
      vi.fn(async () => [{ ...poster, start: '2026-01-10T19:00' }]),
      vi.fn(async () => {
        throw new Error('refused');
      }),
    ]) {
      const web = backend();
      const api = createApi(env, {
        config,
        fetch: web.fetch,
        now,
        geocoder,
        extractor: { id: 'fake', extract: async () => [], extractImage },
      });
      expect(await (await api(send(photo))).json()).toMatchObject({ method: 'none', events: [] });
      expect(web.calls.some((c) => c.name === 'usage_take')).toBe(false);
    }
  });

  it("says it's unavailable when today's LLM budget is spent or nothing reads images", async () => {
    const capped = backend({ rate_limit_hit: (a) => a.p_bucket !== 'autofill-llm' });
    const { extractor, extractImage } = reader();
    const api = createApi(env, { config, fetch: capped.fetch, now, geocoder, extractor });
    const res = await api(send(photo));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('photo_unavailable');
    expect(extractImage).not.toHaveBeenCalled();

    const web = backend();
    const textOnly = createApi(env, {
      config,
      fetch: web.fetch,
      now,
      geocoder,
      extractor: { id: 'fake', extract: async () => [] },
    });
    expect((await textOnly(send(photo))).status).toBe(503);
  });

  it('refuses an oversized photo or another file type before any quota or LLM work', async () => {
    const web = backend();
    const { extractor, extractImage } = reader();
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor });
    const big = 'A'.repeat(Math.ceil((config.app.extraction.photo.maxBytes * 4) / 3) + 8);
    const tooBig = await api(send({ image: big, mediaType: 'image/jpeg' }));
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).error).toBe('photo_too_large');
    expect((await api(send({ image: JPEG, mediaType: 'image/gif' }))).status).toBe(400);
    expect((await api(send({ image: 'not base64!', mediaType: 'image/jpeg' }))).status).toBe(400);
    expect(extractImage).not.toHaveBeenCalled();
    expect(web.calls.some((c) => c.name === 'usage_get')).toBe(false);
  });

  it('needs an account, and refuses before reading once the quota is used up', async () => {
    const web = backend();
    const { extractor, extractImage } = reader();
    const api = createApi(env, { config, fetch: web.fetch, now, geocoder, extractor });
    expect((await api(send(photo, {}))).status).toBe(401);

    const max = config.plans.plans.premium['autofill.perMonth'];
    const used = backend({ usage_get: () => ({ events: 0, autofills: max }) });
    const full = createApi(env, { config, fetch: used.fetch, now, geocoder, extractor });
    const res = await full(send(photo));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('quota_exceeded');
    expect(extractImage).not.toHaveBeenCalled();
  });
});
