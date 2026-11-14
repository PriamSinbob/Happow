import { describe, expect, it, vi } from 'vitest';
import type { ExtractedPlace, Extractor } from '@happow/extract';
import { createApi } from '../src';
import { config, env, req, supabase, type Rpc } from './helpers';

/** A place from a photo of its door: the read, and adding or updating with its pass. */

const NOW = new Date('2026-11-14T12:00:00Z');
const DEVICE = 'device-1234';
const JPEG = Buffer.from('fake jpeg bytes').toString('base64');

const door: ExtractedPlace = {
  name: 'Kawiarnia Przykład',
  kind: 'amenity=cafe',
  openingHours: 'Mo-Fr 08:00-20:00; Sa 09:00-22:00',
  street: 'ul. Przykładowa',
  houseNumber: '12',
  website: null,
  boxes: { name: { x: 0.3, y: 0.05, w: 0.4, h: 0.1 }, hours: { x: 0.6, y: 0.3, w: 0.15, h: 0.2 } },
  confidence: 0.9,
};

function setup(read: ExtractedPlace | null = door, rpc: Record<string, Rpc> = {}) {
  const used = new Set<string>();
  const web = supabase({
    // A pass can be used once: its bucket remembers it.
    rate_limit_hit: (a) => {
      if (a.p_bucket !== 'place-pass') return { body: true };
      const fresh = !used.has(a.p_actor as string);
      used.add(a.p_actor as string);
      return { body: fresh };
    },
    place_add: () => ({ body: 'user/1' }),
    place_change: () => ({ status: 204, body: null }),
    ...rpc,
  });
  const extractPlace = vi.fn(async () => read);
  const extractor: Extractor = { id: 'fake', extract: async () => [], extractPlace };
  let now = NOW;
  const api = createApi(env, { config, fetch: web.fetch, now: () => now, extractor });
  return { api, web, extractPlace, later: (min: number) => (now = new Date(+NOW + min * 60_000)) };
}

const photo = { image: JPEG, mediaType: 'image/jpeg', deviceId: DEVICE };
const place = {
  name: 'Kawiarnia Przykład',
  kind: 'amenity=cafe',
  point: { lat: 51.11, lng: 17.03 },
  openingHours: 'Mo-Fr 08:00-20:00; Sa 09:00-22:00',
  address: 'ul. Przykładowa 12',
};

async function read(api: ReturnType<typeof setup>['api']) {
  const res = await api(req('places/photo', { body: photo }));
  return { res, data: await res.json() };
}

describe('POST /api/places/photo', () => {
  it('reads the door into the form with its marks and a pass, without an account', async () => {
    const { api, web, extractPlace } = setup();
    const { res, data } = await read(api);
    expect(res.status).toBe(200);
    expect(data.place).toEqual({
      name: 'Kawiarnia Przykład',
      kind: 'amenity=cafe',
      openingHours: 'Mo-Fr 08:00-20:00; Sa 09:00-22:00',
      address: 'ul. Przykładowa 12',
      website: null,
      marks: door.boxes,
    });
    expect(data.pass).toEqual(expect.any(String));
    expect(extractPlace).toHaveBeenCalledWith(
      expect.objectContaining({
        data: JPEG,
        kinds: expect.arrayContaining([{ id: 'amenity=cafe', label: expect.any(String) }]),
      }),
    );
    const buckets = web.call('rate_limit_hit').map((c) => c.args.p_bucket);
    expect(buckets).toEqual(['place-photo', 'place-photo-net', 'autofill-llm']);
  });

  it('gives no pass when the photo shows no place, and says when reading is off', async () => {
    expect((await read(setup(null).api)).data).toEqual({ place: null, pass: null });
    const capped = setup(door, {
      rate_limit_hit: (a) => ({ body: a.p_bucket !== 'autofill-llm' }),
    });
    const res = await capped.api(req('places/photo', { body: photo }));
    expect(res.status).toBe(503);
    expect(capped.extractPlace).not.toHaveBeenCalled();
  });
});

describe('a place from a photo, without an account', () => {
  it('adds one place with the pass, logged by device, and only once', async () => {
    const { api, web } = setup();
    const { data } = await read(api);
    const body = { ...place, deviceId: DEVICE, photoPass: data.pass };
    const res = await api(req('places', { body }));
    expect(res.status).toBe(201);
    expect(web.call('place_add')[0]!.args).toMatchObject({
      p_user: null,
      p_device: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_name: 'Kawiarnia Przykład',
    });
    const again = await api(req('places', { body }));
    expect(again.status).toBe(401);
    expect((await again.json()).error).toBe('photo_required');
  });

  it('refuses a missing, forged, expired or borrowed pass', async () => {
    const { api, web, later } = setup();
    const { data } = await read(api);
    const [exp, id] = (data.pass as string).split('.');
    for (const extra of [
      {},
      { deviceId: DEVICE },
      { deviceId: DEVICE, photoPass: `${exp}.${id}.${'0'.repeat(32)}` },
      { deviceId: 'another-device', photoPass: data.pass },
    ]) {
      const res = await api(req('places', { body: { ...place, ...extra } }));
      expect((await res.json()).error).toBe('photo_required');
    }
    later(config.app.places.photo.passMinutes + 1);
    const late = await api(
      req('places', { body: { ...place, deviceId: DEVICE, photoPass: data.pass } }),
    );
    expect(late.status).toBe(401);
    expect(web.call('place_add')).toHaveLength(0);
  });

  it('updates the hours of a listed place with the pass, and nothing else', async () => {
    const { api, web } = setup();
    const { data } = await read(api);
    const pass = { deviceId: DEVICE, photoPass: data.pass };
    const closed = await api(
      req('places/change', { body: { id: 'node/1', closed: true, ...pass } }),
    );
    expect(closed.status).toBe(401);
    const res = await api(
      req('places/change', { body: { id: 'node/1', openingHours: 'Mo-Su 10:00-18:00', ...pass } }),
    );
    expect(res.status).toBe(200);
    expect(web.call('place_change')[0]!.args).toMatchObject({
      p_user: null,
      p_place: 'node/1',
      p_hours: 'Mo-Su 10:00-18:00',
      p_device: expect.any(String),
    });
  });
});
