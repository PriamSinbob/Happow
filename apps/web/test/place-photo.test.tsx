import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountProvider } from '../src/account';
import { AddPlace } from '../src/components/AddPlace';
import { I18nProvider } from '../src/i18n';
import { gpsFromJpeg } from '../src/photo';
import { listedNear, toPlaces, type PlaceRow } from '../src/places';

/** A place from one photo of its door, without an account. */

// The pin map needs WebGL and shrinking needs a canvas; jsdom has neither.
vi.mock('../src/components/PinMap', () => ({ PinMap: () => <div /> }));
vi.mock('../src/photo', async (actual) => ({
  ...(await actual<typeof import('../src/photo')>()),
  shrinkPhoto: vi.fn(async () => ({ data: 'SMALLJPEG', mediaType: 'image/jpeg' })),
}));

const here = { lat: 51.11, lng: 17.03 };
const row = (over: Partial<PlaceRow> = {}): PlaceRow => ({
  id: 'node/7',
  name: 'Kawiarnia Przykład',
  kind: 'amenity=cafe',
  lat: 51.11005,
  lng: 17.03,
  address: null,
  website: null,
  opening_hours: 'Mo-Su 09:00-17:00',
  ...over,
});
const read = {
  place: {
    name: 'Kawiarnia Przykład',
    kind: 'amenity=cafe',
    openingHours: 'Mo-Fr 08:00-20:00; Sa 09:00-22:00',
    address: 'ul. Przykładowa 12',
    website: null,
    marks: {
      name: { x: 0.3, y: 0.05, w: 0.4, h: 0.1 },
      hours: { x: 0.6, y: 0.3, w: 0.15, h: 0.2 },
    },
  },
  pass: 'PASS',
};

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
function serve(listed: PlaceRow[] = []) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/places/photo') return ok(read);
    if (url === '/api/places') return ok({ id: 'user/1' }, 201);
    if (url === '/api/places/change') return ok({ ok: true });
    if (url.startsWith('/api/places?')) return ok({ places: listed });
    return ok({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const sent = (path: string) => {
  const [, init] = fetchMock.mock.calls.find(([u]) => u === path)! as [string, RequestInit];
  return { body: JSON.parse(String(init.body)), headers: new Headers(init.headers) };
};

function open() {
  render(
    <I18nProvider initial="en">
      <AccountProvider>
        <AddPlace here={here} onClose={vi.fn()} onShow={vi.fn()} />
      </AccountProvider>
    </I18nProvider>,
  );
}
async function pickPhoto() {
  const input = screen
    .getByText('Photo of the door')
    .parentElement!.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'door.jpg')] } });
  await screen.findByText('from your location');
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.test');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('a place from a photo, without an account', () => {
  it('starts from the photo, fills the form with numbered marks, and adds with the pass', async () => {
    serve();
    open();
    expect(screen.queryByLabelText(/Name/)).toBeNull();
    await pickPhoto();
    expect(sent('/api/places/photo').body).toMatchObject({
      image: 'SMALLJPEG',
      deviceId: expect.any(String),
    });
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('Kawiarnia Przykład');
    expect(screen.getByRole('radio', { name: /Café/ }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText(/Address/) as HTMLInputElement).value).toBe('ul. Przykładowa 12');
    // Name is mark 1 and the hours mark 2, on the photo and before each label.
    expect(screen.getAllByText('1')).toHaveLength(2);
    expect(screen.getAllByText('2')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add the place' }));
    await screen.findByText(/The place (is|will show) on the map/);
    const { body, headers } = sent('/api/places');
    expect(body).toMatchObject({
      name: 'Kawiarnia Przykład',
      kind: 'amenity=cafe',
      point: here,
      openingHours: 'Mo-Fr 08:00-20:00; Sa 09:00-22:00',
      photoPass: 'PASS',
      deviceId: expect.any(String),
    });
    expect(headers.has('authorization')).toBe(false);
  });

  it('updates the hours of the place already listed at the spot, or adds another', async () => {
    serve([row()]);
    open();
    await pickPhoto();
    fireEvent.click(await screen.findByRole('button', { name: 'Update the hours' }));
    await screen.findByText('Thanks! The hours are updated.');
    expect(sent('/api/places/change').body).toMatchObject({
      id: 'node/7',
      openingHours: 'Mo-Fr 08:00-20:00; Sa 09:00-22:00',
      photoPass: 'PASS',
    });
  });
});

describe('the place listed at the spot', () => {
  const places = toPlaces([
    row(),
    row({ id: 'node/8', name: 'Pub Obok', kind: 'amenity=pub', lng: 17.0302 }),
    row({ id: 'node/9', name: 'Daleko', lat: 51.112 }),
  ]);
  it('matches a name either way round, accents aside, within the distance', () => {
    expect(listedNear(places, here, 'KAWIARNIA PRZYKLAD', null)?.id).toBe('node/7');
    expect(listedNear(places, here, 'Przykład', null)?.id).toBe('node/7');
    expect(listedNear(places, here, 'Daleko', null)).toBeNull();
    expect(listedNear(places, here, 'Bistro Nowe', 'amenity=cafe')).toBeNull();
  });
  it('takes the only one of that kind when no name was read', () => {
    expect(listedNear(places, here, '', 'amenity=pub')?.id).toBe('node/8');
    expect(listedNear(places, here, '', 'amenity=bar')).toBeNull();
  });
});

describe('where a photo was taken', () => {
  /** A JPEG with just an EXIF block holding these GPS tags (big-endian TIFF). */
  function jpeg(lat: number[], latRef: string, lng: number[], lngRef: string) {
    const b = new DataView(new ArrayBuffer(200));
    let o = 0;
    const u8 = (v: number) => b.setUint8(o++, v);
    const u16 = (...vs: number[]) => {
      for (const v of vs) b.setUint16((o += 2) - 2, v);
    };
    const u32 = (...vs: number[]) => {
      for (const v of vs) b.setUint32((o += 4) - 4, v);
    };
    u16(0xffd8);
    u16(0xffe1);
    u16(180);
    for (const c of 'Exif\0\0') u8(c.charCodeAt(0));
    const t = o;
    u16(0x4d4d, 42);
    u32(8);
    // IFD0: one entry, the GPS IFD pointer.
    u16(1, 0x8825, 4);
    u32(1, 26, 0);
    // GPS IFD at 26: four entries; the rationals follow at 80.
    o = t + 26;
    u16(4);
    const entry = (tag: number, type: number, count: number, value: number | string) => {
      u16(tag, type);
      u32(count);
      if (typeof value === 'string') {
        u8(value.charCodeAt(0));
        u8(0);
        u16(0);
      } else u32(value);
    };
    entry(1, 2, 2, latRef);
    entry(2, 5, 3, 80);
    entry(3, 2, 2, lngRef);
    entry(4, 5, 3, 104);
    u32(0);
    o = t + 80;
    for (const n of [...lat, ...lng]) u32(n, 1);
    return b;
  }
  it('reads degrees, minutes and seconds with their hemisphere', () => {
    const p = gpsFromJpeg(jpeg([51, 6, 36], 'N', [17, 1, 48], 'E'))!;
    expect(p.lat).toBeCloseTo(51.11);
    expect(p.lng).toBeCloseTo(17.03);
    expect(gpsFromJpeg(jpeg([33, 0, 0], 'S', [70, 30, 0], 'W'))).toEqual({ lat: -33, lng: -70.5 });
  });
  it('gives nothing for a file that is not a JPEG with a position', () => {
    expect(gpsFromJpeg(new DataView(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer))).toBeNull();
    expect(gpsFromJpeg(jpeg([0, 0, 0], 'N', [0, 0, 0], 'E'))).toBeNull();
  });
});
