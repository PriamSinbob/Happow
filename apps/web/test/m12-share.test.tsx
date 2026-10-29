import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { AddEvent } from '../src/components/AddEvent';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';
import { captureShare, parseShare, takeShare } from '../src/share';

// The pin map needs WebGL; the form only needs a point.
vi.mock('../src/components/PinMap', () => ({ PinMap: () => <div /> }));

const q = (s: string) => new URLSearchParams(s);

describe('reading a share (M12 slice D)', () => {
  it('takes the link from url, else the first link in the text', () => {
    expect(parseShare(q('url=https://bilety.example/e/1&title=Koncert'))).toEqual({
      link: 'https://bilety.example/e/1',
      title: 'Koncert',
    });
    // Android apps often send "text with a link" and no url.
    expect(
      parseShare(q(`text=${encodeURIComponent('Pchli targ w sobotę! https://fb.example/e/9.')}`)),
    ).toEqual({ link: 'https://fb.example/e/9', title: 'Pchli targ w sobotę!' });
    expect(parseShare(q('text=a https://one.example b https://two.example'))!.link).toBe(
      'https://one.example/',
    );
  });

  it('keeps a title without a link, ignores non-web links, and gives nothing for an empty share', () => {
    expect(parseShare(q('text=Kiermasz przy kościele, niedziela 10:00'))).toEqual({
      link: null,
      title: 'Kiermasz przy kościele, niedziela 10:00',
    });
    expect(parseShare(q('url=javascript:alert(1)&title=x'))).toEqual({ link: null, title: 'x' });
    expect(parseShare(q(''))).toBeNull();
    expect(parseShare(q(`title=${'a'.repeat(400)}`))!.title).toHaveLength(160);
  });

  it('on /share: keeps the share for the form once and leaves only /#/add in the address', () => {
    const replaceState = vi.fn();
    const at = (pathname: string, search: string) => ({ pathname, search }) as Location;
    expect(
      captureShare(at('/share', '?url=https%3A%2F%2Fa.example%2Fe&title=T'), {
        replaceState,
      } as unknown as History),
    ).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/add');
    expect(takeShare()).toEqual({ link: 'https://a.example/e', title: 'T' });
    expect(takeShare()).toBeNull();
    expect(captureShare(at('/', '?url=x'), { replaceState } as unknown as History)).toBe(false);
  });

  it('is the share target the manifest declares', () => {
    // Tests run from apps/web.
    const vite = readFileSync('vite.config.ts', 'utf8');
    expect(vite).toMatch(/share_target: \{\s*action: '\/share',\s*method: 'GET'/);
  });
});

const TOKEN = `x.${btoa(JSON.stringify({ email: 'ala@example.org' }))}.y`;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part));

const me = (autofillUsed: number): Me => ({
  id: 'u1',
  email: 'ala@example.org',
  role: null,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  plan: 'account',
  planSource: 'account',
  planEndsAt: null,
  entitlements: entitlementsFor(config.plans, 'account'),
  usage: {
    month: '2026-10',
    resetsAt: '2026-10-31T23:00:00.000Z',
    events: { used: 1, limit: 15 },
    autofill: { used: autofillUsed, limit: 5 },
  },
});
const prefill = {
  title: 'Garage sale',
  categoryIds: [config.categories[0]!.id],
  start: '2026-10-31T10:00',
  end: null,
  venueName: 'Podwórko',
  address: 'Ruska 46',
  point: { lat: 51.11, lng: 17.03 },
  isFree: true,
  priceMin: null,
  currency: null,
  url: 'https://bilety.example/e/1',
  ticketUrl: null,
  ageMin: null,
  family: null,
  entry: null,
};

function shareThenOpen(search: string, opts: { autofillUsed?: number; events?: unknown[] } = {}) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return ok(me(opts.autofillUsed ?? 1));
    if (url === '/api/autofill') return ok({ events: opts.events ?? [] });
    return ok({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  captureShare(
    { pathname: '/share', search } as Location,
    {
      replaceState: () => {},
    } as unknown as History,
  );
  render(
    <I18nProvider initial="en">
      <AccountProvider>
        <AddEvent onClose={vi.fn()} onOpenEvent={vi.fn()} onOpenAccount={vi.fn()} />
      </AccountProvider>
    </I18nProvider>,
  );
}
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

describe('the add form opened by a share (M12 slice D)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.test');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      'happow:session',
      JSON.stringify({
        accessToken: TOKEN,
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

  it('fills from the shared link straight away, once', async () => {
    shareThenOpen('?url=https%3A%2F%2Fbilety.example%2Fe%2F1&title=Bilety', { events: [prefill] });
    expect(await screen.findByText('From a shared link. Check what it filled in.')).toBeTruthy();
    await waitFor(() => expect(field('Title').value).toBe('Garage sale'));
    expect(calls('/api/autofill')).toHaveLength(1);
    expect(JSON.parse(String(calls('/api/autofill')[0]![1]!.body))).toMatchObject({
      url: 'https://bilety.example/e/1',
    });
    expect((screen.getAllByPlaceholderText('https://')[0] as HTMLInputElement).value).toBe(
      'https://bilety.example/e/1',
    );
  });

  it('keeps the link and the shared title when the page gives nothing (owner, 2026-10-28)', async () => {
    shareThenOpen(`?text=${encodeURIComponent('Pchli targ! https://insta.example/p/1')}`);
    await waitFor(() => expect(field('Title').value).toBe('Pchli targ!'));
    expect(field('Website or tickets (optional)').value).toBe('https://insta.example/p/1');
    expect(calls('/api/autofill')).toHaveLength(1);
  });

  it('spends no autofill when none is left: the link and title go straight into the form', async () => {
    shareThenOpen('?url=https%3A%2F%2Fbilety.example%2Fe%2F1&title=Koncert', { autofillUsed: 5 });
    await waitFor(() => expect(field('Title').value).toBe('Koncert'));
    expect(field('Website or tickets (optional)').value).toBe('https://bilety.example/e/1');
    expect(calls('/api/autofill')).toHaveLength(0);
  });
});
