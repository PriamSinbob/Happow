import { describe, expect, it } from 'vitest';
import { mergePerformers, normName, splitPerformers } from '../src';

describe('normName (M7 §1)', () => {
  it('lowercases, drops Polish diacritics (ł too) and collapses whitespace', () => {
    expect(normName('  Dawid   Podsiadło ')).toBe('dawid podsiadlo');
    expect(normName('ŁÓDŹ Żółć Ęą Ńś')).toBe('lodz zolc ea ns');
    expect(normName('Podsiadło')).toBe(normName('podsiadlo'));
  });
});

describe('mergePerformers', () => {
  it('keeps the first spelling, and an external id wins over a bare name', () => {
    expect(
      mergePerformers(
        [{ name: 'Dawid Podsiadło' }, { name: 'Kult' }],
        [{ name: 'dawid  podsiadlo', externalId: 'K8vZ917' }, { name: 'Hey' }],
      ),
    ).toEqual([
      { name: 'Dawid Podsiadło', externalId: 'K8vZ917' },
      { name: 'Kult' },
      { name: 'Hey' },
    ]);
  });

  it('drops one-letter noise and caps the list', () => {
    expect(mergePerformers([{ name: 'X' }, { name: '  ' }])).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `Band ${i}` }));
    expect(mergePerformers(many)).toHaveLength(30);
  });
});

describe('splitPerformers', () => {
  it('splits the add form field on commas, semicolons and new lines', () => {
    expect(splitPerformers('Kult, Hey\nMela Koteluk; kult')).toEqual([
      { name: 'Kult' },
      { name: 'Hey' },
      { name: 'Mela Koteluk' },
    ]);
  });
});
