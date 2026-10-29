import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { AddEvent } from '../src/components/AddEvent';
import { config, region } from '../src/config';
import { formatTime } from '../src/format';
import { minutesBetween, nowInput, shiftInput } from '../src/formTime';
import { routeHref } from '../src/hooks/useHashRoute';
import { I18nProvider } from '../src/i18n';

/** M12 slice H: "happening here, now" (§4.3) and add again (§4.4). */

// The pin map needs WebGL, which jsdom lacks.
vi.mock('../src/components/PinMap', () => ({ PinMap: () => <div /> }));

const TOKEN = `x.${btoa(JSON.stringify({ email: 'ala@example.org' }))}.y`;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const me: Me = {
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
    events: { used: 0, limit: 10 },
    autofill: { used: 0, limit: 10 },
  },
};
const music = config.categories[0]!;
const HERE = { lat: 51.11, lng: 17.03 };
const SENT = {
  title: 'Pchli targ na podwórku',
  categoryIds: [music.id],
  venueName: 'Podwórko Nadodrze',
  address: 'Jedności Narodowej 1',
  point: { lat: 51.12, lng: 17.04 },
  start: '2026-11-07T10:00',
  end: '2026-11-07T14:00',
  isFree: false,
  priceMin: 10,
  currency: 'PLN',
  url: null,
  description: 'Co sobotę',
  ageMin: null,
  family: true,
  entry: 'open',
};

let fetchMock: ReturnType<typeof vi.fn>;
function serve(again: () => Response = () => ok({ form: SENT })) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return ok(me);
    if (url.startsWith('/api/me/submissions/')) return again();
    if (url === '/api/submissions') return ok({ id: 's9', eventId: null, status: 'pending' }, 201);
    return ok({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const sent = () =>
  JSON.parse(
    String((fetchMock.mock.calls.find(([u]) => u === '/api/submissions')![1] as RequestInit).body),
  ).event;

function renderAdd(props: { again?: string; here?: typeof HERE } = {}) {
  render(
    <I18nProvider initial="en">
      <AccountProvider>
        <AddEvent onClose={vi.fn()} onOpenEvent={vi.fn()} onOpenAccount={vi.fn()} {...props} />
      </AccountProvider>
    </I18nProvider>,
  );
}
const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const accept = () => fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }));

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.test');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
  sessionStorage.clear();
  signIn();
});
/** A session valid for an hour from now (after a fake clock is set, too). */
function signIn() {
  localStorage.setItem(
    'happow:session',
    JSON.stringify({
      accessToken: TOKEN,
      refreshToken: 'r1',
      expiresAt: Date.now() + 3_600_000,
      email: 'ala@example.org',
    }),
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('happening here, now (M12 §4.3)', () => {
  it('is offered only with a precise location', async () => {
    serve();
    renderAdd();
    await screen.findByText('Photo of a poster');
    expect(screen.queryByText('Happening here, now?')).toBeNull();
    cleanup();
    renderAdd({ here: HERE });
    expect(await screen.findByText('Happening here, now?')).toBeTruthy();
  });

  it('asks only the essentials and sends the pin, now and the category length', async () => {
    const at = new Date('2026-10-29T16:07:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
    signIn();
    serve();
    renderAdd({ here: HERE });
    fireEvent.click(await screen.findByRole('button', { name: 'Add it here' }));

    // Short form: no times, address, map or the rest until "More details".
    expect(screen.queryByText('Photo of a poster')).toBeNull();
    expect(screen.queryByLabelText(/^Starts/)).toBeNull();
    expect(screen.queryByText('Address')).toBeNull();
    const start = nowInput(region.timezone, config.app.submissions.quickAdd.roundMin, at);
    expect(start.endsWith(':05')).toBe(true);
    expect(
      screen.getByText(`Pin at your location · starts ${formatTime(`${start}:00Z`, 'UTC', 'en')}`),
    ).toBeTruthy();

    fireEvent.change(input(/^Title/), { target: { value: 'Jam na schodach' } });
    fireEvent.click(screen.getByRole('button', { name: music.labels.en }));
    fireEvent.change(input(/^Place/), { target: { value: 'Schody przy rynku' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Free' }));
    accept();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    await screen.findByText('Thanks! A moderator will check your event.');
    expect(sent()).toMatchObject({
      title: 'Jam na schodach',
      categoryIds: [music.id],
      venueName: 'Schody przy rynku',
      point: HERE,
      start,
      end: shiftInput(start, music.defaultDurationMin),
      isFree: true,
    });
  });

  it('opens the whole form, already filled in, with "More details"', async () => {
    serve();
    renderAdd({ here: HERE });
    fireEvent.click(await screen.findByRole('button', { name: 'Add it here' }));
    fireEvent.click(screen.getByRole('button', { name: music.labels.en }));
    fireEvent.click(screen.getByRole('button', { name: 'More details' }));
    const start = input(/^Starts/).value;
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(input(/^Ends/).value).toBe(shiftInput(start, music.defaultDurationMin));
    // An end set by hand stays put when the start moves.
    fireEvent.change(input(/^Ends/), { target: { value: shiftInput(start, 30) } });
    fireEvent.change(input(/^Starts/), { target: { value: shiftInput(start, 10) } });
    expect(input(/^Ends/).value).toBe(shiftInput(start, 30));
  });
});

describe('add again (M12 §4.4)', () => {
  it('copies the event but the date, and keeps its length for the new start', async () => {
    serve();
    renderAdd({ again: 'sub-1' });
    await waitFor(() => expect(input(/^Title/).value).toBe(SENT.title));
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/me/submissions/sub-1')).toBe(true);
    expect(
      screen.getByText(`Copied from “${SENT.title}”. Pick the new date and time.`),
    ).toBeTruthy();
    expect(screen.queryByText('Photo of a poster')).toBeNull();
    expect(input(/^Place/).value).toBe(SENT.venueName);
    expect(input(/^Starts/).value).toBe('');
    expect(input(/^Ends/).value).toBe('');

    fireEvent.change(input(/^Starts/), { target: { value: '2026-11-14T10:00' } });
    expect(input(/^Ends/).value).toBe('2026-11-14T14:00');
    accept();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    await screen.findByText('Thanks! A moderator will check your event.');
    expect(sent()).toMatchObject({
      title: SENT.title,
      start: '2026-11-14T10:00',
      end: '2026-11-14T14:00',
      priceMin: 10,
      family: true,
      entry: 'open',
    });
  });

  it("says so when the event can't be added again", async () => {
    serve(() => ok({ error: 'not_found' }, 404));
    renderAdd({ again: 'sub-x' });
    expect(await screen.findByText("This event can't be added again.")).toBeTruthy();
  });

  it('adds another date from the thanks screen, each its own submission', async () => {
    serve();
    renderAdd({ again: 'sub-1' });
    await waitFor(() => expect(input(/^Title/).value).toBe(SENT.title));
    fireEvent.change(input(/^Starts/), { target: { value: '2026-11-14T10:00' } });
    accept();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add another date' }));
    expect(input(/^Title/).value).toBe(SENT.title);
    expect(input(/^Starts/).value).toBe('');
    fireEvent.change(input(/^Starts/), { target: { value: '2026-11-21T10:00' } });
    expect(input(/^Ends/).value).toBe('2026-11-21T14:00');
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    await screen.findByText('Thanks! A moderator will check your event.');
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/submissions')).toHaveLength(2);
  });

  it('lives in the address, so Back works', () => {
    expect(routeHref({ name: 'add', again: 'a b' })).toBe('#/add?again=a%20b');
    expect(routeHref({ name: 'add' })).toBe('#/add');
  });
});

describe('form times', () => {
  it('rounds now down in the region and moves times on the clock', () => {
    // 16:07 UTC is 17:07 in Warsaw after the clocks went back.
    expect(nowInput('Europe/Warsaw', 5, new Date('2026-10-29T16:07:00Z'))).toBe('2026-10-29T17:05');
    expect(shiftInput('2026-10-29T23:30', 150)).toBe('2026-10-30T02:00');
    expect(minutesBetween('2026-11-07T10:00', '2026-11-07T14:00')).toBe(240);
    expect(minutesBetween('2026-11-07T10:00', null)).toBeNull();
    expect(minutesBetween('2026-11-07T10:00', '2026-11-07T09:00')).toBeNull();
  });
});
