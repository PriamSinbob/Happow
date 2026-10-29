import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, useAccount, type Me } from '../src/account';
import {
  accessToken,
  captureAuthRedirect,
  loadSession,
  requestCode,
  signInWithGoogle,
  verifyCode,
} from '../src/auth';
import { About } from '../src/components/About';
import { TermsSheet } from '../src/components/SignIn';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';

const SUPABASE = 'https://auth.test';
// A JWT whose payload carries the email (the signature is never checked here).
const jwt = (email: string) => `x.${btoa(JSON.stringify({ email }))}.y`;
const tokens = (email = 'ala@example.org', expiresIn = 3600) => ({
  access_token: jwt(email),
  refresh_token: `refresh-${Math.random()}`,
  expires_in: expiresIn,
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
function serve(handler: Handler) {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
}
const calls = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part));

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u1',
  email: 'ala@example.org',
  role: null,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  plan: 'premium',
  planSource: 'early_access',
  planEndsAt: '2026-11-30T23:00:00.000Z',
  entitlements: entitlementsFor(config.plans, 'premium'),
  usage: {
    month: '2026-10',
    resetsAt: '2026-10-31T23:00:00.000Z',
    events: { used: 3, limit: 300 },
    autofill: { used: 0, limit: 300 },
  },
  ...over,
});

const signIn = () =>
  localStorage.setItem(
    'happow:session',
    JSON.stringify({
      accessToken: jwt('ala@example.org'),
      refreshToken: 'r1',
      expiresAt: Date.now() + 3_600_000,
      email: 'ala@example.org',
    }),
  );

const atlas = {
  count: 3,
  cells: [],
  exportFile: vi.fn(async () => true),
  importFile: vi.fn(async () => 0),
  clear: vi.fn(async () => {}),
} as never;

function renderAbout() {
  const wrap = ({ children }: { children: ReactNode }) => (
    <I18nProvider initial="en">
      <AccountProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </AccountProvider>
    </I18nProvider>
  );
  return render(
    <About
      atlas={atlas}
      onClose={vi.fn()}
      onModerate={vi.fn()}
      onOpenEvent={vi.fn()}
      onAddAgain={vi.fn()}
    />,
    {
      wrapper: wrap,
    },
  );
}

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

describe('sign-in (M8 slice E)', () => {
  it('files a code request with manual delivery, then signs in with the code', async () => {
    serve((url, init) => {
      if (url === '/api/auth/code-request') return ok({ ok: true }, 202);
      if (url === `${SUPABASE}/auth/v1/verify`) {
        const b = JSON.parse(String(init?.body));
        return b.token === '123456' ? ok(tokens()) : ok({ error: 'otp_expired' }, 403);
      }
      return ok({}, 404);
    });
    expect(config.app.auth.emailDelivery).toBe('manual');
    await requestCode('ala@example.org', 'pl');
    expect(JSON.parse(String(calls('code-request')[0]![1]!.body))).toEqual({
      email: 'ala@example.org',
      locale: 'pl',
    });
    // Manual delivery never asks Supabase to send mail (its built-in SMTP is for team members).
    expect(calls('/auth/v1/otp')).toHaveLength(0);

    expect(await verifyCode('ala@example.org', '000000')).toBe(false);
    expect(loadSession()).toBeNull();
    expect(await verifyCode('ala@example.org', '123456')).toBe(true);
    expect(loadSession()?.email).toBe('ala@example.org');
    // Kept in localStorage, so an installed app stays signed in (M8 §2).
    expect(localStorage.getItem('happow:session')).toContain('ala@example.org');
  });

  it('starts Google with PKCE and exchanges the code that comes back', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    await signInWithGoogle();
    const to = new URL(assign.mock.calls[0]![0] as string);
    expect(to.origin + to.pathname).toBe(`${SUPABASE}/auth/v1/authorize`);
    expect(to.searchParams.get('provider')).toBe('google');
    expect(to.searchParams.get('code_challenge_method')).toBe('s256');
    const verifier = sessionStorage.getItem('happow:pkce')!;
    expect(verifier.length).toBeGreaterThan(40);
    vi.unstubAllGlobals();

    serve((url, init) => {
      if (url === `${SUPABASE}/auth/v1/token?grant_type=pkce`) {
        expect(JSON.parse(String(init?.body))).toEqual({
          auth_code: 'abc',
          code_verifier: verifier,
        });
        return ok(tokens('ola@example.org'));
      }
      return ok({}, 404);
    });
    window.history.replaceState(null, '', '/?code=abc');
    expect(await captureAuthRedirect()).toBe(true);
    expect(loadSession()?.email).toBe('ola@example.org');
    // The code leaves the URL at once, and the app opens on About.
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/about');
    expect(sessionStorage.getItem('happow:pkce')).toBeNull();
  });

  it('takes the tokens from a code email link out of the URL', async () => {
    const t = tokens('ela@example.org');
    window.history.replaceState(
      null,
      '',
      `/#access_token=${t.access_token}&refresh_token=r9&expires_in=3600&type=magiclink`,
    );
    expect(await captureAuthRedirect()).toBe(true);
    expect(loadSession()?.email).toBe('ela@example.org');
    expect(window.location.hash).toBe('#/about');
  });

  it('refreshes once for parallel callers, and signs out only when the token is refused', async () => {
    localStorage.setItem(
      'happow:session',
      JSON.stringify({ accessToken: 'old', refreshToken: 'r1', expiresAt: 0, email: null }),
    );
    serve(() => ok(tokens()));
    const [a, b] = await Promise.all([accessToken(), accessToken()]);
    expect(a).toBe(b);
    expect(calls('grant_type=refresh_token')).toHaveLength(1);

    localStorage.setItem(
      'happow:session',
      JSON.stringify({ accessToken: 'old', refreshToken: 'r2', expiresAt: 0, email: null }),
    );
    serve(() => ok({}, 503));
    expect(await accessToken()).toBeNull();
    expect(loadSession()).not.toBeNull(); // offline or a server error: still signed in
    serve(() => ok({ error: 'invalid_grant' }, 400));
    expect(await accessToken()).toBeNull();
    expect(loadSession()).toBeNull();
  });
});

describe('About with an account (M8 slice E)', () => {
  it('signed out: a sign-in card, the presets anyone may use, no atlas export', () => {
    serve(() => ok({}, 404));
    renderAbout();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getAllByRole('radio', { name: /violet|mono|tally red|magenta/i })).toHaveLength(
      2,
    );
    expect(screen.queryByRole('button', { name: /save my places/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Moderation' })).toBeNull();
  });

  it('opens the sign-in sheet with the email code (Google waits for its setup)', () => {
    serve(() => ok({}, 404));
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign in' });
    expect(dialog.textContent).toContain('Send me a code');
    expect(config.app.auth.providers).toEqual([]);
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull();
  });

  it('early-access premium: plan with its last day, all colours, export and import', async () => {
    signIn();
    serve((url) => (url === '/api/me' ? ok(me()) : ok({}, 404)));
    renderAbout();
    await screen.findByText('ala@example.org');
    expect(screen.getByText(/Premium until 30 Nov 2026 · early access/)).toBeTruthy();
    // By tier, so the free presets keep the first row of the 2 × 2 grid.
    expect(
      screen
        .getAllByRole('radio', { name: /violet|mono|tally red|magenta/i })
        .map((r) => r.textContent),
    ).toEqual(['Violet', 'Mono', 'Tally red', 'Magenta']);
    expect(screen.getByRole('button', { name: /save my places/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /add places/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get my data' })).toBeTruthy();
  });

  it('free account: usage on the card, Magenta opens the premium sheet', async () => {
    signIn();
    serve((url) =>
      url === '/api/me'
        ? ok(
            me({
              plan: 'account',
              planSource: 'account',
              planEndsAt: null,
              entitlements: entitlementsFor(config.plans, 'account'),
              usage: { ...me().usage, events: { used: 3, limit: 15 } },
            }),
          )
        : ok({}, 404),
    );
    renderAbout();
    await screen.findByText(/Free account · Events 3 \/ 15 this month/);
    fireEvent.click(screen.getByRole('radio', { name: /magenta/i }));
    const sheet = screen.getByRole('dialog', { name: 'Premium' });
    expect(sheet.textContent).toContain('300 events a month');
    expect(sheet.textContent).toContain('not on sale yet');
    // Tally red comes with any account.
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('radio', { name: /tally red/i }));
    expect(document.documentElement.dataset.preset).toBe('red');
  });

  it('shows Moderation only to staff', async () => {
    signIn();
    serve((url) => (url === '/api/me' ? ok(me({ role: 'moderator' })) : ok({}, 404)));
    renderAbout();
    expect(await screen.findByRole('button', { name: 'Moderation' })).toBeTruthy();
  });

  it('deletes the account after a confirmation and signs out', async () => {
    signIn();
    serve((url, init) => {
      if (url === '/api/me' && init?.method === 'DELETE') return ok({ ok: true });
      if (url === '/api/me') return ok(me());
      return ok({}, 404);
    });
    renderAbout();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete your account?' });
    fireEvent.click(dialog.querySelector('.btn--danger')!);
    await screen.findByRole('button', { name: 'Sign in' });
    expect(loadSession()).toBeNull();
    expect(calls('/api/me').some(([, i]) => i?.method === 'DELETE')).toBe(true);
  });
});

describe('the account terms (M8 slice E)', () => {
  it('asks once per terms version and saves the acceptance', async () => {
    signIn();
    let accepted: string | null = null;
    serve((url, init) => {
      if (url === '/api/me' && init?.method === 'PUT') {
        accepted = JSON.parse(String(init.body)).termsVersion;
        return ok({ ok: true });
      }
      if (url === '/api/me') return ok(me({ termsVersion: accepted }));
      return ok({}, 404);
    });
    function Gate() {
      return (
        <I18nProvider initial="en">
          <AccountProvider>
            <Terms />
          </AccountProvider>
        </I18nProvider>
      );
    }
    function Terms() {
      return useAccount().needsTerms ? <TermsSheet /> : <p>no terms</p>;
    }
    render(<Gate />);
    const sheet = await screen.findByRole('dialog', { name: 'Welcome to Happow' });
    expect(sheet.textContent).toContain('15 events a month, 5 with autofill');
    expect(sheet.textContent).toContain('premium until 30 Nov 2026');
    const done = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(done);
    });
    await waitFor(() => expect(screen.getByText('no terms')).toBeTruthy());
    expect(accepted).toBe(config.app.legal.termsVersion);
  });
});
