import { describe, expect, it, vi } from 'vitest';
import {
  CachedGeocoder,
  checkPublicUrl,
  fetchPage,
  MemoryCache,
  NominatimGeocoder,
  UnsafeUrlError,
  type GeoResult,
} from '../src';

const bbox = { west: 16.807, south: 51.042, east: 17.176, north: 51.211 };

describe('checkPublicUrl', () => {
  it('accepts public http(s) links', () => {
    expect(checkPublicUrl('https://www.ebilet.pl/x').hostname).toBe('www.ebilet.pl');
  });
  it.each([
    'ftp://example.com/x',
    'javascript:alert(1)',
    'http://localhost:3000/',
    'http://127.0.0.1/',
    'http://10.0.0.5/admin',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://intranet/',
    'http://printer.local/',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
  ])('rejects %s', (u) => {
    expect(() => checkPublicUrl(u)).toThrow(UnsafeUrlError);
  });
});

describe('fetchPage', () => {
  it('follows redirects but re-checks every hop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
      );
    await expect(
      fetchPage('https://ok.example/a', { userAgent: 'ua', fetch: fetchMock }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('reads HTML within the size limit and refuses other content types', async () => {
    const big = '<html><body>' + 'x'.repeat(5000) + '</body></html>';
    const ok = vi.fn(
      async () => new Response(big, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );
    const page = await fetchPage('https://ok.example/', {
      userAgent: 'ua',
      fetch: ok,
      maxBytes: 1000,
    });
    expect(page.html.length).toBe(1000);
    expect((ok.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual' });
    const pdf = vi.fn(
      async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    );
    await expect(
      fetchPage('https://ok.example/f.pdf', { userAgent: 'ua', fetch: pdf }),
    ).rejects.toThrow(/not a web page/);
  });
});

describe('NominatimGeocoder', () => {
  const ok = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200 });

  it('tries the street, then the venue, then the postcode, inside the region', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(
        ok([{ lat: '51.1069', lon: '17.0773', display_name: 'Hala Stulecia' }]),
      );
    const sleep = vi.fn(async () => {});
    const g = new NominatimGeocoder({
      endpoint: 'https://nominatim.openstreetmap.org/search',
      userAgent: 'Happow/test',
      minIntervalMs: 1100,
      language: 'pl',
      fetch: fetchMock,
      sleep,
    });
    const r = await g.geocode(
      {
        venueName: 'Hala Stulecia',
        street: 'ul. Wystawowa 1',
        postalCode: '51-618',
        city: 'Wrocław',
        countryCode: 'PL',
      },
      bbox,
    );
    expect(r).toEqual({
      point: { lat: 51.1069, lng: 17.0773 },
      precision: 'venue',
      label: 'Hala Stulecia',
    });
    const first = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(first.searchParams.get('street')).toBe('Wystawowa 1');
    expect(first.searchParams.get('bounded')).toBe('1');
    expect(first.searchParams.get('countrycodes')).toBe('pl');
    expect(first.searchParams.get('viewbox')).toBe('16.807,51.211,17.176,51.042');
    expect(new URL(fetchMock.mock.calls[1]![0] as string).searchParams.get('q')).toBe(
      'Hala Stulecia, 51-618, Wrocław',
    );
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      'User-Agent': 'Happow/test',
    });
    // One request per second: the second call waited.
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('rejects a hit whose postcode differs (same street name in a nearby village)', async () => {
    // Recorded case: "pl. Wolności 1, 50-071" without a city matched Psary's "Wolności 1, 51-180".
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ok([
          {
            lat: '51.1843',
            lon: '17.0291',
            display_name: '1, Wolności, Psary',
            address: { postcode: '51-180' },
          },
        ]),
      )
      .mockResolvedValueOnce(
        ok([
          {
            lat: '51.1070',
            lon: '17.0265',
            display_name: 'Narodowe Forum Muzyki, 1, Plac Wolności, Wrocław',
            address: { postcode: '50-071' },
          },
        ]),
      );
    const g = new NominatimGeocoder({
      endpoint: 'https://n.example',
      userAgent: 'u',
      minIntervalMs: 0,
      fetch: fetchMock,
    });
    const r = await g.geocode(
      {
        venueName: 'Narodowe Forum Muzyki (NFM) Wrocław',
        street: 'pl. Wolności 1',
        postalCode: '50-071',
        city: 'Wrocław',
      },
      bbox,
    );
    expect(r).toMatchObject({ point: { lat: 51.107, lng: 17.0265 }, precision: 'venue' });
    expect(new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get('addressdetails')).toBe(
      '1',
    );
  });

  it('gives up on a city alone (useless for a 500 m radius)', async () => {
    const fetchMock = vi.fn();
    const g = new NominatimGeocoder({
      endpoint: 'https://n.example',
      userAgent: 'u',
      minIntervalMs: 0,
      fetch: fetchMock,
    });
    expect(await g.geocode({ city: 'Wrocław' }, bbox)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches answers, including not-found', async () => {
    const inner = { geocode: vi.fn(async () => null as GeoResult | null) };
    const g = new CachedGeocoder(inner, new MemoryCache());
    const q = { street: 'Rynek 1', city: 'Wrocław' };
    await g.geocode(q, bbox);
    await g.geocode({ street: ' rynek  1 ', city: 'WROCŁAW' }, bbox);
    expect(inner.geocode).toHaveBeenCalledTimes(1);
  });
});
