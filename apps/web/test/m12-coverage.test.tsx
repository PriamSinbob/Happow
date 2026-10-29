import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Coverage } from '../src/components/Coverage';
import { I18nProvider } from '../src/i18n';

/** M12 slice O: the admin's coverage tab. */

const m = (today: number, week: number, tonight: number, share: number, adders: number) => ({
  eventsToday: today,
  events7d: week,
  districts: 48,
  districtsTonight: tonight,
  communityShare: share,
  accountsAdded7d: adders,
  accountsAddedTotal: adders,
});
const data = {
  now: m(121, 418, 7, 0.031, 3),
  weeks: [
    { week: '2026-10-26', metrics: m(119, 404, 5, 0, 0) },
    { week: '2026-11-02', metrics: m(120, 410, 6, 0.01, 1) },
  ],
  districts: [
    {
      id: '1',
      name: 'Stare Miasto',
      today: 40,
      week: 160,
      byCategory: { cinema: { today: 30, week: 120 }, music: { today: 6, week: 25 } },
    },
    { id: '2', name: 'Nadodrze', today: 1, week: 3, byCategory: { music: { today: 1, week: 3 } } },
    { id: '3', name: 'Pawłowice', today: 0, week: 0, byCategory: {} },
  ],
};

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.test');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the coverage tab (M12 §3)', () => {
  it('shows the five measures now and by week, newest first', async () => {
    render(
      <I18nProvider initial="en">
        <Coverage reload={0} />
      </I18nProvider>,
    );
    const now = await screen.findByRole('row', { name: /^Now/ });
    expect(
      within(now)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['121', '418', '7/48', '3%', '3']);
    const rows = screen.getAllByRole('row').slice(2);
    expect(rows[0]!.textContent).toMatch(/Nov/);
    expect(rows[1]!.textContent).toMatch(/Oct/);
  });

  it('lists districts emptiest first, and by one category when picked', async () => {
    render(
      <I18nProvider initial="en">
        <Coverage reload={0} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Districts: 1 of 3 with nothing this week')).toBeTruthy();
    const names = () =>
      Array.from(document.querySelectorAll('.coverage__list .my-events__title')).map(
        (n) => n.textContent,
      );
    expect(names()).toEqual(['Pawłowice', 'Nadodrze', 'Stare Miasto']);
    expect(screen.getByText(/today 40 · week 160 · Cinema 120, Music 25/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cinema' } });
    expect(screen.getByText('Districts: 2 of 3 with nothing this week')).toBeTruthy();
    expect(names()).toEqual(['Nadodrze', 'Pawłowice', 'Stare Miasto']);
    expect(screen.getByText('today 30 · week 120')).toBeTruthy();
  });
});
