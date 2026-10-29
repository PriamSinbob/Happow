import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { entitlementsFor, type NearbyEvent } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { RestoreTrustSheet } from '../src/components/Admin';
import { AfterAdd, ContributorSection } from '../src/components/Contributor';
import { EventDetail } from '../src/components/EventDetail';
import { config } from '../src/config';
import type { Contributions, MyEvent } from '../src/contributions';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { pl } from '../src/i18n/pl';

const SUPABASE = 'https://auth.test';
const jwt = (email: string) => `x.${btoa(JSON.stringify({ email }))}.y`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u1',
  email: 'ala@example.org',
  role: null,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  plan: 'account',
  planSource: null,
  planEndsAt: null,
  showName: false,
  displayName: null,
  entitlements: entitlementsFor(config.plans, 'account'),
  usage: {
    month: '2026-11',
    resetsAt: '2026-11-30T23:00:00.000Z',
    events: { used: 3, limit: 30 },
    autofill: { used: 0, limit: 10 },
  },
  ...over,
});

const myEvent = (over: Partial<MyEvent> = {}): MyEvent => ({
  submissionId: 's1',
  eventId: 'user:1',
  title: 'Courtyard jazz',
  startAt: '2026-11-07T18:00:00.000Z',
  status: 'approved',
  trusted: false,
  hidden: false,
  reward: 'verified',
  days: 3,
  opens: 34,
  routes: 8,
  arrivals: 6,
  ...over,
});

const contributions = (over: Partial<Contributions> = {}): Contributions => ({
  verified: 6,
  opens: 240,
  routes: 31,
  arrivals: 12,
  trusted: false,
  monthDays: 9,
  level: 'local',
  showName: false,
  events: [myEvent()],
  premiumDaysPerEvent: 3,
  premiumDaysPerMonth: 30,
  trustedAfter: 5,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
/** /api/me answers with `account` (PUT updates it), /api/me/contributions with `mine`. */
function serve(
  account: Me,
  mine: Contributions,
  extra?: (url: string, init?: RequestInit) => Response | null,
) {
  let current = account;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const handled = extra?.(url, init);
    if (handled) return handled;
    if (url === '/api/me/contributions') return json(mine);
    if (url === '/api/me' && init?.method === 'PUT') {
      const b = JSON.parse(String(init.body));
      current = { ...current, ...b };
      return json({ ok: true });
    }
    if (url === '/api/me') return json(current);
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const puts = () =>
  fetchMock.mock.calls
    .filter(([u, i]) => u === '/api/me' && (i as RequestInit | undefined)?.method === 'PUT')
    .map(([, i]) => JSON.parse(String((i as RequestInit).body)));

const wrap = ({ children }: { children: ReactNode }) => (
  <I18nProvider initial="en">
    <AccountProvider>{children}</AccountProvider>
  </I18nProvider>
);

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
  localStorage.setItem(
    'happow:session',
    JSON.stringify({
      accessToken: jwt('ala@example.org'),
      refreshToken: 'r1',
      expiresAt: Date.now() + 3_600_000,
      email: 'ala@example.org',
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the contributor section (M12 slice F)', () => {
  it('shows level, impact, trust progress, this month and the events, newest first', async () => {
    serve(
      me(),
      contributions({
        events: [
          myEvent({
            submissionId: 's3',
            title: 'Waiting one',
            status: 'pending',
            reward: null,
            days: 0,
          }),
          myEvent({ submissionId: 's2', title: 'Rejected one', status: 'rejected', reward: null }),
          myEvent(),
        ],
      }),
    );
    const onOpen = vi.fn();
    render(<ContributorSection onOpenEvent={onOpen} onAddAgain={vi.fn()} />, { wrapper: wrap });
    expect(await screen.findByText('Your contributions')).toBeTruthy();
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.getByText('Next: Guide at 20 verified events and 200 opens')).toBeTruthy();
    expect(screen.getByText('240')).toBeTruthy();
    expect(screen.getByText(/After 5 approved events with no rejection/)).toBeTruthy();
    expect(screen.getByText('Premium days earned this month: 9 of 30')).toBeTruthy();
    const titles = screen.getAllByText(/one$|jazz$/).map((n) => n.textContent);
    expect(titles).toEqual(['Waiting one', 'Rejected one', 'Courtyard jazz']);
    expect(screen.getByText('Not published')).toBeTruthy();
    expect(screen.getByText(/34 opens · \+3 days/)).toBeTruthy();
    // A rejected event can't be opened; a live one opens its card.
    expect(screen.getByText('Rejected one').closest('button')).toBeNull();
    fireEvent.click(screen.getByText('Courtyard jazz'));
    expect(onOpen).toHaveBeenCalledWith('user:1');
  });

  it('shows the trusted badge, no next level at the top, and nothing before a first event', async () => {
    serve(me(), contributions({ trusted: true, level: 'cityGuide' }));
    const { unmount } = render(<ContributorSection onOpenEvent={vi.fn()} onAddAgain={vi.fn()} />, {
      wrapper: wrap,
    });
    expect(await screen.findByText('Trusted contributor')).toBeTruthy();
    expect(screen.getByText('City guide')).toBeTruthy();
    expect(screen.queryByText(/^Next:/)).toBeNull();
    unmount();

    serve(me(), contributions({ verified: 0, level: null, events: [] }));
    render(<ContributorSection onOpenEvent={vi.fn()} onAddAgain={vi.fn()} />, { wrapper: wrap });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/me/contributions', expect.anything()),
    );
    expect(screen.queryByText('Your contributions')).toBeNull();
  });

  it('asks for a name before switching the credit on, and switches it off at once', async () => {
    serve(me(), contributions());
    render(<ContributorSection onOpenEvent={vi.fn()} onAddAgain={vi.fn()} />, { wrapper: wrap });
    const box = (await screen.findByLabelText(/Show my name on events I add/)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    // No name yet: nothing is saved until one is given.
    expect(puts()).toEqual([]);
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name to show'), { target: { value: '  Ala ' } });
    fireEvent.click(save);
    expect(await screen.findByText('Shown as Ala.')).toBeTruthy();
    expect(puts()).toEqual([{ showName: true, displayName: 'Ala' }]);

    fireEvent.click(screen.getByLabelText(/Show my name on events I add/));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]).toEqual({ showName: false });
    await waitFor(() => expect(screen.queryByText('Shown as Ala.')).toBeNull());
  });
});

describe('after adding (M12 slice F)', () => {
  const after = (reward: Parameters<typeof AfterAdd>[0]['reward']) =>
    render(<AfterAdd reward={reward} onOpenAccount={vi.fn()} />, { wrapper: wrap });

  it('says what a reviewed event will earn, and shows the impact so far', async () => {
    serve(me(), contributions());
    after(null);
    expect(
      await screen.findByText('Once a moderator approves it, you earn 3 premium days.'),
    ).toBeTruthy();
    expect(await screen.findByText('See your impact')).toBeTruthy();
    expect(screen.getByText('Walked there')).toBeTruthy();
  });

  it("a trusted account's days: from the promotion's end, the cap, or a duplicate", async () => {
    serve(me(), contributions());
    const { unmount } = after({ kind: 'verified', days: 3, startsAt: '2099-12-01T00:00:00.000Z' });
    expect(await screen.findByText(/^\+3 premium days for this event, counting from/)).toBeTruthy();
    unmount();
    const capped = after({ kind: 'verified', days: 0, startsAt: null });
    expect(await screen.findByText(/You've earned this month's 30 premium days/)).toBeTruthy();
    capped.unmount();
    after({ kind: 'duplicate', days: 0, startsAt: null });
    expect(await screen.findByText(/already on the map, so no premium days/)).toBeTruthy();
  });

  it('shows the cap when this month is full, even before review', async () => {
    serve(me(), contributions({ monthDays: 30 }));
    after(null);
    expect(await screen.findByText(/You've earned this month's 30 premium days/)).toBeTruthy();
  });
});

describe('"Added by" on the card (M12 slice F)', () => {
  const event = (over: Partial<NearbyEvent> = {}) =>
    ({
      id: 'user:1',
      title: 'Courtyard jazz',
      description: null,
      categoryIds: [config.categories[0]!.id],
      startAt: '2026-11-07T18:00:00.000Z',
      endAt: '2026-11-07T20:00:00.000Z',
      endEstimated: false,
      timezone: 'Europe/Warsaw',
      venue: null,
      point: { lat: 51.11, lng: 17.03 },
      h3r9: 'x',
      priceMin: null,
      priceMax: null,
      currency: null,
      isFree: true,
      rules: {},
      entry: null,
      graceMin: null,
      ageMin: null,
      family: null,
      officialUrl: null,
      ticketUrl: null,
      imageUrl: null,
      status: 'scheduled',
      trust: 'community',
      confidence: 0.6,
      lastSeenAt: '2026-11-01T10:00:00.000Z',
      distanceM: 300,
      ...over,
    }) as NearbyEvent;
  const detail = (ev: NearbyEvent, loadCredit: ReturnType<typeof vi.fn>) =>
    render(
      <I18nProvider initial="en">
        <EventDetail
          ev={ev}
          loading={false}
          now={new Date('2026-11-01T12:00:00.000Z')}
          saved={false}
          onToggleSave={vi.fn()}
          onClose={vi.fn()}
          onReported={vi.fn()}
          onGo={vi.fn()}
          loadCredit={loadCredit as never}
        />
      </I18nProvider>,
    );

  it('shows the name and level for a community event whose adder turned it on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ added: 1 }, 202)),
    );
    const load = vi.fn(async () => ({ name: 'Ala', level: 'local' }));
    detail(event(), load);
    expect(await screen.findByText('Added by Ala · Local')).toBeTruthy();
    expect(load).toHaveBeenCalledWith('user:1', expect.any(AbortSignal));
  });

  it("doesn't ask for events from sources, and shows nothing when the credit is off", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ added: 1 }, 202)),
    );
    const load = vi.fn(async () => null);
    const { unmount } = detail(event({ trust: 'api' }), load);
    expect(load).not.toHaveBeenCalled();
    unmount();
    detail(event(), load);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByText(/^Added by/)).toBeNull();
  });
});

describe('restore trust (M12 slice F)', () => {
  it('posts the email, and says when no account has it', async () => {
    fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { email } = JSON.parse(String(init?.body));
      return email === 'ala@example.org' ? json({ ok: true }) : json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <I18nProvider initial="en">
        <RestoreTrustSheet onClose={vi.fn()} />
      </I18nProvider>,
    );
    const input = screen.getByLabelText('Email');
    fireEvent.change(input, { target: { value: 'nobody@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('No account with this email.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'ala@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Trust restored for ala@example.org.')).toBeTruthy();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/admin/trust');
  });
});

describe('level strings', () => {
  it('has every configured level in both languages', () => {
    for (const { id } of config.plans.contributions.levels) {
      expect(en).toHaveProperty(`level.${id}`);
      expect(pl).toHaveProperty(`level.${id}`);
    }
  });
});

describe('add again from the account card (M12 slice H)', () => {
  it('offers it on every event but a rejected or hidden one', async () => {
    serve(
      me(),
      contributions({
        events: [
          myEvent({ submissionId: 's3', title: 'Waiting one', status: 'pending', reward: null }),
          myEvent({ submissionId: 's2', title: 'Rejected one', status: 'rejected', reward: null }),
          myEvent({ submissionId: 's4', title: 'Hidden one', hidden: true }),
          myEvent(),
        ],
      }),
    );
    const onAgain = vi.fn();
    render(<ContributorSection onOpenEvent={vi.fn()} onAddAgain={onAgain} />, { wrapper: wrap });
    await screen.findByText('Your contributions');
    const again = screen.getAllByRole('button', { name: /^Add “.+” again$/ });
    expect(again.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Add “Waiting one” again',
      'Add “Courtyard jazz” again',
    ]);
    fireEvent.click(again[1]!);
    expect(onAgain).toHaveBeenCalledWith(myEvent().submissionId);
  });
});
