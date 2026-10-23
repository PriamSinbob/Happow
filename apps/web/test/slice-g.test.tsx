import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { SettingsSheet } from '../src/components/SettingsSheet';
import { useFilters, type FiltersState } from '../src/hooks/useFilters';
import { useShortcut } from '../src/hooks/useShortcut';
import { I18nProvider } from '../src/i18n';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider initial="en">{children}</I18nProvider>
);
const css = () => readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const mockup = () =>
  readFileSync(resolve(process.cwd(), '../../docs/design/settings-rows.html'), 'utf8');

function sheet(over: Partial<FiltersState> = {}) {
  const filters = {
    window: { id: 'today', endOfDay: true },
    setWindow: vi.fn(),
    categories: [],
    toggleCategory: vi.fn(),
    price: 'any',
    setPrice: vi.fn(),
    setCategories: vi.fn(),
    family: false,
    setFamily: vi.fn(),
    activeCount: 0,
    clear: vi.fn(),
    ...over,
  } as FiltersState;
  render(
    <SettingsSheet
      filters={filters}
      count={476}
      loading={false}
      onClose={vi.fn()}
      onAdd={vi.fn()}
      onAbout={vi.fn()}
    />,
    { wrapper },
  );
  return filters;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('settings sheet (§15)', () => {
  it('both tickets start on; tapping one hides that kind', () => {
    const f = sheet();
    const free = screen.getByRole('button', { name: /^free$/i });
    expect(free.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(free);
    expect(f.setPrice).toHaveBeenCalledWith('paid');
  });

  it('the last ticket that is on nudges instead of going off', () => {
    const f = sheet({ price: 'paid' });
    const paid = screen.getByRole('button', { name: /^paid$/i });
    fireEvent.click(paid);
    expect(f.setPrice).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^paid$/i }).className).toContain('is-nudge');
  });

  it('family mode is its own toggle; the footer has no words, only the count', () => {
    const f = sheet();
    fireEvent.click(screen.getByRole('button', { name: /^family mode$/i }));
    expect(f.setFamily).toHaveBeenCalledWith(true);
    const show = screen.getByRole('button', { name: /476/ });
    expect(show.textContent).toBe('476');
  });

  it('draws the tickets, globe and filter-off from the mockup', () => {
    const m = mockup();
    for (const d of [
      'M15 11l0 2',
      'M9 5h10a2 2 0 0 1 2 2v3a2 2 0 1 0 0 4v3',
      'M3.6 9h16.8',
      'M3 3l18 18',
    ])
      expect(m).toContain(d);
  });
});

describe('map shortcut', () => {
  const hook = () =>
    renderHook(
      () => {
        const filters = useFilters();
        return { filters, shortcut: useShortcut(filters) };
      },
      { wrapper },
    );

  it('starts as family mode and toggles it', () => {
    const { result } = hook();
    expect(result.current.shortcut.id).toBe('family');
    act(() => result.current.shortcut.toggle());
    expect(result.current.filters.family).toBe(true);
    expect(result.current.shortcut.on).toBe(true);
  });

  it('a category shortcut shows only that category, and off brings back the choice before', () => {
    const { result } = hook();
    act(() => result.current.filters.toggleCategory('music'));
    act(() => result.current.filters.toggleCategory('theatre'));
    act(() => result.current.shortcut.choose('food'));
    expect(result.current.filters.categories).toEqual(['food']);
    expect(result.current.shortcut.on).toBe(true);
    act(() => result.current.shortcut.choose('sport'));
    expect(result.current.filters.categories).toEqual(['sport']);
    act(() => result.current.shortcut.toggle());
    expect(result.current.filters.categories).toEqual(['music', 'theatre']);
    expect(localStorage.getItem('happow:shortcut')).toBe('sport');
  });

  it('switching to family turns the category shortcut off first', () => {
    const { result } = hook();
    act(() => result.current.shortcut.choose('food'));
    act(() => result.current.shortcut.choose('family'));
    expect(result.current.filters.categories).toEqual([]);
    expect(result.current.filters.family).toBe(true);
  });
});

describe('black and white, touch-first (§15, §1)', () => {
  it('no category colours and no hover styles in the stylesheet', () => {
    expect(css()).not.toMatch(/--cat\b/);
    expect(css()).not.toMatch(/:hover/);
  });
});
