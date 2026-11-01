import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InstallHint, isIosBrowser } from '../src/components/InstallHint';
import { I18nProvider } from '../src/i18n';

/** M9 slice G: opening shared links in the app. */

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const nav = (userAgent: string, platform = 'iPhone', maxTouchPoints = 5) =>
  ({ userAgent, platform, maxTouchPoints }) as Navigator;

const hint = (fromLink: boolean) =>
  render(
    <I18nProvider initial="en">
      <InstallHint fromLink={fromLink} />
    </I18nProvider>,
  );

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('opening shared links in the app (M9 slice G)', () => {
  it('lets an installed Android app capture /e/ links (manifest)', () => {
    const src = readFileSync('vite.config.ts', 'utf8');
    expect(src).toMatch(/scope: '\/'/);
    expect(src).toMatch(/start_url: '\/'/);
    expect(src).toMatch(/handle_links: 'preferred'/);
    expect(src).toMatch(/client_mode: \['navigate-existing', 'auto'\]/);
  });

  it('knows iOS Safari, iPadOS and the installed app apart', () => {
    expect(isIosBrowser(nav(IPHONE), false)).toBe(true);
    expect(isIosBrowser(nav(IPHONE), true)).toBe(false);
    expect(
      isIosBrowser(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), false),
    ).toBe(true);
    expect(
      isIosBrowser(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), false),
    ).toBe(false);
    expect(isIosBrowser(nav(ANDROID, 'Linux armv8l'), false)).toBe(false);
  });

  it('suggests adding to the Home Screen once, on a card opened from a link in iOS Safari', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    hint(true);
    expect(screen.getByRole('note').textContent).toMatch(/Add Happow to your Home Screen/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    // Never again on this device.
    hint(true);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('stays quiet without a shared link, and outside iOS', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    hint(false);
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID);
    hint(true);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
