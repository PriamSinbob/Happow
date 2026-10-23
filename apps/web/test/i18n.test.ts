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
    const c = (n: number) => translate('pl', 'counter.label', { count: n }).split('.')[0];
    expect(c(0)).toBe('Nic teraz nie trwa');
    expect(c(1)).toBe('1 wydarzenie trwa teraz');
    expect(c(3)).toBe('3 wydarzenia trwają teraz');
    expect(c(5)).toBe('5 wydarzeń trwa teraz');
    expect(c(22)).toBe('22 wydarzenia trwają teraz');
    expect(translate('en', 'counter.label', { count: 1 }).split('.')[0]).toBe('1 event on now');
  });

  it('has labels for every category in every configured language', () => {
    for (const c of config.categories)
      for (const l of config.app.languages) expect(c.labels[l]).toBeTruthy();
  });
});
