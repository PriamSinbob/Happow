import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkPreset,
  checkTokens,
  contrast,
  hueDistance,
  hueSat,
  loadConfig,
  presetById,
  themeAt,
  themeConfigSchema,
  themeLayerPaint,
} from '../src';

const config = loadConfig();
const { theme } = config;
const positron = JSON.parse(
  readFileSync(new URL('./fixtures/positron-layers.json', import.meta.url), 'utf8'),
) as { layers: { id: string; type: string }[] };

describe('colour maths', () => {
  it('matches the WCAG contrast figures in the spec (§3.2)', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#6A4CF5', '#FFFFFF')).toBeCloseTo(5.3, 1);
    expect(contrast('#6A4CF5', '#F1ECE2')).toBeCloseTo(4.5, 1);
    expect(contrast('#8C74FF', '#000000')).toBeCloseTo(6.06, 1);
    expect(contrast('#FF4FA8', '#FFFFFF')).toBeCloseTo(3.03, 1);
  });
  it('reads hues: park green 87°, water blue 202°', () => {
    expect(hueSat(theme.themes.day.park).hue).toBeCloseTo(87, 0);
    expect(hueSat(theme.themes.day.water).hue).toBeCloseTo(202, 0);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueSat('#808080').sat).toBe(0);
  });
});

describe('contrast test: every shipped preset and theme meets §3.2', () => {
  it.each(theme.presets.map((p) => [p.id, p] as const))('%s', (_id, preset) => {
    expect(checkPreset(preset, theme)).toEqual([]);
  });
  it.each(['day', 'night'] as const)('%s text tokens are readable', (name) => {
    expect(checkTokens(name, theme.themes[name], theme)).toEqual([]);
  });
  it('rejects the candidates the spec ruled out', () => {
    const candidate = (live: string) => ({
      id: 'x',
      labels: { pl: 'x', en: 'x' },
      tier: 'anonymous' as const,
      day: { live, onLive: '#FFFFFF' },
      night: { live, onLive: '#FFFFFF' },
    });
    // Blue sits 21° from water; orange fails the white glyph.
    expect(checkPreset(candidate('#2F7FC1'), theme).join()).toMatch(/from water/);
    expect(checkPreset(candidate('#F59E0B'), theme).join()).toMatch(/glyph/);
  });
  it('the default preset is open to everyone; unknown ids fall back to it', () => {
    expect(presetById(theme, 'nope').id).toBe('violet');
    expect(presetById(theme, 'mono').id).toBe('mono');
    const bad = { ...theme, themes: { ...theme.themes, day: { ...theme.themes.day, ink: 'red' } } };
    expect(themeConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe('themeAt', () => {
  const wroclaw = { lat: 51.11, lng: 17.03 };
  it('follows the real sunrise and sunset (Wrocław, 22 Oct: about 05:28–15:47 UTC)', () => {
    expect(themeAt(new Date('2026-10-22T05:10:00Z'), wroclaw, 'auto')).toBe('night');
    expect(themeAt(new Date('2026-10-22T05:45:00Z'), wroclaw, 'auto')).toBe('day');
    expect(themeAt(new Date('2026-10-22T15:30:00Z'), wroclaw, 'auto')).toBe('day');
    expect(themeAt(new Date('2026-10-22T16:05:00Z'), wroclaw, 'auto')).toBe('night');
  });
  it('a manual setting wins', () => {
    expect(themeAt(new Date('2026-10-22T12:00:00Z'), wroclaw, 'night')).toBe('night');
    expect(themeAt(new Date('2026-10-22T23:00:00Z'), wroclaw, 'day')).toBe('day');
  });
  it('polar day and night use the sun altitude', () => {
    const svalbard = { lat: 78.2, lng: 15.6 };
    expect(themeAt(new Date('2026-06-21T00:00:00Z'), svalbard, 'auto')).toBe('day');
    expect(themeAt(new Date('2026-12-21T12:00:00Z'), svalbard, 'auto')).toBe('night');
  });
});

describe('basemap recolouring', () => {
  const ids = positron.layers.map((l) => l.id);
  it('every configured layer pattern matches the recorded Positron style', () => {
    for (const rule of config.map.themeLayers)
      for (const pattern of rule.layers) {
        const re = pattern.endsWith('*')
          ? (id: string) => id.startsWith(pattern.slice(0, -1))
          : (id: string) => id === pattern;
        expect(ids.some(re), pattern).toBe(true);
      }
  });
  it('paints land, water, parks and roads with the theme tokens', () => {
    const night = theme.themes.night;
    const paint = themeLayerPaint(config.map.themeLayers, ids, night);
    const get = (id: string, prop: string) => paint.find(([l, p]) => l === id && p === prop)?.[2];
    expect(get('background', 'background-color')).toBe('#000000');
    expect(get('water', 'fill-color')).toBe(night.water);
    expect(get('park', 'fill-color')).toBe(night.park);
    expect(get('highway_major_inner', 'line-color')).toBe(night.majorRoad);
    expect(get('highway_minor', 'line-color')).toBe(night.minorRoad);
    expect(get('label_city', 'text-halo-color')).toBe('#000000');
  });
  it('only sets properties a layer type has', () => {
    const types = new Map(positron.layers.map((l) => [l.id, l.type]));
    const prefix: Record<string, string> = {
      background: 'background-',
      fill: 'fill-',
      line: 'line-',
      symbol: 'text-',
    };
    for (const [id, prop] of themeLayerPaint(config.map.themeLayers, ids, theme.themes.day))
      expect(prop.startsWith(prefix[types.get(id)!]!), `${id} ${prop}`).toBe(true);
  });
});
