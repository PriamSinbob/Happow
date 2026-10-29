import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { FeedsSection, type Feed } from '../src/components/Feeds';
import { Moderation } from '../src/components/Moderation';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';

/** M12 slice L: calendar feeds on the account card, and stopping one from the queue. */

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const account = (email: string, role: Me['role']): Me => ({
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
    events: { used: 0, limit: 15 },
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
const feed = (over: Partial<Feed> = {}): Feed => ({
  id: 1,
  url: 'https://kalendarz.example/secret-token/basic.ics',
  status: 'active',
  approved: false,
  lastRunAt: '2026-10-29T08:00:00Z',
  lastError: null,
  lastEvents: 3,
  imported: 3,
  ...over,
});
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

describe('calendar feeds on the account card (M12 §4.6)', () => {
  it('lists feeds by host only, with how each did, and adds and removes them', async () => {
    signIn('ala@example.org');
    let feeds = [feed(), feed({ id: 2, url: 'https://inny.example/a.ics', status: 'stopped' })];
    serve((url, init) => {
      if (url === '/api/me') return ok(account('ala@example.org', null));
      if (url === '/api/me/feeds' && init?.method === 'POST') {
        feeds = [...feeds, feed({ id: 3, url: 'https://nowy.example/c.ics', lastRunAt: null })];
        return ok({ feeds, max: 3 });
      }
      if (url === '/api/me/feeds/1' && init?.method === 'DELETE') {
        feeds = feeds.filter((f) => f.id !== 1);
        return ok({ feeds, max: 3 });
      }
      if (url === '/api/me/feeds') return ok({ feeds, max: 3 });
      return null;
    });
    wrap(<FeedsSection />);
    expect(await screen.findByText('kalendarz.example')).toBeTruthy();
    // The secret part of a private calendar's address is never shown.
    expect(screen.queryByText(/secret-token/)).toBeNull();
    expect(
      screen.getByText(/^3 events so far · read .* · the first ones wait for a moderator$/),
    ).toBeTruthy();
    expect(screen.getByText('Stopped by an admin')).toBeTruthy();
    // A stopped feed can't be removed by its account.
    expect(screen.getAllByRole('button', { name: /^Remove the feed/ })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText(/^iCal link/), {
      target: { value: 'webcal://nowy.example/c.ics' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('nowy.example')).toBeTruthy();
    expect(screen.getByText('Not read yet')).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({
      url: 'webcal://nowy.example/c.ics',
    });
    // At the limit, the add field goes away.
    expect(screen.queryByLabelText(/^iCal link/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the feed from kalendarz.example' }));
    await waitFor(() => expect(screen.queryByText('kalendarz.example')).toBeNull());
  });

  it('says when the month’s events paused a feed, and why an add was refused', async () => {
    signIn('ala@example.org');
    serve((url, init) => {
      if (url === '/api/me') return ok(account('ala@example.org', null));
      if (url === '/api/me/feeds' && init?.method === 'POST')
        return ok({ error: 'feed_stopped' }, 409);
      if (url === '/api/me/feeds')
        return ok({ feeds: [feed({ lastError: 'quota', approved: true })], max: 2 });
      return null;
    });
    wrap(<FeedsSection />);
    expect(await screen.findByText('Paused: this month’s events are used up')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^iCal link/), {
      target: { value: 'https://kalendarz.example/stary.ics' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/An admin stopped this feed/);
  });
});

describe('a feed in the moderation queue (M12 §4.6)', () => {
  it('names the feed, and lets an admin stop it', async () => {
    signIn('owner@example.org');
    serve((url, init) => {
      if (url === '/api/me') return ok(account('owner@example.org', 'admin'));
      if (url === '/api/moderation')
        return ok({
          moderator: 'owner@example.org',
          submissions: [
            {
              id: 'f1',
              kind: 'user',
              source_id: 'submissions',
              url: null,
              confidence: 1,
              event_id: null,
              created_at: '2026-10-29T10:00:00Z',
              feed_id: 7,
              feed_url: 'https://kalendarz.example/secret/basic.ics',
              feed_status: 'active',
              submitter: 'abcd1234',
              event: { title: 'Jam session', startAt: '2026-11-17T19:00:00Z' },
              venue: { name: 'Klub', address: null },
            },
          ],
          reports: [],
          trusted: [],
        });
      if (url === '/api/admin/feeds/7' && init?.method === 'POST')
        return ok({ id: 7, status: 'stopped' });
      // The admin tabs load their own lists; empty here.
      return ok([]);
    });
    wrap(<Moderation onClose={vi.fn()} />);
    expect(await screen.findByText(/From a calendar feed: kalendarz\.example/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop this feed' }));
    expect(await screen.findByText(/Feed stopped/)).toBeTruthy();
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/admin/feeds/7')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ action: 'stop' });
  });
});
