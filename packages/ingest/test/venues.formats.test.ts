import { describe, expect, it } from 'vitest';
import { readIcal, readTribe, splitLocation, tribeFirstPage } from '../src/venues/formats';
import { fixture } from './helpers';

const window = {
  timeZone: 'Europe/Warsaw',
  from: new Date('2026-10-27T00:00:00Z'),
  to: new Date('2026-12-31T00:00:00Z'),
};
const read = (file: string) =>
  readIcal(fixture(`venues/${file}`), 'https://feed.example/f.ics', window);
const brief = (e: ReturnType<typeof read>[number]) => [e.title, e.start, e.end];

describe('readIcal', () => {
  const club = read('wroclaw-club.ics');

  it('gives one event per date of a repeating event, without removed dates, with edited ones', () => {
    expect(club.filter((e) => e.title.startsWith('Jam session')).map(brief)).toEqual([
      // 20 Oct is before the window; 3 Nov is removed (EXDATE); 10 Nov starts later (RECURRENCE-ID).
      ['Jam session', '2026-10-27T20:00', '2026-10-27T23:00'],
      ['Jam session (later start)', '2026-11-10T21:00', '2026-11-10T23:59'],
      ['Jam session', '2026-11-17T20:00', '2026-11-17T23:00'],
      ['Jam session', '2026-11-24T20:00', '2026-11-24T23:00'],
    ]);
  });

  it('gives UTC times as instants', () => {
    expect(brief(club.find((e) => e.title === 'Warsztaty w UTC')!)).toEqual([
      'Warsztaty w UTC',
      '2026-10-28T17:00:00.000Z',
      '2026-10-28T19:00:00.000Z',
    ]);
  });

  it('splits the location for the geocoder and keeps GEO as the point', () => {
    const jam = club[0]!;
    expect(jam.venueName).toBe('Klub Przykładowy');
    expect(jam.address).toEqual({
      street: 'ul. Przykładowa 5',
      postalCode: '50-001',
      city: 'Wrocław',
      country: null,
    });
    expect(jam.categoryHints).toEqual(['koncerty', 'jazz']);
    expect(jam.url).toBe('https://klub.example/jam');
    expect(club.find((e) => e.title === 'Koncert jesienny')!.point).toEqual({
      lat: 51.1079,
      lng: 17.0385,
    });
  });

  it('reads cancelled, all-day and online events, and skips a broken one', () => {
    expect(club.find((e) => e.title === 'Spotkanie autorskie')!.status).toBe('cancelled');
    // DTEND 9 Nov is exclusive: the fair runs 7–8 Nov.
    expect(brief(club.find((e) => e.title === 'Kiermasz płyt')!)).toEqual([
      'Kiermasz płyt',
      '2026-11-07',
      '2026-11-08',
    ]);
    const online = club.find((e) => e.title === 'Transmisja online')!;
    expect(online.online).toBe(true);
    expect(online.end).toBeNull();
    expect(club.some((e) => e.title === 'Bez daty')).toBe(false);
    expect(club).toHaveLength(9);
  });

  it('converts a feed in another time zone (recorded: The Events Calendar demo)', () => {
    const tec = read('tec-demo.ics');
    expect(brief(tec[0]!)).toEqual([
      'Hosted Dinner with Chef Monica Geller',
      '2026-10-30T22:30:00.000Z',
      '2026-10-31T01:00:00.000Z',
    ]);
    expect(tec[0]!.point).toEqual({ lat: 40.7607184, lng: -73.9613766 });
    // Its virtual events give the event page as the location.
    expect(tec.find((e) => e.title === 'Home Made Cheese Making Class')!.online).toBe(true);
  });

  it('reads all-day events (recorded: Google Calendar export)', () => {
    expect(read('google-holidays.ics').map(brief)).toEqual([
      ['Wszystkich Świętych', '2026-11-01', null],
      ['Dzień Niepodległości', '2026-11-11', null],
      ['Wigilia Bożego Narodzenia', '2026-12-24', null],
    ]);
  });
});

describe('readTribe (recorded: The Events Calendar REST API)', () => {
  const events = readTribe(JSON.parse(fixture('venues/tribe-demo.json')), 'https://t.example/');

  it('reads times in UTC, the venue with its point, prices and categories', () => {
    expect(events).toHaveLength(3);
    const dinner = events[0]!;
    expect(brief(dinner)).toEqual([
      'Hosted Dinner with Chef Monica Geller',
      '2026-10-30T22:30:00Z',
      '2026-10-31T01:00:00Z',
    ]);
    expect(dinner.venueName).toBe('ABC Cooking School Event Center');
    expect(dinner.point).toEqual({ lat: 40.7607184, lng: -73.9613766 });
    expect([dinner.priceMin, dinner.priceMax, dinner.isFree]).toEqual([100, 100, false]);
    expect(dinner.categoryHints).toEqual(['hosted-dinner']);
  });

  it('marks a 0 price free, and a virtual event online with no place', () => {
    const cheese = events[1]!;
    expect(cheese.isFree).toBe(true);
    expect(cheese.online).toBe(true);
    expect(cheese.venueName).toBeNull();
    expect(cheese.point).toBeNull();
  });

  it('asks for upcoming events, 50 a page', () => {
    expect(tribeFirstPage('https://t.example/wp-json/tribe/events/v1/events', window.from)).toBe(
      'https://t.example/wp-json/tribe/events/v1/events?per_page=50&start_date=2026-10-27',
    );
  });
});

describe('splitLocation', () => {
  it('finds the venue, street, postcode and town in any order', () => {
    expect(splitLocation('ul. Ruska 46, Klub Łykend, 50-079 Wrocław')).toEqual({
      venueName: 'Klub Łykend',
      address: { street: 'ul. Ruska 46', postalCode: '50-079', city: 'Wrocław', country: null },
    });
    expect(splitLocation('Hala Stulecia')).toEqual({
      venueName: 'Hala Stulecia',
      address: { street: null, postalCode: null, city: null, country: null },
    });
  });
});
