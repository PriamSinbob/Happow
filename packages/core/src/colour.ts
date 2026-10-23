import SunCalc from 'suncalc';
import type {
  LatLng,
  MapConfig,
  ThemeConfig,
  ThemeName,
  ThemePreset,
  ThemeTokens,
} from './types.js';

/** "#6A4CF5" → [106, 76, 245]. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** HSL hue (0–360°) and saturation (0–1). */
export function hueSat(hex: string): { hue: number; sat: number } {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  const l = (max + min) / 2;
  const sat = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat };
}

/** Shortest distance between two hues on the colour wheel, 0–180°. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Below this saturation a colour has no meaningful hue (Mono), so the hue rule does not apply. */
const ACHROMATIC = 0.1;

/**
 * The §3.2 rules for a live-hue preset, in both themes: glyph on the live colour ≥ 3:1, live
 * colour against the land ≥ 3:1, and ≥ 40° of hue away from park green and water blue (taken
 * from the day tokens). Returns one line per broken rule; empty means the preset may ship.
 */
export function checkPreset(preset: ThemePreset, config: ThemeConfig): string[] {
  const { rules, themes } = config;
  const fails: string[] = [];
  const ref = { park: hueSat(themes.day.park).hue, water: hueSat(themes.day.water).hue };
  for (const name of ['day', 'night'] as const) {
    const { live, onLive } = preset[name];
    const land = themes[name].land;
    const glyph = contrast(live, onLive);
    if (glyph < rules.minGlyphContrast)
      fails.push(`${preset.id} ${name}: glyph ${glyph.toFixed(2)}:1 < ${rules.minGlyphContrast}`);
    const onLand = contrast(live, land);
    if (onLand < rules.minLandContrast)
      fails.push(`${preset.id} ${name}: land ${onLand.toFixed(2)}:1 < ${rules.minLandContrast}`);
    const { hue, sat } = hueSat(live);
    if (sat < ACHROMATIC) continue;
    for (const [what, h] of Object.entries(ref)) {
      const d = hueDistance(hue, h);
      if (d < rules.minHueDistance)
        fails.push(
          `${preset.id} ${name}: ${d.toFixed(0)}° from ${what} < ${rules.minHueDistance}°`,
        );
    }
  }
  return fails;
}

/**
 * Text tokens: ink on paper, paper2 and land; muted on paper, land and the toggle track; content on
 * an "on" toggle; notice inks on their fills.
 */
export function checkTokens(name: ThemeName, t: ThemeTokens, config: ThemeConfig): string[] {
  const { minInkContrast: ink, minMutedContrast: muted } = config.rules;
  const pairs: [string, string, string, number][] = [
    ['ink', 'paper', t.paper, ink],
    ['ink', 'paper2', t.paper2, ink],
    ['ink', 'land', t.land, ink],
    ['muted', 'paper', t.paper, muted],
    ['muted', 'land', t.land, muted],
    ['muted', 'sunken', t.sunken, muted],
    ['onRaised', 'raised', t.raised, ink],
    ['warnInk', 'warn', t.warn, ink],
    ['errorInk', 'error', t.error, ink],
  ];
  return pairs.flatMap(([fg, bgName, bg, min]) => {
    const c = contrast(t[fg as keyof ThemeTokens] as string, bg);
    return c < min ? [`${name}: ${fg} on ${bgName} ${c.toFixed(2)}:1 < ${min}`] : [];
  });
}

export type ThemeSetting = 'auto' | ThemeName;

/**
 * Day or night: the manual setting, or "auto" by the real sunrise and sunset at `point`
 * (computed locally, no API). Polar day and night fall back to the sun's altitude.
 */
export function themeAt(now: Date, point: LatLng, setting: ThemeSetting): ThemeName {
  if (setting !== 'auto') return setting;
  const { sunrise, sunset } = SunCalc.getTimes(now, point.lat, point.lng);
  if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime()))
    return SunCalc.getPosition(now, point.lat, point.lng).altitude > 0 ? 'day' : 'night';
  return now >= sunrise && now < sunset ? 'day' : 'night';
}

/** The preset by id, else the configured default. */
export function presetById(config: ThemeConfig, id: string | null | undefined): ThemePreset {
  return (
    config.presets.find((p) => p.id === id) ??
    config.presets.find((p) => p.id === config.defaultPreset)!
  );
}

/** "highway_major_*" matches every layer id starting "highway_major_"; otherwise ids match exactly. */
export function layerMatches(pattern: string, id: string): boolean {
  return pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}

/** The paint changes that recolour a basemap style for one theme: [layer id, property, colour]. */
export function themeLayerPaint(
  rules: MapConfig['themeLayers'],
  layerIds: string[],
  tokens: ThemeTokens,
): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const id of layerIds)
    for (const rule of rules)
      if (rule.layers.some((p) => layerMatches(p, id)))
        for (const [prop, token] of Object.entries(rule.paint))
          out.push([id, prop, tokens[token] as string]);
  return out;
}
