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
import { entitlementsFor, type NearbyEvent } from '@happow/core';
import {
  FollowedGroup,
  FollowedScreen,
  PerformerChips,
  SearchPanel,
} from '../src/components/Follow';
import { config } from '../src/config';
import { rowToEvent, type Row } from '../src/data/supabase';
import {
  follows,
  mergeFollows,
  parseNames,
  useFollowMatches,
  useFollowSync,
  type Follow,
} from '../src/follows';
import { I18nProvider } from '../src/i18n';
import { pinFeatures } from '../src/pins';

/** Search, follows on the device, ★, nationwide and sync in the app. */

const account = vi.hoisted(() => ({ status: 'signedOut' as string, plan: 'anonymous' as string }));
vi.mock('../src/account', () => ({
  useAccount: () => ({
    status: account.status,
    entitlements: entitlementsFor(config.plans, account.plan as 'account'),
  }),
}));
vi.mock('../src/auth', () => ({ accessToken: async () => 'user-token' }));

const NOW = new Date('2026-11-06T17:00:00Z');
const ui = (node: React.ReactNode) => render(<I18nProvider initial="en">{node}</I18nProvider>);

let calls: { url: string; body: Record<string, unknown> | null }[];
function server(answer: (url: string, body: Record<string, unknown> | null) => unknown) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url: String(input), body });
      return Response.json(answer(String(input), body));
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  follows.reset([]);
  account.status = 'signedOut';
  account.plan = 'anonymous';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('follows on the device', () => {
  it('adds once per normalised name, keeps the Ticketmaster id, removes with a tombstone', () => {
    expect(follows.add([{ name: 'Dawid Podsiadło', tmAttractionId: 'K8vZ9175Tr0' }])).toBe(1);
    expect(follows.add([{ name: ' dawid  podsiadlo ' }, { name: 'Kult' }])).toBe(1);
    expect(follows.list().map((f) => f.name)).toEqual(['Dawid Podsiadło', 'Kult']);
    expect(follows.list()[0]!.tmAttractionId).toBe('K8vZ9175Tr0');
    follows.toggle('KULT');
    expect(follows.isFollowed('Kult')).toBe(false);
    expect(follows.all().find((f) => f.norm === 'kult')?.removed).toBe(true);
    expect(JSON.parse(localStorage.getItem('happow:follows')!)).toHaveLength(2);
  });

  it('parses a pasted list, one per line, dropping noise', () => {
    expect(parseNames('Kult\n  Hey , Mela Koteluk\n\nx\n')).toEqual([
      'Kult',
      'Hey',
      'Mela Koteluk',
    ]);
  });

  it('caps the list at follows.max, newest kept', () => {
    const many: Follow[] = Array.from({ length: config.app.follows.max + 5 }, (_, i) => ({
      name: `Band ${i}`,
      norm: `band ${i}`,
      changedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const kept = mergeFollows([], many).filter((f) => !f.removed);
    expect(kept).toHaveLength(config.app.follows.max);
    expect(kept.some((f) => f.norm === 'band 0')).toBe(false);
  });

  it('never throws when storage is blocked', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => follows.add([{ name: 'Kult' }])).not.toThrow();
    set.mockRestore();
  });

  it('toggles from a performer chip on the card', () => {
    ui(<PerformerChips performers={[{ name: 'Kult' }, { name: 'Hey', externalId: 'K8' }]} />);
    const hey = screen.getByRole('button', { name: 'Follow Hey' });
    fireEvent.click(hey);
    expect(follows.list()).toEqual([
      expect.objectContaining({ name: 'Hey', tmAttractionId: 'K8' }),
    ]);
    expect(
      screen.getByRole('button', { name: 'Stop following Hey' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('the Followed screen adds pasted names and removes one', () => {
    ui(<FollowedScreen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Add artists'), {
      target: { value: 'Kult\nHey\nkult' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Follow 3' }));
    expect(screen.getByRole('status').textContent).toContain('Added: 2');
    fireEvent.click(screen.getByRole('button', { name: 'Stop following Hey' }));
    expect(follows.list().map((f) => f.name)).toEqual(['Kult']);
    // Signed out: alerts are explained, not offered.
    expect(screen.getByText(/Sign in \(premium\)/)).toBeTruthy();
  });
});

describe('matching and the ★', () => {
  const match = {
    id: 'tm:1',
    title: 'Dawid Podsiadło',
    categoryIds: ['music'],
    startAt: '2026-11-14T19:00:00Z',
    endAt: '2026-11-14T22:00:00Z',
    venueName: 'Hala Stulecia',
    point: { lat: 51.1069, lng: 17.0773 },
    distanceM: 2400,
    matchedPerformer: 'Dawid Podsiadło',
  };
  const elsewhere = {
    id: 'tm:2',
    performer: 'Dawid Podsiadło',
    title: 'Dawid Podsiadło – Trasa',
    startAt: '2026-12-05T19:00:00Z',
    localDate: '2026-12-05',
    city: 'Warszawa',
    venueName: 'PGE Narodowy',
    url: 'https://www.ticketmaster.pl/event/2001',
  };

  it('asks once on open with the names, then keeps the answer for the hour', async () => {
    follows.add([{ name: 'Dawid Podsiadło', tmAttractionId: 'K8vZ9175Tr0' }]);
    server(() => ({ matches: [match], nationwide: [elsewhere] }));
    const { result, unmount } = renderHook(() => useFollowMatches({ lat: 51.1, lng: 17.03 }));
    await waitFor(() => expect(result.current.matches).toHaveLength(1));
    expect(calls[0]!.url).toBe('/api/follows/match');
    expect(calls[0]!.body).toMatchObject({
      follows: [{ name: 'Dawid Podsiadło', tmAttractionId: 'K8vZ9175Tr0' }],
      regionId: 'wroclaw',
    });
    unmount();
    // A reload within the hour: the kept answer, no request.
    const again = renderHook(() => useFollowMatches(null));
    expect(again.result.current.nationwide).toHaveLength(1);
    await act(async () => {});
    expect(calls).toHaveLength(1);
  });

  it('puts "Followed" on top with the region’s dates and other cities linking out', () => {
    const onOpen = vi.fn();
    ui(
      <FollowedGroup
        matches={{ matches: [match], nationwide: [elsewhere] }}
        now={NOW}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Followed' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'An artist you follow' })).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe(elsewhere.url);
    expect(screen.getByText('Warszawa')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(onOpen).toHaveBeenCalledWith(match);
  });

  it('marks a followed event’s pin with the star', () => {
    const ev = { ...rowToEvent(row), followed: true } as NearbyEvent;
    const [f] = pinFeatures([{ key: 'a', kind: 'place', point: ev.point, events: [ev] }], {
      now: NOW,
      center: ev.point,
      radiusM: 500,
      selectedId: null,
    }).features;
    expect(f!.properties.starred).toBe(true);
  });

  it('reads performers from the snapshot (names) and the event (names and ids)', () => {
    expect(rowToEvent({ ...row, performers: ['Kult'] }).performers).toEqual([{ name: 'Kult' }]);
    expect(
      rowToEvent({ ...row, performers: [{ name: 'Hey', externalId: 'K8' }] }).performers,
    ).toEqual([{ name: 'Hey', externalId: 'K8' }]);
  });
});

describe('search in the list', () => {
  it('waits for 2 characters and 300 ms, then shows results by day; ♡ follows the match', async () => {
    server(() => ({
      results: [
        {
          id: 'tm:1',
          title: 'Trasa 2026',
          categoryIds: ['music'],
          startAt: '2026-11-14T19:00:00Z',
          endAt: '2026-11-14T22:00:00Z',
          venueName: 'Hala Stulecia',
          point: { lat: 51.1, lng: 17.07 },
          distanceM: 2400,
          isFree: false,
          status: 'scheduled',
          performers: ['Dawid Podsiadło'],
          matchedPerformer: 'Dawid Podsiadło',
          matchedExternalId: 'K8vZ9175Tr0',
          match: 'performer',
        },
      ],
    }));
    const onOpen = vi.fn();
    ui(
      <SearchPanel
        center={{ lat: 51.1, lng: 17.03 }}
        now={NOW}
        autoFocus
        onOpen={onOpen}
        onFollowed={() => {}}
      >
        <p>the usual list</p>
      </SearchPanel>,
    );
    const field = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.change(field, { target: { value: 'p' } });
    expect(screen.getByText('the usual list')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'podsiadlo' } });
    expect(await screen.findByText('Trasa 2026')).toBeTruthy();
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url, 'https://x');
    expect(u.pathname).toBe('/api/search');
    expect(u.searchParams.get('q')).toBe('podsiadlo');
    expect(u.searchParams.get('lat')).toBe('51.100');
    fireEvent.click(screen.getByRole('button', { name: 'Follow Dawid Podsiadło' }));
    expect(follows.list()[0]).toMatchObject({
      name: 'Dawid Podsiadło',
      tmAttractionId: 'K8vZ9175Tr0',
    });
    fireEvent.click(screen.getByText('Trasa 2026'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'tm:1' }));
  });

  it('says so when nothing is found', async () => {
    server(() => ({ results: [] }));
    ui(
      <SearchPanel
        center={null}
        now={NOW}
        autoFocus={false}
        onOpen={() => {}}
        onFollowed={() => {}}
      >
        <p>list</p>
      </SearchPanel>,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } });
    expect(await screen.findByText(/Nothing upcoming for “zzzz”/)).toBeTruthy();
  });
});

describe('synced follows', () => {
  it('syncs with premium and merges the account’s list', async () => {
    account.status = 'signedIn';
    account.plan = 'premium';
    follows.add([{ name: 'Kult' }]);
    server(() => ({
      items: [{ name: 'Hey', norm: 'hey', changedAt: '2026-11-05T10:00:00Z', removed: false }],
    }));
    renderHook(() => useFollowSync());
    await waitFor(() => expect(follows.list().map((f) => f.name)).toEqual(['Hey', 'Kult']));
    expect(calls[0]!.url).toBe('/api/me/follows');
    expect((calls[0]!.body!.items as { name: string }[])[0]!.name).toBe('Kult');
  });

  it('sends nothing without follows.sync', async () => {
    account.status = 'signedIn';
    account.plan = 'account';
    server(() => ({ items: [] }));
    renderHook(() => useFollowSync());
    await act(async () => {});
    expect(calls).toEqual([]);
  });
});

const row = {
  id: 'tm:1',
  title: 'Dawid Podsiadło',
  description: null,
  category_ids: ['music'],
  start_at: '2026-11-06T16:30:00Z',
  end_at: '2026-11-06T19:00:00Z',
  end_estimated: false,
  timezone: 'Europe/Warsaw',
  venue_id: 'v1',
  venue_name: 'Hala',
  venue_address: null,
  lat: 51.11,
  lng: 17.03,
  h3_r9: 'x',
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
} as Row;
