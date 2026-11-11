import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { entitlementsFor, type NearbyEvent, type PlanEntry } from '@happow/core';
import { Agenda } from '../src/components/Agenda';
import { EveningQueue } from '../src/components/EveningQueue';
import { Going } from '../src/components/Going';
import { config } from '../src/config';
import type { EventRepository } from '../src/data';
import { rowToEvent, type EventRow as Row } from '@happow/core';
import { useMyEvents } from '../src/hooks/useMyEvents';
import { useView } from '../src/hooks/useView';
import { I18nProvider } from '../src/i18n';
import { eventsToIcs } from '../src/ics';
import { plans, usePlanSync } from '../src/plans';

/** Views, the agenda, the synced saved list and the evening queue. */

const account = vi.hoisted(() => ({ status: 'signedOut' as string, plan: 'anonymous' as string }));
vi.mock('../src/account', () => ({
  useAccount: () => ({
    status: account.status,
    entitlements: entitlementsFor(config.plans, account.plan as 'account'),
  }),
}));
vi.mock('../src/auth', () => ({ accessToken: async () => 'user-token' }));

const NOW = new Date('2026-11-06T17:00:00Z'); // Fri 18:00 in Wrocław

const ev = (id: string, start: string, end: string, over: Partial<Row> = {}): NearbyEvent =>
  rowToEvent({
    id,
    title: `Event ${id}`,
    description: null,
    category_ids: ['music'],
    start_at: start,
    end_at: end,
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
    last_seen_at: '2026-11-06T10:00:00Z',
    distance_m: 300,
    ...over,
  } as unknown as Row);

const ui = (node: React.ReactNode) => render(<I18nProvider initial="en">{node}</I18nProvider>);
const entry = (id: string, at: number, on = true, going = false): PlanEntry => ({
  id,
  on,
  going,
  at,
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

beforeEach(() => {
  localStorage.clear();
  plans.reset([]);
  account.status = 'signedOut';
  account.plan = 'anonymous';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the saved list on the device', () => {
  it('"I\'m going" also saves the event, and un-saving keeps going on the server', async () => {
    server((_, body) => ({
      counts: {},
      mine: { going: body.kind === 'going' && body.on === true },
      fromMyLinks: 0,
    }));
    ui(<Going ev={ev('x', '2026-11-06T19:00:00Z', '2026-11-06T21:00:00Z')} now={NOW} />);
    fireEvent.click(await screen.findByRole('button', { name: "I'm going" }));
    await waitFor(() => expect(plans.isGoing('x')).toBe(true));
    expect(plans.isSaved('x')).toBe(true);
    plans.toggle('x');
    expect(plans.isSaved('x')).toBe(false);
    expect(plans.isGoing('x')).toBe(false);
  });

  it('adopts an event marked going earlier, once', async () => {
    server(() => ({ counts: {}, mine: { going: true }, fromMyLinks: 0 }));
    ui(<Going ev={ev('old', '2026-11-06T19:00:00Z', '2026-11-06T21:00:00Z')} now={NOW} />);
    await waitFor(() => expect(plans.isGoing('old')).toBe(true));
    // Removed on purpose: opening the card again doesn't bring it back.
    plans.toggle('old');
    cleanup();
    ui(<Going ev={ev('old', '2026-11-06T19:00:00Z', '2026-11-06T21:00:00Z')} now={NOW} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect(plans.isSaved('old')).toBe(false);
  });
});

describe('views', () => {
  it('tap switches between everything and the last view; the choice is remembered', () => {
    const { result } = renderHook(() => useView());
    expect(result.current.view).toBe('all');
    expect(result.current.last).toBe('plans');
    act(() => result.current.toggle());
    expect(result.current.view).toBe('plans');
    act(() => result.current.choose('saved'));
    act(() => result.current.toggle());
    expect(result.current.view).toBe('all');
    act(() => result.current.toggle());
    expect(result.current.view).toBe('saved');
    const again = renderHook(() => useView());
    expect(again.result.current).toMatchObject({ view: 'saved', last: 'saved' });
  });
});

describe('your events by id', () => {
  it("reads them beyond the map's data, map copies first, and names the ones gone", async () => {
    const far = ev('far', '2026-12-20T18:00:00Z', '2026-12-20T20:00:00Z');
    const near = ev('near', '2026-11-06T19:00:00Z', '2026-11-06T21:00:00Z');
    let release: (v: NearbyEvent[]) => void = () => {};
    const byIds = vi.fn(
      (ids: readonly string[]) =>
        new Promise<NearbyEvent[]>((r) => {
          release = r;
          void ids;
        }),
    );
    const repo = { byIds } as unknown as EventRepository;
    const center = { lat: 51.1, lng: 17.03 };
    const known = [near];
    const { result } = renderHook(() =>
      useMyEvents(repo, ['near', 'far', 'hidden'], center, known, true),
    );
    expect(result.current.events.map((e) => e.id)).toEqual(['near']);
    expect(result.current.gone).toEqual([]);
    await act(async () => release([near, far]));
    expect(result.current.events.map((e) => e.id).sort()).toEqual(['far', 'near']);
    expect(result.current.gone).toEqual(['hidden']);
    expect(byIds.mock.calls[0]![0]).toEqual(['far', 'hidden', 'near']);
  });

  it("doesn't read while the view is everything", () => {
    const byIds = vi.fn(async () => []);
    renderHook(() =>
      useMyEvents({ byIds } as unknown as EventRepository, ['a'], { lat: 0, lng: 0 }, [], false),
    );
    expect(byIds).not.toHaveBeenCalled();
  });
});

describe('the agenda', () => {
  const list = [
    ev('tonight', '2026-11-06T19:00:00Z', '2026-11-06T21:00:00Z'),
    ev('later', '2026-11-06T21:30:00Z', '2026-11-06T23:00:00Z'),
    ev('sat', '2026-11-07T18:00:00Z', '2026-11-07T20:00:00Z', { status: 'cancelled' }),
    ev('past', '2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z'),
  ];

  it('lists days with headers, a going tag, cancelled marks and the past folded', () => {
    const onPlan = vi.fn();
    const onUnsave = vi.fn();
    const onRemoveGone = vi.fn();
    ui(
      <Agenda
        events={list}
        gone={['x1', 'x2']}
        now={NOW}
        isGoing={(id) => id === 'tonight'}
        onSelect={() => {}}
        onUnsave={onUnsave}
        onRemoveGone={onRemoveGone}
        onPlan={onPlan}
      />,
    );
    expect(screen.getByText('today')).toBeTruthy();
    expect(screen.getByText('tomorrow')).toBeTruthy();
    expect(screen.getByText('Going')).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('Past (1)')).toBeTruthy();
    expect(screen.getByText('2 saved events are no longer listed')).toBeTruthy();
    // Only today has two events: one "Plan the evening".
    const plan = screen.getAllByRole('button', { name: /Plan the evening/ });
    expect(plan).toHaveLength(1);
    fireEvent.click(plan[0]!);
    expect(onPlan).toHaveBeenCalledWith('2026-11-06');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Event later from saved' }));
    expect(onUnsave).toHaveBeenCalledWith('later');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemoveGone).toHaveBeenCalled();
  });

  it('tags an accepted invitation and offers no way to un-bookmark it', () => {
    ui(
      <Agenda
        events={list.slice(0, 2)}
        gone={[]}
        now={NOW}
        isGoing={() => false}
        isInvited={(id) => id === 'later'}
        onSelect={() => {}}
        onUnsave={() => {}}
        onRemoveGone={() => {}}
        onPlan={() => {}}
      />,
    );
    expect(screen.getByText('Invited')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Event later from saved' })).toBeNull();
    expect(screen.getByRole('button', { name: /Remove .* from saved/ })).toBeTruthy();
  });

  it('says how to start when nothing is saved', () => {
    ui(
      <Agenda
        events={[]}
        gone={[]}
        now={NOW}
        isGoing={() => false}
        onSelect={() => {}}
        onUnsave={() => {}}
        onRemoveGone={() => {}}
        onPlan={() => {}}
      />,
    );
    expect(screen.getByText('Nothing saved yet: tap the bookmark on an event')).toBeTruthy();
  });

  it('puts a whole day in one calendar file', () => {
    const ics = eventsToIcs(list.slice(0, 2), (e) => `https://happow.example/e/${e.id}`);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('URL:https://happow.example/e/later');
  });
});

describe('the evening queue', () => {
  const near = { lat: 51.1, lng: 17.03 };
  const km = { lat: 51.1 + 1 / 111.2, lng: 17.03 };
  const theatre = (id: string, start: string, end: string, p: typeof near) =>
    ev(id, start, end, { category_ids: ['theatre'], lat: p.lat, lng: p.lng });

  it('shows rounded walks and the verdict, and leaving earlier changes it', () => {
    ui(
      <EveningQueue
        day="today"
        events={[
          theatre('b', '2026-11-06T18:30:00Z', '2026-11-06T20:00:00Z', km),
          theatre('a', '2026-11-06T17:00:00Z', '2026-11-06T19:00:00Z', near),
        ]}
        onOpen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Evening: today')).toBeTruthy();
    expect(screen.getByText('about 20 min on foot')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Overlaps by 30 min');
    const earlier = screen.getByRole('button', { name: 'Leave 15 min earlier' });
    for (let i = 0; i < 4; i++) fireEvent.click(earlier);
    // Leaving at 19:00 local (18:00 UTC): 20 min walk, 10 min to spare.
    expect(screen.getByText('10 min to spare')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(JSON.parse(localStorage.getItem('happow:leaveAt')!)).toEqual({
      a: '2026-11-06T18:00:00.000Z',
    });
  });
});

describe('sync across devices', () => {
  it('nothing leaves the device without an account', async () => {
    server(() => ({ items: [] }));
    plans.toggle('a');
    renderHook(() => usePlanSync());
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });

  it("signed in, sends the device's list and keeps the merged one", async () => {
    account.status = 'signedIn';
    account.plan = 'account';
    const t = Date.now();
    plans.reset([entry('mine', t - 1000), entry('removed', t - 500, false)]);
    server(() => ({ items: [entry('mine', t - 1000), entry('other-phone', t - 100, true, true)] }));
    renderHook(() => usePlanSync());
    await waitFor(() => expect(plans.isGoing('other-phone')).toBe(true));
    expect(calls[0]!.path).toBe('me/saved');
    expect((calls[0]!.body.items as PlanEntry[]).map((e) => e.id)).toEqual(['mine', 'removed']);
    expect(plans.isSaved('mine')).toBe(true);
    // A removal the server didn't know about stays removed.
    expect(plans.isSaved('removed')).toBe(false);
  });

  it('sends a change after a short wait', async () => {
    account.status = 'signedIn';
    account.plan = 'account';
    server((_, body) => ({ items: body.items }));
    renderHook(() => usePlanSync());
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => plans.toggle('new'));
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 3000 });
    expect((calls[1]!.body.items as PlanEntry[]).map((e) => e.id)).toEqual(['new']);
  });
});
