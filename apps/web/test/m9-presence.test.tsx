import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lookAt } from '../src/attendance';
import { HereButton } from '../src/components/GoThere';
import { Going } from '../src/components/Going';
import { rowToEvent, type Row } from '../src/data/supabase';
import { I18nProvider } from '../src/i18n';

/** M9 slice F: co-presence (looking, on the way, here). */

vi.mock('maplibre-gl', () => ({ default: {} }));

const NOW = new Date('2026-10-31T19:00:00Z');
const event = (id: string, distance_m: number) =>
  rowToEvent({
    id,
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
    distance_m,
  } as unknown as Row);

const view = (counts: Record<string, number | null>, mine: Record<string, boolean> = {}) => ({
  counts: { going: null, looking: null, onway: null, here: null, ...counts },
  mine: { going: false, looking: false, onway: false, here: false, ...mine },
  fromMyLinks: 0,
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

describe('co-presence (M9 slice F)', () => {
  it('says "looking" for 30 minutes when a card opens, and not again right away', async () => {
    server(() => view({}));
    await lookAt('e-look', 30);
    expect(calls[0]).toMatchObject({
      path: 'attendance/set',
      body: { eventId: 'e-look', kind: 'looking', on: true, forSeconds: 1800 },
    });
    await lookAt('e-look', 30);
    expect(calls[1]!.path).toBe('attendance');
  });

  it('only reads the view when the "looking" signal is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/attendance/set'
          ? Response.json({ error: 'rate_limited' }, { status: 429 })
          : Response.json(view({ here: 5 })),
      ),
    );
    expect((await lookAt('e-refused', 30)).counts.here).toBe(5);
  });

  it('shows here, on the way and looking from the threshold up', async () => {
    server(() => view({ here: 10, onway: 5, looking: null }));
    ui(<Going ev={event('e-line', 2000)} now={NOW} />);
    expect(await screen.findByText('10+ here · 5+ on the way')).toBeTruthy();
    expect(screen.queryByText(/looking/)).toBeNull();
  });

  it('offers "I\'m here" only near a live event, as an explicit tap', async () => {
    server((_path, body) => view({}, { here: body.kind === 'here' && body.on === true }));
    ui(<Going ev={event('e-near', 60)} now={NOW} />);
    const here = await screen.findByRole('button', { name: "I'm here" });
    fireEvent.click(here);
    await waitFor(() => expect(here.getAttribute('aria-pressed')).toBe('true'));
    expect(calls.at(-1)!.body).toMatchObject({ kind: 'here', on: true });
    cleanup();
    ui(<Going ev={event('e-far', 900)} now={NOW} />);
    await waitFor(() => expect(calls.at(-1)!.body.eventId).toBe('e-far'));
    expect(screen.queryByRole('button', { name: "I'm here" })).toBeNull();
    cleanup();
    // Near, but not started yet.
    ui(<Going ev={event('e-early', 60)} now={new Date('2026-10-31T17:00:00Z')} />);
    await waitFor(() => expect(calls.at(-1)!.body.eventId).toBe('e-early'));
    expect(screen.queryByRole('button', { name: "I'm here" })).toBeNull();
  });

  it('asks on arrival in "Going there", and sends "here" only when tapped', async () => {
    server(() => view({}, { here: true }));
    ui(<HereButton eventId="e-arrive" />);
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: "I'm here" }));
    expect(await screen.findByText("I'm here ✓")).toBeTruthy();
    expect(calls[0]).toMatchObject({ path: 'attendance/set', body: { kind: 'here', on: true } });
  });
});
