import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  presetById,
  themeAt,
  type LatLng,
  type ThemeName,
  type ThemePreset,
  type ThemeSetting,
  type ThemeTokens,
} from '@happow/core';
import { config, region } from './config';
import { useMinuteClock } from './hooks/useClock';
import { storage } from './storage';

const SETTINGS: ThemeSetting[] = ['auto', 'day', 'night'];

/** Presets anyone may pick; account and premium ones wait for accounts (§8). */
export const selectablePresets = config.theme.presets.filter((p) => p.tier === 'anonymous');

function savedSetting(): ThemeSetting {
  const s = storage.get('theme');
  return SETTINGS.includes(s as ThemeSetting) ? (s as ThemeSetting) : 'auto';
}

function savedPreset(): ThemePreset {
  const p = presetById(config.theme, storage.get('preset'));
  return p.tier === 'anonymous' ? p : presetById(config.theme, null);
}

const kebab = (k: string) => k.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

/** Writes a theme and preset to CSS custom properties on <html> (`--paper-2`, `--live`, …). */
export function applyTheme(name: ThemeName, preset: ThemePreset, root = document.documentElement) {
  const tokens = config.theme.themes[name];
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${kebab(k)}`, String(v));
  root.style.setProperty('--live', preset[name].live);
  root.style.setProperty('--on-live', preset[name].onLive);
  root.style.colorScheme = name === 'night' ? 'dark' : 'light';
  root.dataset.theme = name;
  root.dataset.preset = preset.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.land);
}

/** Before the first render, so the app never flashes the wrong theme. */
export function applyInitialTheme() {
  applyTheme(themeAt(new Date(), region.center, savedSetting()), savedPreset());
}

interface Theme {
  name: ThemeName;
  tokens: ThemeTokens;
  preset: ThemePreset;
  setting: ThemeSetting;
  setSetting: (s: ThemeSetting) => void;
  setPreset: (id: string) => void;
  /** Where "auto" looks up sunrise and sunset; the region centre until the user is located. */
  setPoint: (p: LatLng) => void;
}

const Ctx = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState(savedSetting);
  const [preset, setPresetState] = useState(savedPreset);
  const [point, setPoint] = useState<LatLng>(region.center);
  // Auto re-checks sunrise and sunset on the existing minute clock.
  const now = useMinuteClock();
  const name = themeAt(now, point, setting);

  useEffect(() => applyTheme(name, preset), [name, preset]);

  const value = useMemo<Theme>(
    () => ({
      name,
      tokens: config.theme.themes[name],
      preset,
      setting,
      setSetting: (s) => {
        setSettingState(s);
        storage.set('theme', s);
      },
      setPreset: (id) => {
        const p = selectablePresets.find((x) => x.id === id);
        if (!p) return;
        setPresetState(p);
        storage.set('preset', p.id);
      },
      setPoint,
    }),
    [name, preset, setting],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(Ctx);
  if (!t) throw new Error('useTheme outside ThemeProvider');
  return t;
}

export { SETTINGS as THEME_SETTINGS };
