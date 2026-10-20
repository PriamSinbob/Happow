import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { pl } from '../src/i18n/pl';
import { translate } from '../src/i18n';
import { config } from '../src/config';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('has the same keys and placeholders in every language', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(pl[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('applies Polish plural rules', () => {
    const c = (n: number) => translate('pl', 'summary.count', { count: n, radius: '500 m' });
    expect(c(1)).toBe('1 wydarzenie w promieniu 500 m');
    expect(c(3)).toBe('3 wydarzenia w promieniu 500 m');
    expect(c(5)).toBe('5 wydarzeń w promieniu 500 m');
    expect(c(22)).toBe('22 wydarzenia w promieniu 500 m');
    expect(translate('en', 'summary.count', { count: 1, radius: '1 km' })).toBe(
      '1 event within 1 km',
    );
  });

  it('has labels for every category in every configured language', () => {
    for (const c of config.categories)
      for (const l of config.app.languages) expect(c.labels[l]).toBeTruthy();
  });
});
