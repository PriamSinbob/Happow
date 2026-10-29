import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { AddEvent } from '../src/components/AddEvent';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';
import { fitWithin, shrinkPhoto } from '../src/photo';

// The pin map needs WebGL; jsdom has no canvas, so the shrinking itself is faked here and its
// sizing is tested on its own.
vi.mock('../src/components/PinMap', () => ({ PinMap: () => <div /> }));
vi.mock('../src/photo', async (actual) => ({
  ...(await actual<typeof import('../src/photo')>()),
  shrinkPhoto: vi.fn(async () => ({ data: 'SMALLJPEG', mediaType: 'image/jpeg' })),
}));

const TOKEN = `x.${btoa(JSON.stringify({ email: 'ala@example.org' }))}.y`;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
function serve(photo: () => Response, used = 0) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/autofill/photo') return photo();
    if (url === '/api/me') return ok(me(used));
    return ok({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const me = (autofillsUsed: number): Me => ({
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
    autofill: { used: autofillsUsed, limit: 10 },
  },
});

const event = (title: string) => ({
  title,
  categoryIds: [config.categories[0]!.id],
  start: '2026-11-07T19:00',
  end: null,
  venueName: 'Podwórko Nadodrze',
  address: 'Jedności Narodowej 1',
  point: { lat: 51.12, lng: 17.04 },
  isFree: true,
  priceMin: null,
  currency: null,
  url: null,
  ticketUrl: null,
  ageMin: null,
  family: null,
  entry: null,
});

function renderAdd() {
  render(
    <I18nProvider initial="en">
      <AccountProvider>
        <AddEvent onClose={vi.fn()} onOpenEvent={vi.fn()} onOpenAccount={vi.fn()} />
      </AccountProvider>
    </I18nProvider>,
  );
}
const pick = async () => {
  const input = (await screen.findByText('Photo of a poster')).parentElement!.querySelector(
    'input[type=file]',
  ) as HTMLInputElement;
  const file = new File(['x'], 'poster.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
  return { input, file };
};
const sent = () =>
  JSON.parse(
    String(
      (fetchMock.mock.calls.find(([u]) => u === '/api/autofill/photo')![1] as RequestInit).body,
    ),
  );

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

describe('poster photo (M12 slice G)', () => {
  it('sends the shrunk photo and fills the form from the one event found', async () => {
    serve(() => ok({ method: 'llm', url: null, events: [event('Jazz na podwórku')] }));
    renderAdd();
    const { file } = await pick();
    await waitFor(() =>
      expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Jazz na podwórku'),
    );
    expect(shrinkPhoto).toHaveBeenCalledWith(file);
    expect(sent()).toEqual({
      image: 'SMALLJPEG',
      mediaType: 'image/jpeg',
      regionId: config.regions[0]!.id,
    });
  });

  it('offers a choice when the poster holds several events, and says when it holds none', async () => {
    serve(() => ok({ method: 'llm', url: null, events: [event('Day one'), event('Day two')] }));
    renderAdd();
    await pick();
    expect(await screen.findByText('Day two')).toBeTruthy();
    cleanup();

    serve(() => ok({ method: 'none', url: null, events: [] }));
    renderAdd();
    await pick();
    expect(await screen.findByText(/Couldn't read an event from this photo/)).toBeTruthy();
  });

  it('says plainly when reading photos is unavailable', async () => {
    serve(() => ok({ error: 'photo_unavailable' }, 503));
    renderAdd();
    await pick();
    expect(await screen.findByText(/Reading photos isn't available right now/)).toBeTruthy();
  });

  it('is off once the month’s autofills are used up', async () => {
    serve(() => ok({}), 10);
    renderAdd();
    await waitFor(() =>
      expect(
        (
          screen
            .getByText('Photo of a poster')
            .parentElement!.querySelector('input[type=file]') as HTMLInputElement
        ).disabled,
      ).toBe(true),
    );
  });
});

describe('fitting a photo', () => {
  it('shrinks the long edge to the limit and never enlarges', () => {
    expect(fitWithin(4032, 3024, 1568)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(3024, 4032, 1568)).toEqual({ width: 1176, height: 1568 });
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });
});
