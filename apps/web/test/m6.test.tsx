import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import seed from '../../../data/seed/wroclaw.events.json';
import { materializeSeed } from '@happow/core/seed';
import { RuleList } from '../src/components/EventCard';
import { config, region } from '../src/config';
import { rowToEvent } from '../src/data/supabase';
import { I18nProvider } from '../src/i18n';

const row = {
  id: 'e1',
  title: 'T',
  category_ids: ['music'],
  start_at: '2026-10-20T19:00:00Z',
  end_at: '2026-10-20T22:00:00Z',
  end_estimated: false,
  timezone: 'Europe/Warsaw',
  venue_id: null,
  lat: 51,
  lng: 17,
  h3_r9: 'x',
  is_free: true,
  rules: {},
  status: 'scheduled',
  trust: 'api',
  confidence: 1,
  last_seen_at: '2026-10-20T18:00:00Z',
} as unknown as Parameters<typeof rowToEvent>[0];

describe('entry and age data', () => {
  it('maps the new columns, and reads rows without them as unknown', () => {
    expect(
      rowToEvent({ ...row, entry: 'open', grace_min: 10, age_min: 18, family: false }),
    ).toMatchObject({ entry: 'open', graceMin: 10, ageMin: 18, family: false });
    expect(rowToEvent(row)).toMatchObject({
      entry: null,
      graceMin: null,
      ageMin: null,
      family: null,
    });
  });

  it('the offline seed carries ageMin instead of rules.age', () => {
    const events = materializeSeed(seed, region, config.categories, new Date(), 9);
    expect(events.filter((e) => e.ageMin !== null).map((e) => e.ageMin)).toEqual([
      6, 16, 12, 3, 14, 10, 0,
    ]);
    for (const e of events) expect(e.rules).not.toHaveProperty('age');
  });

  const rules = (lang: 'pl' | 'en', ev: Parameters<typeof RuleList>[0]['ev']) =>
    renderToStaticMarkup(
      <I18nProvider initial={lang}>
        <RuleList ev={ev} />
      </I18nProvider>,
    );

  it('shows the age limit and the family mark, translated', () => {
    const ev = { rules: { dress: 'smart' }, ageMin: 18, family: null };
    expect(rules('pl', ev)).toContain('Wiek 18+');
    expect(rules('en', ev)).toContain('Ages 18+');
    expect(rules('en', ev)).toContain('Dress code: smart');
    const kids = { rules: {}, ageMin: 0, family: true };
    expect(rules('pl', kids)).toContain('Bez ograniczeń wieku');
    expect(rules('pl', kids)).toContain('Dla dzieci i rodzin');
    expect(rules('en', kids)).toContain('All ages');
    expect(rules('en', { rules: {}, ageMin: null, family: null })).toBe('');
  });
});

describe('themes (slice D)', () => {
  it('writes the theme tokens and the preset to CSS variables', async () => {
    const { applyTheme, selectablePresets } = await import('../src/theme');
    const violet = config.theme.presets.find((p) => p.id === 'violet')!;
    applyTheme('night', violet);
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--land')).toBe('#000000');
    expect(s.getPropertyValue('--paper-2')).toBe(config.theme.themes.night.paper2);
    expect(s.getPropertyValue('--warn-ink')).toBe(config.theme.themes.night.warnInk);
    expect(s.getPropertyValue('--live')).toBe('#8C74FF');
    expect(s.colorScheme).toBe('dark');
    applyTheme('day', violet);
    expect(s.getPropertyValue('--live')).toBe('#6A4CF5');
    expect(s.colorScheme).toBe('light');
    // Account and premium presets wait for accounts (§8).
    expect(selectablePresets.map((p) => p.id)).toEqual(['violet', 'mono']);
  });

  it('the stylesheet uses theme tokens, not fixed colours', () => {
    // Read from disk: Vitest serves `?raw` CSS imports as an empty string.
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css.length).toBeGreaterThan(1000);
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });
});
