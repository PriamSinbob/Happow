import { describe, expect, it } from 'vitest';
import { eventGlyph, foldText, loadConfig } from '../src';

const food = loadConfig().categories.find((c) => c.id === 'food')!;
const g = (title: string, venue = '') => eventGlyph(food, [title, venue]);
const each = (glyph: string, titles: string[]) => {
  for (const t of titles) expect(g(t), t).toBe(glyph);
};

describe('event glyphs', () => {
  it('folds case and Polish diacritics, including ł', () => {
    expect(foldText('Kawiarnia ŁĄKA Café')).toBe('kawiarnia laka cafe');
  });

  it('uses the category glyph when no rule matches, and a dot without a category', () => {
    expect(g('Wieczór pierogów', 'Nadodrze')).toBe('utensils');
    expect(eventGlyph(undefined, ['anything'])).toBe('dot');
  });

  it('cafés get the cup, in Polish forms and without diacritics', () => {
    each('cup', [
      'Degustacja · Kawiarnia Pod Kalamburem',
      'Spotkanie w kawiarni',
      'Kawiarenka na rogu',
      'Wpadnij na kawę',
      'Brunch · Café Rozrusznik',
      'Caffe Nero: nowe menu',
      'Espresso bar',
      'Bar kawowy Mleczarnia',
      'Tea room otwarcie',
      'Cukiernia Nowy Świat: tort dnia',
    ]);
  });

  it('pubs, bars and breweries get the beer mug, in Polish case forms', () => {
    each('beer', [
      'Quiz w pubie',
      'Spotkanie przed pubem',
      'Otwarcie baru',
      'Wieczór w barze',
      'Premiera IPA · Browar Stu Mostów',
      'Brewery tour',
      'Brewpub night',
      'Taproom takeover',
      'Multitap: 20 kranów',
      'Festiwal Piw',
      'Ogródek piwny',
      'Craft beer festival',
    ]);
  });

  it('places that serve food keep the utensils, even when "bar" is in the name', () => {
    each('utensils', [
      'Obiad · Bar Mleczny Miś',
      'Obiad w barze mlecznym',
      'Milk bar breakfast',
      'Bar sałatkowy',
      'Sushi Bar',
      'Restaurant & Bar',
      'Restauracja Pod Fredrą',
      'Bistro Przystań',
      'Festiwal food trucków',
      'Kolacja w Piwnicy Świdnickiej',
      'Barszcz i pierogi · Barbara',
      'Gastro Barcelona',
    ]);
  });

  it('the title decides before the venue', () => {
    expect(g('Festiwal food trucków', 'Browar Mieszczański')).toBe('utensils');
    expect(g('Śniadanie', 'Kawiarnia Literatka')).toBe('cup');
    expect(g('Koncert akustyczny', 'Pub Guinness')).toBe('beer');
  });
});
