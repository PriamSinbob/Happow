import { describe, expect, it } from 'vitest';
import { eventGlyph, foldText, loadConfig } from '../src';

const food = loadConfig().categories.find((c) => c.id === 'food')!;
const g = (text: string) => eventGlyph(food, text);

describe('event glyphs', () => {
  it('folds case and Polish diacritics, including ł', () => {
    expect(foldText('Kawiarnia ŁĄKA Café')).toBe('kawiarnia laka cafe');
  });

  it('uses the category glyph when no rule matches', () => {
    expect(g('Wieczór pierogów · Nadodrze')).toBe('utensils');
    expect(eventGlyph(undefined, 'anything')).toBe('dot');
  });

  it('picks a cup for cafés, in Polish forms and without diacritics', () => {
    expect(g('Degustacja · Kawiarnia Pod Kalamburem')).toBe('cup');
    expect(g('Spotkanie w kawiarni')).toBe('cup');
    expect(g('Brunch · Café Rozrusznik')).toBe('cup');
    expect(g('Cukiernia Nowy Świat: tort dnia')).toBe('cup');
  });

  it('picks a beer mug for pubs, bars and breweries', () => {
    expect(g('Quiz w pubie')).toBe('beer');
    expect(g('Premiera IPA · Browar Stu Mostów')).toBe('beer');
    expect(g('Wieczór w barze')).toBe('beer');
    expect(g('Craft beer festival')).toBe('beer');
  });

  it('matches whole words, so "bar" is not found inside other words', () => {
    expect(g('Barszcz i pierogi · Barbara')).toBe('utensils');
    expect(g('Gastro Barcelona')).toBe('utensils');
  });

  it('keeps the narrow rule ahead of the broad one: a milk bar serves food', () => {
    expect(g('Obiad · Bar Mleczny Miś')).toBe('utensils');
  });
});
