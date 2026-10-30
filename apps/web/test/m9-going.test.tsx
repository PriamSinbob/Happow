import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { arrivalToken, captureArrival } from '../src/attendance';
import { Going } from '../src/components/Going';
import { ShareSheet } from '../src/components/ShareSheet';
import { rowToEvent, type Row } from '../src/data/supabase';
import { I18nProvider } from '../src/i18n';

/** M9 slice E: "I'm going" and the sharer's link count. */

const ev = rowToEvent({
  id: 'ticketmaster:Z7',
  title: 'Koncert',
  description: null,
  category_ids: ['music'],
  start_at: '2026-10-31T18:00:00Z',
  end_at: '2026-10-31T20:30:00Z',
  end_estimated: false,
  timezone: 'Europe/Warsaw',
  venue_id: 'v1',
  venue_name: 'Klub',
  venue_address: null,
  lat: 51.11,
  lng: 17.03,
  price_min: null,
  price_max: null,
  currency: null,
  is_free: true,
  rules: {},
  official_url: null,
  ticket_url: null,
  image_url: null,
  status: 'scheduled',
  trust: 'api',
  confidence: 1,
  last_seen_at: '2026-10-30T10:00:00Z',
  distance_m: 300,
} as unknown as Row);

const NOW = new Date('2026-10-30T12:00:00Z');

const view = (going: number | null, mine: boolean, fromMyLinks: number | null = 0) => ({
  counts: { going, looking: null, onway: null, here: null },
  mine: { going: mine, looking: false, onway: false, here: false },
  fromMyLinks,
});

let calls: { path: string; body: Record<string, unknown> }[];
function server(answer: (path: string, body: Record<string, unknown>) => unknown) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace('/api/', '');
      const body = JSON.parse(String(init.body ?? '{}'));
      calls.push({ path, body });
      return Response.json(answer(path, body));
    }),
  );
}

const ui = (node: React.ReactNode) => render(<I18nProvider initial="en">{node}</I18nProvider>);

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('arriving through a shared link (M9 slice E)', () => {
  it('remembers the token for that event and takes it out of the address', () => {
    window.history.replaceState(null, '', '/?s=tok_ABCDEFGH#/e/ticketmaster%3AZ7');
    captureArrival();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/e/ticketmaster%3AZ7');
    expect(arrivalToken('ticketmaster:Z7')).toBe('tok_ABCDEFGH');
    // A later link for the same event doesn't replace the first.
    window.history.replaceState(null, '', '/?s=other_TOKEN1#/e/ticketmaster%3AZ7');
    captureArrival();
    expect(arrivalToken('ticketmaster:Z7')).toBe('tok_ABCDEFGH');
  });

  it('ignores a malformed token but still cleans the address', () => {
    window.history.replaceState(null, '', '/?s=<x>&keep=1#/e/a');
    captureArrival();
    expect(window.location.search).toBe('?keep=1');
    expect(arrivalToken('a')).toBeNull();
  });
});

describe("I'm going (M9 slice E)", () => {
  it('shows no count below the threshold, and marks and unmarks with one tap', async () => {
    // Opening the card says "looking" (slice F); only "going" changes the going count here.
    server((_path, body) =>
      body.kind === 'going' ? view(5, body.on as boolean) : view(null, false),
    );
    ui(<Going ev={ev} now={NOW} />);
    const btn = await screen.findByRole('button', { name: "I'm going" });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(/\+ going/)).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByText('5+ going')).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({
      path: 'attendance/set',
      body: { eventId: ev.id, kind: 'going', on: true },
    });
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    expect(calls.at(-1)!.body.on).toBe(false);
  });

  it('counts for whoever shared the link this device came with', async () => {
    window.history.replaceState(null, '', '/?s=tok_ABCDEFGH#/e/ticketmaster%3AZ7');
    captureArrival();
    server(() => view(null, false));
    ui(<Going ev={ev} now={NOW} />);
    fireEvent.click(await screen.findByRole('button', { name: "I'm going" }));
    await waitFor(() => expect(calls.at(-1)!.path).toBe('attendance/set'));
    expect(calls.at(-1)!.body.token).toBe('tok_ABCDEFGH');
  });

  it("tells a sharer how many came through their link, with the language's plural", async () => {
    server(() => view(10, true, 3));
    ui(<Going ev={ev} now={NOW} />);
    expect(await screen.findByText('3 people from your link are going')).toBeTruthy();
    expect(screen.getByText('10+ going')).toBeTruthy();
    cleanup();
    server(() => view(null, false, 1));
    render(
      <I18nProvider initial="pl">
        <Going ev={ev} now={NOW} />
      </I18nProvider>,
    );
    expect(await screen.findByText('1 osoba z Twojego linku idzie')).toBeTruthy();
  });

  it('shares links that carry this device’s token, made once per event', async () => {
    server((path) => (path === 'share' ? { token: 'mytoken_123' } : {}));
    const url = 'https://happow.example/e/ticketmaster%3AZ7';
    ui(<ShareSheet ev={ev} url={url} onClose={() => {}} onToast={() => {}} />);
    expect(await screen.findByText(`${url}?s=mytoken_123`)).toBeTruthy();
    cleanup();
    ui(<ShareSheet ev={ev} url={url} onClose={() => {}} onToast={() => {}} />);
    expect(await screen.findByText(`${url}?s=mytoken_123`)).toBeTruthy();
    expect(calls.filter((c) => c.path === 'share')).toHaveLength(1);
  });
});
