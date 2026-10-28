import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { Moderation } from '../src/components/Moderation';
import { config } from '../src/config';
import { countEvent, flushCounts, resetCounts } from '../src/counts';
import { I18nProvider } from '../src/i18n';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('impact counts (M12 slice E)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    resetCounts();
    fetchMock = vi.fn(async () => json({ added: 1 }, 202));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const sent = () =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).items);

  it('sends a batch after a pause, once per event and kind, with keepalive', () => {
    countEvent('e1', 'open');
    countEvent('e1', 'open');
    countEvent('e1', 'route');
    countEvent('e2', 'open');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(sent()).toEqual([
      [
        { eventId: 'e1', kind: 'open' },
        { eventId: 'e1', kind: 'route' },
        { eventId: 'e2', kind: 'open' },
      ],
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/counts');
    expect((init as RequestInit).keepalive).toBe(true);
    expect(JSON.parse(String((init as RequestInit).body)).deviceId).toEqual(expect.any(String));
    // Opening the same card again later in the session adds nothing.
    countEvent('e1', 'open');
    vi.advanceTimersByTime(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends at once when the page is hidden, and swallows a failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    countEvent('e3', 'arrival');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent()).toEqual([[{ eventId: 'e3', kind: 'arrival' }]]);
    flushCounts();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});

describe('the trusted list in the moderation queue (M12 slice E)', () => {
  const me: Me = {
    id: 'u1',
    email: 'mod@example.org',
    role: 'moderator',
    locale: 'en',
    termsVersion: config.app.legal.termsVersion,
    plan: 'account',
    planSource: 'account',
    planEndsAt: null,
    entitlements: entitlementsFor(config.plans, 'account'),
    usage: {
      month: '2026-10',
      resetsAt: '2026-10-31T23:00:00.000Z',
      events: { used: 0, limit: 15 },
      autofill: { used: 0, limit: 5 },
    },
  };
  const trusted = {
    id: 't1',
    kind: 'user',
    source_id: 'submissions',
    url: null,
    confidence: 1,
    event_id: 'submissions:t1',
    created_at: '2026-10-28T10:00:00Z',
    submitter: 'abcd1234',
    event: { title: 'Kiermasz w parafii', startAt: '2026-11-01T09:00:00Z' },
    venue: { name: 'Parafia Przykładowa', address: null },
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.test');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    localStorage.setItem(
      'happow:session',
      JSON.stringify({
        accessToken: `x.${btoa(JSON.stringify({ email: 'mod@example.org' }))}.y`,
        refreshToken: 'r',
        expiresAt: Date.now() + 3_600_000,
        email: 'mod@example.org',
      }),
    );
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me') return json(me);
      if (url === '/api/moderation')
        return json({
          moderator: 'mod@example.org',
          submissions: [],
          reports: [],
          trusted: [trusted],
        });
      if (url === '/api/moderation/trusted/t1' && init?.method === 'POST')
        return json({ id: 't1', eventId: 'submissions:t1', action: 'reject' });
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('lists what trusted accounts published, with Reject', async () => {
    render(
      <I18nProvider initial="en">
        <AccountProvider>
          <Moderation onClose={vi.fn()} />
        </AccountProvider>
      </I18nProvider>,
    );
    expect(await screen.findByText('Published by trusted contributors (1)')).toBeTruthy();
    expect(screen.getByText('Trusted contributor, published without review')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.queryByText('Kiermasz w parafii')).toBeNull());
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/moderation/trusted/t1')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ action: 'reject' });
  });
});
