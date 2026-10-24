import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { captureAuthRedirect, signInWithGoogle } from '../src/auth';
import { AddEvent } from '../src/components/AddEvent';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';

// The pin map needs WebGL; the form only needs a point.
vi.mock('../src/components/PinMap', () => ({ PinMap: () => <div /> }));

const SUPABASE = 'https://auth.test';
const TOKEN = `x.${btoa(JSON.stringify({ email: 'ala@example.org' }))}.y`;

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
function serve(handler: (url: string, init?: RequestInit) => Response) {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
}
const calls = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part));
const bearer = (part: string) =>
  (calls(part)[0]![1]!.headers as Record<string, string>).authorization;

type Use = { used: number; limit: number };
const me = (events: Use, autofill: Use, plan: 'account' | 'premium' = 'account'): Me => ({
  id: 'u1',
  email: 'ala@example.org',
  role: null,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  plan,
  planSource: plan === 'premium' ? 'early_access' : 'account',
  planEndsAt: plan === 'premium' ? '2026-11-30T23:00:00.000Z' : null,
  entitlements: entitlementsFor(config.plans, plan),
  // Midnight on 1 November, Warsaw time.
  usage: { month: '2026-10', resetsAt: '2026-10-31T23:00:00.000Z', events, autofill },
});

const signIn = () =>
  localStorage.setItem(
    'happow:session',
    JSON.stringify({
      accessToken: TOKEN,
      refreshToken: 'r1',
      expiresAt: Date.now() + 3_600_000,
      email: 'ala@example.org',
    }),
  );

const category = config.categories[0]!.id;
const prefill = {
  title: 'Garage sale',
  categoryIds: [category],
  start: '2026-10-25T10:00',
  end: null,
  venueName: 'Podwórko',
  address: 'Ruska 46',
  point: { lat: 51.11, lng: 17.03 },
  isFree: true,
  priceMin: null,
  currency: null,
  url: 'https://example.org/sale',
  ticketUrl: null,
  ageMin: null,
  family: null,
  entry: null,
};

function renderAdd(onClose = vi.fn()) {
  render(
    <I18nProvider initial="en">
      <AccountProvider>
        <AddEvent onClose={onClose} onOpenEvent={vi.fn()} />
      </AccountProvider>
    </I18nProvider>,
  );
  return onClose;
}

const meterText = () =>
  [...document.querySelectorAll('.meter')].map((m) => m.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the add form with accounts (M8 slice G)', () => {
  it('is switched on in config: an account is required and autofill comes with it', () => {
    expect(config.app.submissions.account).toBe('required');
    expect(config.app.submissions.autofill).toBe('account');
  });

  it('signed out: offers sign-in with what a free account gives; "Not now" closes', () => {
    serve(() => ok({}, 404));
    const onClose = renderAdd();
    const sheet = screen.getByRole('dialog', { name: 'Adding events needs an account' });
    expect(sheet.textContent).toContain('up to 15 events a month');
    expect(sheet.textContent).toContain('fill in 5 of them');
    expect(sheet.textContent).toContain('Send me a code');
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('goes straight on to the form after the code, while /api/me is still on its way', async () => {
    let answer: (r: Response) => void = () => {};
    serve((url, init) => {
      if (url === '/api/auth/code-request') return ok({ ok: true }, 202);
      if (url === `${SUPABASE}/auth/v1/verify`)
        return ok({ access_token: TOKEN, refresh_token: 'r2', expires_in: 3600 });
      return ok({}, 404);
    });
    const slow = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/me'
        ? new Promise<Response>((resolve) => (answer = resolve))
        : slow(input, init),
    );
    renderAdd();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'ala@example.org' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    });
    fireEvent.change(await screen.findByRole('textbox', { name: /code from the email/i }), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    // Neither the code sheet nor the signed-out sheet stays up while the account loads.
    expect(screen.queryByRole('dialog', { name: /enter your code|needs an account/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add event' })).toBeTruthy();
    await act(async () => answer(ok(me({ used: 0, limit: 15 }, { used: 0, limit: 5 }))));
    await waitFor(() => expect(meterText()).toEqual(['Events0 / 15', 'Autofill0 / 5']));
  });

  it('free account: both meters, no premium link, autofill with the token, usage reloaded', async () => {
    signIn();
    let fills = 1;
    serve((url) => {
      if (url === '/api/me') return ok(me({ used: 3, limit: 15 }, { used: fills, limit: 5 }));
      if (url === '/api/autofill') {
        fills += 1;
        return ok({ events: [prefill] });
      }
      return ok({}, 404);
    });
    renderAdd();
    await waitFor(() => expect(meterText()).toEqual(['Events3 / 15', 'Autofill1 / 5']));
    expect(screen.queryByRole('button', { name: /more with premium/i })).toBeNull();

    fireEvent.change(document.querySelector('.autofill input')!, {
      target: { value: 'https://example.org/sale' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fill from link' }));
    });
    expect(bearer('/api/autofill')).toBe(`Bearer ${TOKEN}`);
    await waitFor(() => expect(meterText()[1]).toBe('Autofill2 / 5'));
    expect((screen.getByDisplayValue('Garage sale') as HTMLInputElement).value).toBe('Garage sale');
  });

  it('autofill used up: the link is off, the form still works, and premium is one tap away', async () => {
    signIn();
    serve((url) =>
      url === '/api/me' ? ok(me({ used: 6, limit: 15 }, { used: 5, limit: 5 })) : ok({}, 404),
    );
    renderAdd();
    const notice = await screen.findByText(/Autofill is used up for this month/);
    expect(notice.textContent).toContain('1 November');
    expect(document.querySelector('.meter--out')?.textContent).toContain('from 1 November');
    expect((document.querySelector('.autofill input') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add event' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /more with premium/i }));
    expect(screen.getByRole('dialog', { name: 'Premium' }).textContent).toContain(
      '300 events a month',
    );
  });

  it('events used up: a notice with the reset date instead of the form', async () => {
    signIn();
    const onClose = vi.fn();
    serve((url) =>
      url === '/api/me' ? ok(me({ used: 20, limit: 15 }, { used: 5, limit: 5 })) : ok({}, 404),
    );
    renderAdd(onClose);
    const notice = await screen.findByText(
      /You've added 20 events this month; a free account adds 15/,
    );
    expect(notice.textContent).toContain('from 1 November');
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
    expect(screen.getByRole('button', { name: /more with premium/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('premium: the meters carry the mark, and a used-up premium quota has no premium link', async () => {
    signIn();
    serve((url) =>
      url === '/api/me'
        ? ok(me({ used: 300, limit: 300 }, { used: 4, limit: 300 }, 'premium'))
        : ok({}, 404),
    );
    renderAdd();
    const notice = await screen.findByText(/You've added 300 events this month/);
    expect(notice.textContent).not.toContain('free account');
    expect(document.querySelectorAll('.meter .premium-mark')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /more with premium/i })).toBeNull();
  });

  it('submits with the token; a quota used up meanwhile keeps the form and turns the button off', async () => {
    signIn();
    let used = 14;
    serve((url) => {
      if (url === '/api/me') return ok(me({ used, limit: 15 }, { used: 1, limit: 5 }));
      if (url === '/api/autofill') return ok({ events: [prefill] });
      if (url === '/api/submissions') {
        used = 15;
        return ok({ error: 'quota_exceeded', kind: 'events', limit: 15 }, 429);
      }
      return ok({}, 404);
    });
    renderAdd();
    await waitFor(() => expect(meterText()[0]).toBe('Events14 / 15'));
    fireEvent.change(document.querySelector('.autofill input')!, {
      target: { value: 'https://example.org/sale' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fill from link' }));
    });
    await screen.findByDisplayValue('Garage sale');
    fireEvent.click(screen.getByRole('checkbox', { name: /accept/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    });
    expect(bearer('/api/submissions')).toBe(`Bearer ${TOKEN}`);
    expect((await screen.findByRole('alert')).textContent).toContain('just ran out');
    await waitFor(() => expect(meterText()[0]).toContain('15 / 15'));
    // The form stays, with what was typed, rather than giving way to the used-up notice.
    expect(screen.getByDisplayValue('Garage sale')).toBeTruthy();
    expect((document.querySelector('.autofill input') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add event' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('Google started from the add form comes back to it', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    await signInWithGoogle('add');
    vi.unstubAllGlobals();
    serve(() => ok({ access_token: TOKEN, refresh_token: 'r2', expires_in: 3600 }));
    window.history.replaceState(null, '', '/?code=abc');
    expect(await captureAuthRedirect()).toBe(true);
    expect(window.location.hash).toBe('#/add');
    expect(sessionStorage.getItem('happow:land')).toBeNull();
  });
});
