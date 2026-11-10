import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenPlaceCard } from '../src/components/OpenPlaceCard';
import { I18nProvider } from '../src/i18n';
import { loadPlaces, openPlaces, toPlaces, type PlaceRow } from '../src/places';

/** Open places: what shows at a given time, and what its card says. */

const tz = 'Europe/Warsaw';
// Tuesday 10 Nov 2026, local time (CET).
const at = (time: string) => new Date(`2026-11-10T${time}:00+01:00`);
const here = { lat: 51.11, lng: 17.03 };
const row = (id: string, kind: string, hours: string | null, lat = 51.11): PlaceRow => ({
  id,
  name: `Place ${id}`,
  kind,
  lat,
  lng: 17.03,
  address: 'Rynek 1',
  website: null,
  opening_hours: hours,
});
const rows = [
  row('pub', 'amenity=pub', 'Mo-Su 16:00-02:00'),
  row('cafe', 'amenity=cafe', 'Mo-Fr 08:00-18:00', 51.112),
  row('gallery', 'tourism=gallery', 'We-Su 12:00-18:00', 51.113),
  row('always', 'amenity=fast_food', '24/7', 51.114),
  row('nohours', 'amenity=bar', null),
  row('seasonal', 'amenity=biergarten', 'Apr-Oct: Mo-Su 12:00-22:00'),
  row('bank', 'amenity=bank', 'Mo-Fr 09:00-17:00'),
];
const ids = (time: string, filters = {}, events: { lat: number; lng: number }[] = []) =>
  openPlaces(toPlaces(rows), at(time), tz, here, filters, events).map((p) => p.id);

afterEach(cleanup);

describe('open places', () => {
  it('keeps only configured kinds whose hours can be read', () => {
    expect(toPlaces(rows).map((p) => p.id)).toEqual(['pub', 'cafe', 'gallery', 'always']);
  });

  it('shows a place only while it is open, with its closing time', () => {
    expect(ids('10:00')).toEqual(['cafe', 'always']);
    expect(ids('17:00')).toEqual(['pub', 'cafe', 'always']);
    expect(ids('23:30')).toEqual(['pub', 'always']);
    const [pub, always] = openPlaces(toPlaces(rows), at('23:30'), tz, here, {}, []);
    expect(pub!.closesAt).toEqual(new Date('2026-11-11T02:00:00+01:00'));
    expect(always!.closesAt).toBeNull();
    expect(pub!.distanceM).toBe(0);
  });

  it('follows the category filters of its kind', () => {
    expect(ids('17:00', { categories: ['music'] })).toEqual([]);
    expect(ids('17:00', { categories: ['food'] })).toEqual(['pub', 'cafe', 'always']);
    expect(ids('17:00', { excluded: ['food'] })).toEqual([]);
  });

  it('gives way to an event at the same spot', () => {
    expect(ids('17:00', {}, [{ lat: 51.11, lng: 17.0301 }])).toEqual(['cafe', 'always']);
    expect(ids('17:00', {}, [{ lat: 51.2, lng: 17.03 }])).toEqual(['pub', 'cafe', 'always']);
  });
});

describe('the open place card', () => {
  const card = (time: string, id: string) => {
    const place = openPlaces(toPlaces(rows), at(time), tz, here, {}, []).find((p) => p.id === id)!;
    render(
      <I18nProvider initial="en">
        <OpenPlaceCard place={place} now={at(time)} timeZone={tz} onClose={() => {}} />
      </I18nProvider>,
    );
  };

  it('says what it is, until when it is open and how long that leaves', () => {
    card('23:30', 'pub');
    expect(screen.getByRole('heading', { name: 'Place pub' })).toBeTruthy();
    expect(screen.getByText('Pub')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText(/until 2:00/)).toBeTruthy();
    expect(screen.getByText('closes in 2 h 30 min')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Google Maps/ })).toBeTruthy();
  });

  it('marks a closing within the hour, and a place that never closes', () => {
    card('17:20', 'cafe');
    expect(screen.getByText('closes in 40 min').className).toContain('is-soon');
    cleanup();
    card('04:00', 'always');
    expect(screen.getByText('around the clock')).toBeTruthy();
  });
});

describe('loading places', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('asks past the caches when the answer is empty, and does not keep an empty one', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://db.example');
    const answers: PlaceRow[][] = [[], [], [], rows];
    const inits: (RequestInit | undefined)[] = [];
    const doFetch = async (_url: string, init?: RequestInit) => {
      inits.push(init);
      return new Response(JSON.stringify({ places: answers.shift() }));
    };
    // Before the first import: empty both times.
    expect(await loadPlaces(here, doFetch)).toEqual([]);
    expect(inits).toEqual([undefined, { cache: 'reload' }]);
    // The next look asks again: a kept empty copy first, then the fresh answer.
    const places = await loadPlaces(here, doFetch);
    expect(places.length).toBeGreaterThan(0);
    expect(inits).toHaveLength(4);
    // A full answer is kept.
    await loadPlaces(here, doFetch);
    expect(inits).toHaveLength(4);
  });
});
