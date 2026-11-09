import { describe, expect, it } from 'vitest';
import { eventsFromJsonLd } from '../src';

const base = {
  '@context': 'https://schema.org',
  name: 'Koncert',
  startDate: '2026-11-20T19:00:00+01:00',
  location: { '@type': 'Place', name: 'Klub', address: 'Wrocław' },
};
const names = (node: object) =>
  eventsFromJsonLd([{ '@type': 'MusicEvent', ...base, ...node }], 'https://example.pl/')[0]!
    .performers;

describe('schema.org performer', () => {
  it('reads a Person, a PerformingGroup and a MusicGroup', () => {
    expect(names({ performer: { '@type': 'Person', name: 'Dawid Podsiadło' } })).toEqual([
      'Dawid Podsiadło',
    ]);
    expect(names({ performer: { '@type': 'PerformingGroup', name: 'Teatr Pieśń Kozła' } })).toEqual(
      ['Teatr Pieśń Kozła'],
    );
    expect(names({ performer: { '@type': 'MusicGroup', name: 'Kult' } })).toEqual(['Kult']);
  });

  it('reads a plain string, an array, and the older plural "performers"', () => {
    expect(names({ performer: 'Mela Koteluk' })).toEqual(['Mela Koteluk']);
    expect(
      names({
        performer: [{ '@type': 'Person', name: 'A B' }, 'C D', { '@type': 'Person' }, 'C D'],
      }),
    ).toEqual(['A B', 'C D']);
    expect(names({ performers: { '@type': 'MusicGroup', name: 'Hey' } })).toEqual(['Hey']);
  });

  it('gives an empty list when none is named, and sub-events inherit the parent’s', () => {
    expect(names({})).toEqual([]);
    const series = eventsFromJsonLd(
      [
        {
          '@type': 'EventSeries',
          ...base,
          performer: { '@type': 'MusicGroup', name: 'Kult' },
          subEvent: [{ startDate: '2026-11-21T19:00:00+01:00' }],
        },
      ],
      'https://example.pl/',
    );
    expect(series.map((e) => e.performers)).toContainEqual(['Kult']);
  });
});
