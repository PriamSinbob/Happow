import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { AddEvent } from '../src/components/AddEvent';
import { Moderation } from '../src/components/Moderation';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';

/** M12 slice I: weekly repeats on the add form, and a series decided once in moderation. */

vi.mock('../src/components/PinMap', () => ({ PinMap: () => <div /> }));

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const account = (email: string, role: Me['role'], used = 0): Me => ({
  id: 'u1',
  email,
  role,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  plan: 'account',
  planSource: 'account',
  planEndsAt: null,
  entitlements: entitlementsFor(config.plans, 'account'),
  usage: {
    month: '2026-10',
    resetsAt: '2026-10-31T23:00:00.000Z',
    events: { used, limit: 15 },
    autofill: { used: 0, limit: 5 },
  },
});
const signIn = (email: string) =>
  localStorage.setItem(
    'happow:session',
    JSON.stringify({
      accessToken: `x.${btoa(JSON.stringify({ email }))}.y`,
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      email,
    }),
  );
let fetchMock: ReturnType<typeof vi.fn>;
const serve = (routes: (url: string, init?: RequestInit) => Response | null) => {
  fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      routes(String(input), init) ?? ok({ error: 'not_found' }, 404),
  );
  vi.stubGlobal('fetch', fetchMock);
};
const wrap = (node: React.ReactNode) =>
  render(
    <I18nProvider initial="en">
      <AccountProvider>{node}</AccountProvider>
    </I18nProvider>,
  );

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.test');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Repeats on the add form (M12 §4.5)', () => {
  const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
  async function fill(used = 0) {
    signIn('ala@example.org');
    serve((url) => {
      if (url === '/api/me') return ok(account('ala@example.org', null, used));
      if (url === '/api/geocode') return ok({ result: { point: { lat: 51.11, lng: 17.03 } } });
      if (url === '/api/submissions')
        return ok(
          {
            id: 'a1',
            eventId: 'submissions:a1',
            status: 'published',
            seriesId: 's1',
            dates: [1, 2, 3, 4].map((n) => ({ id: `a${n}`, eventId: `submissions:a${n}` })),
          },
          201,
        );
      return null;
    });
    wrap(<AddEvent onClose={vi.fn()} onOpenEvent={vi.fn()} onOpenAccount={vi.fn()} />);
    await screen.findByText('Photo of a poster');
    fireEvent.change(input(/^Title/), { target: { value: 'Pchli targ na Ruskiej' } });
    fireEvent.click(screen.getByRole('button', { name: config.categories[0]!.labels.en }));
    // Sat 7 Nov 2026.
    fireEvent.change(input(/^Starts/), { target: { value: '2026-11-07T10:00' } });
    fireEvent.change(input(/^Place/), { target: { value: 'Podwórko Ruska 46' } });
    fireEvent.change(input(/^Address/), { target: { value: 'Ruska 46' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find on map' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/geocode')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('Required')).toBeNull());
    fireEvent.click(screen.getByRole('radio', { name: 'Free' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));
  }
  const sent = () =>
    JSON.parse(
      String(
        (fetchMock.mock.calls.find(([u]) => u === '/api/submissions')?.[1] as RequestInit).body,
      ),
    );

  it("starts on the start's weekday for four weeks, and sends the pattern", async () => {
    await fill();
    expect(screen.getByRole('button', { name: 'Sat' }).getAttribute('aria-pressed')).toBe('true');
    expect(input(/^Until/).value).toBe('2026-12-05');
    expect(screen.getByText(/^5 dates · /)).toBeTruthy();
    fireEvent.change(input(/^Until/), { target: { value: '2026-11-28' } });
    expect(screen.getByText(/^4 dates · /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(await screen.findByText('4 dates added, each its own event.')).toBeTruthy();
    expect(sent().repeat).toEqual({ days: [6], until: '2026-11-28' });
    expect(sent().event.start).toBe('2026-11-07T10:00');
  });

  it("won't send more dates than are left this month, or none", async () => {
    await fill(13);
    expect(screen.getByText('This adds 5 dates; 2 are left this month.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    expect(screen.getByText(/^No dates yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/^No dates yet/));
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/submissions')).toBe(false);
  });

  it('sends a single event when set back to "Does not repeat"', async () => {
    await fill();
    fireEvent.click(screen.getByRole('radio', { name: 'Does not repeat' }));
    expect(screen.queryByLabelText(/^Until/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    await waitFor(() => expect(sent()).toBeTruthy());
    expect(sent().repeat).toBeUndefined();
  });
});

describe('a series in the moderation queue (M12 §4.5)', () => {
  const pending = (id: string, startAt: string, series: string | null) => ({
    id,
    kind: 'user',
    source_id: 'submissions',
    url: null,
    confidence: 1,
    event_id: `submissions:${id}`,
    created_at: '2026-10-29T10:00:00Z',
    series_id: series,
    submitter: 'abcd1234',
    event: { title: series ? 'Pchli targ' : 'Koncert', startAt },
    venue: { name: 'Podwórko', address: null },
  });

  it('shows the dates as one card and decides them together', async () => {
    signIn('mod@example.org');
    serve((url, init) => {
      if (url === '/api/me') return ok(account('mod@example.org', 'moderator'));
      if (url === '/api/moderation')
        return ok({
          moderator: 'mod@example.org',
          submissions: [
            pending('b2', '2026-11-14T09:00:00Z', 's1'),
            pending('c1', '2026-11-08T18:00:00Z', null),
            pending('b1', '2026-11-07T09:00:00Z', 's1'),
          ],
          reports: [],
          trusted: [],
        });
      if (url === '/api/moderation/series/s1' && init?.method === 'POST')
        return ok({ seriesId: 's1', action: 'approve', dates: [] });
      return null;
    });
    wrap(<Moderation onClose={vi.fn()} />);
    expect(await screen.findByText('Submissions (2)')).toBeTruthy();
    expect(screen.getAllByText('Pchli targ')).toHaveLength(1);
    expect(screen.getByText(/^2 dates: Sat,? (7 Nov|Nov 7), Sat,? (14 Nov|Nov 14)$/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]!);
    await waitFor(() => expect(screen.queryByText('Pchli targ')).toBeNull());
    expect(screen.getByText('Koncert')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/moderation/series/s1')).toBe(true);
  });
});
