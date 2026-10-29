import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterDay, entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import type { CodeRequest, Grant, ReadyEmail, SourceCandidate } from '../src/admin';
import { Moderation } from '../src/components/Moderation';
import { config, region } from '../src/config';
import { I18nProvider } from '../src/i18n';

const SUPABASE = 'https://auth.test';
const jwt = (email: string) => `x.${btoa(JSON.stringify({ email }))}.y`;

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | void;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
/** A fake API: `handler` answers the admin calls; /api/me and the queue have defaults. */
function serve(role: Me['role'], handler: Handler = () => undefined) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const answer = await handler(url, init);
    if (answer) return answer;
    if (url === '/api/me') return json(me(role));
    if (url === '/api/moderation')
      return json({ moderator: 'priam@example.org', submissions: [], reports: [] });
    if (url === '/api/admin/code-requests') return json([]);
    if (url === '/api/admin/grants') return json([]);
    if (url === '/api/admin/sources') return json([]);
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const calls = (url: string, method = 'GET') =>
  fetchMock.mock.calls.filter(([u, i]) => String(u) === url && (i?.method ?? 'GET') === method);

const me = (role: Me['role']): Me => ({
  id: 'u1',
  email: 'priam@example.org',
  role,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  plan: 'premium',
  planSource: 'early_access',
  planEndsAt: '2026-11-30T23:00:00.000Z',
  entitlements: entitlementsFor(config.plans, 'premium'),
  usage: {
    month: '2026-10',
    resetsAt: '2026-10-31T23:00:00.000Z',
    events: { used: 0, limit: 300 },
    autofill: { used: 0, limit: 300 },
  },
});

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const request = (over: Partial<CodeRequest> = {}): CodeRequest => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ala@example.org',
  locale: 'pl',
  createdAt: ago(180),
  generatedAt: null,
  existingUser: false,
  ...over,
});
const ready: ReadyEmail = {
  email: 'ala@example.org',
  locale: 'pl',
  code: '482913',
  link: 'https://auth.test/auth/v1/verify?token=t&type=magiclink',
  subject: 'Twój kod do Happow: 482913',
  body: 'Cześć!\n\nTwój kod logowania do Happow: 482913',
  mailto: 'mailto:ala%40example.org?subject=Tw%C3%B3j%20kod&body=Cze%C5%9B%C4%87!',
};
const grant = (over: Partial<Grant> = {}): Grant => ({
  id: '22222222-2222-4222-8222-222222222222',
  email: 'ala@example.org',
  plan: 'premium',
  source: 'manual',
  provider: null,
  startsAt: ago(60 * 24 * 10),
  endsAt: null,
  note: null,
  createdAt: ago(60 * 24 * 10),
  createdBy: 'priam@example.org',
  active: true,
  ...over,
});

function renderStaff() {
  return render(
    <I18nProvider initial="en">
      <AccountProvider>
        <Moderation onClose={vi.fn()} />
      </AccountProvider>
    </I18nProvider>,
  );
}
const openTab = async (name: RegExp) => fireEvent.click(await screen.findByRole('tab', { name }));

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(
    'happow:session',
    JSON.stringify({
      accessToken: jwt('priam@example.org'),
      refreshToken: 'r1',
      expiresAt: Date.now() + 3_600_000,
      email: 'priam@example.org',
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('the staff screen (M8 slice F)', () => {
  it('gives the admin tabs and the Admin title; a moderator sees only the queue', async () => {
    serve('admin', (url) =>
      url === '/api/admin/code-requests' ? json([request(), request({ id: 'x' })]) : undefined,
    );
    renderStaff();
    expect(await screen.findByRole('tab', { name: 'Codes 2' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Queue',
      'Codes 2',
      'Grants',
      'Sources',
      'Coverage',
    ]);
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Queue' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Codes 2' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Codes 2' }));
    expect(await screen.findAllByRole('article')).toHaveLength(2); // let the tab finish loading
    cleanup();

    serve('moderator');
    renderStaff();
    await screen.findByText('priam@example.org');
    await waitFor(() => expect(calls('/api/me')).toHaveLength(1));
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Moderation' })).toBeTruthy();
    expect(calls('/api/admin/code-requests')).toHaveLength(0);
    expect(calls('/api/admin/sources')).toHaveLength(0);
  });
});

describe('code requests (M8 slice F)', () => {
  it('lists requests with language, age, account and when a code was made', async () => {
    serve('admin', (url) =>
      url === '/api/admin/code-requests'
        ? json([
            request(),
            request({
              id: '33333333-3333-4333-8333-333333333333',
              email: 'sam@example.com',
              locale: 'en',
              createdAt: ago(12),
              generatedAt: ago(5),
              existingUser: true,
            }),
          ])
        : undefined,
    );
    renderStaff();
    await openTab(/Codes/);
    const [first, second] = await screen.findAllByRole('article');
    expect(first!.textContent).toContain('ala@example.org');
    expect(first!.textContent).toContain('PL');
    expect(first!.textContent).toContain('new account');
    expect(within(first!).getByRole('button', { name: 'Generate code' })).toBeTruthy();
    expect(second!.textContent).toContain('EN');
    expect(second!.textContent).toContain('has an account');
    expect(second!.textContent).toMatch(/code made at \d/);
    expect(within(second!).getByRole('button', { name: 'Generate again' })).toBeTruthy();
  });

  it('says so when nothing is waiting', async () => {
    serve('admin');
    renderStaff();
    await openTab(/Codes/);
    expect(await screen.findByText('No open requests')).toBeTruthy();
  });

  it('generates: the code, the email and its mailto, then the list refreshes', async () => {
    let made: string | null = null;
    serve('admin', (url, init) => {
      if (url.endsWith('/generate') && init?.method === 'POST') {
        made = new Date().toISOString();
        return json(ready);
      }
      if (url === '/api/admin/code-requests') return json([request({ generatedAt: made })]);
    });
    renderStaff();
    await openTab(/Codes/);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate code' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ready email' });
    // Large, in two groups for reading out; a screen reader hears it digit by digit.
    const code = within(sheet).getByText('4 8 2 9 1 3').parentElement!;
    expect(code.className).toBe('admin-code__num');
    expect(code.textContent).toBe('4829134 8 2 9 1 3');
    expect(sheet.textContent).toContain('Twój kod do Happow: 482913');
    expect(sheet.textContent).toContain('Cześć!');
    expect(within(sheet).getByRole('link', { name: 'Open in mail app' }).getAttribute('href')).toBe(
      ready.mailto,
    );
    expect(calls(`/api/admin/code-requests/${request().id}/generate`, 'POST')).toHaveLength(1);
    // The row behind now says a code exists.
    await waitFor(() => expect(screen.getByText(/code made at/)).toBeTruthy());
  });

  it('copies the email and the address; a refused clipboard says to press and hold', async () => {
    const writeText = vi.fn(async (_: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    serve('admin', (url, init) => {
      if (url.endsWith('/generate') && init?.method === 'POST') return json(ready);
      if (url === '/api/admin/code-requests') return json([request()]);
    });
    renderStaff();
    await openTab(/Codes/);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate code' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ready email' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy email' }));
    await within(sheet).findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenLastCalledWith(`${ready.subject}\n\n${ready.body}`);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('ala@example.org'));

    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy email' }));
    expect(await within(sheet).findByText('Press and hold to copy')).toBeTruthy();
    expect(window.getSelection()?.toString()).toContain('Cześć!');
  });

  it('deletes a request after the confirm', async () => {
    serve('admin', (url, init) => {
      if (url === `/api/admin/code-requests/${request().id}` && init?.method === 'DELETE')
        return new Response(null, { status: 204 });
      if (url === '/api/admin/code-requests') return json([request()]);
    });
    renderStaff();
    await openTab(/Codes/);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete this request?' });
    expect(calls(`/api/admin/code-requests/${request().id}`, 'DELETE')).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No open requests')).toBeTruthy();
    expect(calls(`/api/admin/code-requests/${request().id}`, 'DELETE')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Codes' })).toBeTruthy(); // no count left
  });

  it('shows a refused generate (502 auth_failed) in its row', async () => {
    serve('admin', (url, init) => {
      if (url.endsWith('/generate') && init?.method === 'POST')
        return json({ error: 'auth_failed' }, 502);
      if (url === '/api/admin/code-requests') return json([request()]);
    });
    renderStaff();
    await openTab(/Codes/);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate code' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Supabase refused (auth_failed)');
    expect(alert.closest('article')?.textContent).toContain('ala@example.org');
    expect(screen.queryByRole('dialog', { name: 'Ready email' })).toBeNull();
  });

  it('says when it is offline', async () => {
    serve('admin', (url) => {
      if (url === '/api/admin/code-requests') throw new TypeError('Failed to fetch');
    });
    renderStaff();
    await openTab(/Codes/);
    expect((await screen.findByRole('alert')).textContent).toBe('No connection. Try again.');
  });
});

describe('grants (M8 slice F)', () => {
  const ended = grant({
    id: '44444444-4444-4444-8444-444444444444',
    email: 'olek@example.org',
    source: 'trial',
    endsAt: ago(60 * 24 * 4),
    createdBy: null,
    active: false,
  });
  const lasting = grant({
    id: '55555555-5555-4555-8555-555555555555',
    email: 'jazz@example.com',
    note: 'Organiser: jazz club',
  });
  const bought = grant({
    id: '66666666-6666-4666-8666-666666666666',
    email: 'buyer@example.com',
    source: 'purchase',
    endsAt: afterDay('2098-12-31', region.timezone)!.toISOString(),
    createdBy: null,
  });

  it('lists the active grants before the ended ones; End only on active manual ones', async () => {
    // Newest first from the server, an ended one in the middle.
    serve('admin', (url) =>
      url === '/api/admin/grants' ? json([lasting, ended, bought]) : undefined,
    );
    renderStaff();
    await openTab(/Grants/);
    await screen.findByText('jazz@example.com');
    const cards = screen.getAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'jazz@example.com',
      'buyer@example.com',
      'olek@example.org',
    ]);
    expect(cards[0]!.textContent).toContain('Premium · manual · no end date');
    expect(cards[0]!.textContent).toContain('Organiser: jazz club');
    expect(cards[0]!.textContent).toContain('given by priam@example.org');
    expect(cards[1]!.textContent).toContain('purchase · until 31 Dec 2098');
    expect(cards[2]!.textContent).toMatch(/trial · ended \d/);
    expect(cards[2]!.className).toContain('mod-card--ended');
    expect(cards.map((c) => within(c).queryByRole('button', { name: 'End' }) !== null)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('gives premium to the end of a last day in the region, or with no end', async () => {
    const sent: unknown[] = [];
    serve('admin', (url, init) => {
      if (url === '/api/admin/grants' && init?.method === 'POST') {
        sent.push(JSON.parse(String(init.body)));
        return json(grant(), 201);
      }
    });
    renderStaff();
    await openTab(/Grants/);

    fireEvent.click(await screen.findByRole('button', { name: 'Give premium' }));
    let sheet = screen.getByRole('dialog', { name: 'Give premium' });
    const give = () => within(sheet).getByRole('button', { name: 'Give premium' });
    fireEvent.change(within(sheet).getByLabelText('Email'), {
      target: { value: 'ala@example.org' },
    });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Last day' }));
    // A day that has passed: said in the field, and the button stays off.
    fireEvent.change(within(sheet).getByLabelText('Last day of premium'), {
      target: { value: '2020-01-01' },
    });
    expect(within(sheet).getByText('That day has passed. Pick today or later.')).toBeTruthy();
    expect((give() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Last day of premium'), {
      target: { value: '2030-07-31' },
    });
    fireEvent.click(give());
    await waitFor(() => expect(sent).toHaveLength(1));
    const first = sent[0] as { email: string; endsAt: string };
    expect(Object.keys(first).sort()).toEqual(['email', 'endsAt']);
    expect(first.email).toBe('ala@example.org');
    // Midnight after the last day, in the region's time zone: premium works all of 31 July.
    const local = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: region.timezone,
        dateStyle: 'short',
        timeStyle: 'short',
        hourCycle: 'h23',
      }).format(d);
    expect(local(new Date(first.endsAt))).toBe('2030-08-01, 00:00');
    expect(local(new Date(Date.parse(first.endsAt) - 1))).toBe('2030-07-31, 23:59');
    // The list reloads after giving.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Give premium' })).toBeNull());
    await waitFor(() => expect(calls('/api/admin/grants')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Give premium' }));
    sheet = screen.getByRole('dialog', { name: 'Give premium' });
    fireEvent.change(within(sheet).getByLabelText('Email'), {
      target: { value: 'jazz@example.com' },
    });
    fireEvent.change(within(sheet).getByLabelText('Note (optional)'), {
      target: { value: 'Organiser' },
    });
    fireEvent.click(give());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ email: 'jazz@example.com', endsAt: null, note: 'Organiser' });
  });

  it('ends a grant only after the confirm', async () => {
    let gone = false;
    serve('admin', (url, init) => {
      if (url === `/api/admin/grants/${lasting.id}` && init?.method === 'DELETE') {
        gone = true;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/admin/grants')
        return json([gone ? { ...lasting, endsAt: ago(0), active: false } : lasting]);
    });
    renderStaff();
    await openTab(/Grants/);
    fireEvent.click(await screen.findByRole('button', { name: 'End' }));
    const confirm = screen.getByRole('alertdialog', { name: 'End premium?' });
    expect(confirm.textContent).toContain('jazz@example.com');
    expect(calls(`/api/admin/grants/${lasting.id}`, 'DELETE')).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: 'End premium' }));
    await screen.findByText('Ended (1)');
    expect(calls(`/api/admin/grants/${lasting.id}`, 'DELETE')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });
});

describe('sources (M12 slice C2)', () => {
  const candidate = (over: Partial<SourceCandidate> = {}): SourceCandidate => ({
    id: 1,
    regionId: 'wroclaw',
    venueName: 'Klub Przykładowy',
    url: 'https://klub.example/kalendarz.ics',
    kind: 'ical',
    eventCount: 7,
    sample: [
      { title: 'Koncert jesienny', start: '2026-10-31T19:00' },
      { title: 'Kiermasz płyt', start: '2026-11-07' },
      { title: 'Warsztaty', start: '2026-11-02T17:00:00.000Z' },
    ],
    status: 'new',
    failures: 0,
    lastError: null,
    foundAt: ago(60 * 48),
    decidedAt: null,
    decidedBy: null,
    lastRunAt: null,
    lastRunEvents: null,
    ...over,
  });
  const paused = candidate({
    id: 2,
    venueName: 'Biblioteka Przykładowa',
    status: 'paused',
    failures: 3,
    lastError: 'HTTP 503',
  });
  const reading = candidate({
    id: 3,
    venueName: 'Galeria Przykładowa',
    kind: 'jsonld',
    url: 'https://galeria.example/program/',
    status: 'accepted',
    lastRunAt: ago(90),
    lastRunEvents: 9,
  });
  const rejected = candidate({
    id: 4,
    venueName: 'Pub',
    status: 'rejected',
    decidedAt: ago(60 * 30),
  });
  const decisions: { id: string; action: string }[] = [];
  const list = () => json([candidate(), paused, reading, rejected]);
  function serveSources(status = 200) {
    decisions.length = 0;
    serve('admin', (url, init) => {
      if (url === '/api/admin/sources') return list();
      const m = /^\/api\/admin\/sources\/(\d+)$/.exec(url);
      if (m && init?.method === 'POST') {
        const { action } = JSON.parse(String(init.body)) as { action: string };
        decisions.push({ id: m[1]!, action });
        if (status !== 200) return json({ error: 'already_reviewed' }, status);
        const next = { accept: 'accepted', resume: 'accepted', restore: 'new' } as const;
        return json({ id: Number(m[1]), status: next[action as keyof typeof next] ?? 'rejected' });
      }
      return undefined;
    });
  }

  it('counts new finds on the tab and shows each with its samples', async () => {
    serveSources();
    renderStaff();
    await openTab(/^Sources/);
    expect(await screen.findByRole('tab', { name: 'Sources 1' })).toBeTruthy();
    const card = (await screen.findByRole('heading', { name: 'Klub Przykładowy' })).closest(
      'article',
    )!;
    const c = within(card as HTMLElement);
    expect(c.getByText('iCal')).toBeTruthy();
    expect(c.getByRole('link', { name: 'klub.example/kalendarz.ics' }).getAttribute('href')).toBe(
      'https://klub.example/kalendarz.ics',
    );
    expect(c.getByText(/iCal calendar · 7 upcoming events · found/)).toBeTruthy();
    expect(c.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      // Wall time, a date and an instant all read in the region's own clock.
      'Sat, Oct 31 7:00 PMKoncert jesienny',
      'Sat, Nov 7Kiermasz płyt',
      'Mon, Nov 2 6:00 PMWarsztaty',
    ]);
    expect(c.getByText('and 4 more')).toBeTruthy();
  });

  it('accepts without asking: the card stays, says when reading starts, and the count drops', async () => {
    serveSources();
    renderStaff();
    await openTab(/^Sources/);
    fireEvent.click(await screen.findByRole('button', { name: 'Read daily' }));
    expect(await screen.findByText('Read from the next run (once a day).')).toBeTruthy();
    expect(decisions).toEqual([{ id: '1', action: 'accept' }]);
    expect(screen.getByRole('tab', { name: 'Sources' })).toBeTruthy();
    // Changed its mind: stop reading moves it to Rejected.
    fireEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
    await waitFor(() => expect(decisions).toHaveLength(2));
    expect(decisions[1]).toEqual({ id: '1', action: 'stop' });
  });

  it('lists paused sites first in Read, with the error and Resume; Restore in Rejected', async () => {
    serveSources();
    renderStaff();
    await openTab(/^Sources/);
    fireEvent.click(await screen.findByRole('tab', { name: 'Read 2' }));
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Biblioteka Przykładowa', 'Galeria Przykładowa']);
    expect(screen.getByText('Paused after 3 failed runs: HTTP 503')).toBeTruthy();
    expect(screen.getByText(/event data on the page · last run: .* · 9 events/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(decisions).toEqual([{ id: '2', action: 'resume' }]));

    fireEvent.click(screen.getByRole('tab', { name: 'Rejected 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(decisions[1]).toEqual({ id: '4', action: 'restore' }));
  });

  it('reloads when someone else decided first, and says when nothing is new', async () => {
    serveSources(409);
    renderStaff();
    await openTab(/^Sources/);
    fireEvent.click(await screen.findByRole('button', { name: 'Read daily' }));
    await waitFor(() => expect(calls('/api/admin/sources').length).toBeGreaterThanOrEqual(3));
    cleanup();

    serve('admin');
    renderStaff();
    await openTab(/^Sources/);
    expect(await screen.findByText('Nothing new')).toBeTruthy();
  });
});
