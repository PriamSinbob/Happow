import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlementsFor, type NearbyEvent } from '@happow/core';
import { AccountProvider, type Me } from '../src/account';
import { FriendsLine } from '../src/components/FriendsLine';
import { OrganiserPanel } from '../src/components/OrganiserPanel';
import { PrivatePanel } from '../src/components/PrivatePanel';
import { config } from '../src/config';
import { adoptContactPath } from '../src/hooks/useHashRoute';
import { I18nProvider } from '../src/i18n';
import { invitations } from '../src/invitations';
import { pinFeatures } from '../src/pins';
import {
  captureInvite,
  fetchPrivateEvent,
  hasNews,
  inviteToken,
  privateEvents,
  refreshPrivate,
  rowToPrivate,
  type PrivateEvent,
} from '../src/private';

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

const me = (extra: Partial<Me> = {}): Me => ({
  id: 'u1',
  email: 'ala@example.org',
  role: null,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  plan: 'account',
  planSource: 'account',
  planEndsAt: null,
  displayName: 'Ala',
  entitlements: entitlementsFor(config.plans, 'account'),
  usage: {
    month: '2026-11',
    resetsAt: '2026-11-30T23:00:00.000Z',
    events: { used: 0, limit: 15 },
    autofill: { used: 0, limit: 5 },
    private: { used: 0, limit: 1 },
  },
  ...extra,
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

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'Urodziny Ali',
  description: null,
  category_ids: ['music'],
  start_at: '2026-11-07T18:00:00Z',
  end_at: '2026-11-07T22:00:00Z',
  end_estimated: false,
  timezone: 'Europe/Warsaw',
  venue_id: 'v1',
  venue_name: 'U Ali',
  venue_address: null,
  lat: 51.11,
  lng: 17.03,
  h3_r9: 'x',
  price_min: 0,
  price_max: 0,
  currency: null,
  is_free: true,
  rules: {},
  official_url: null,
  ticket_url: null,
  status: 'scheduled',
  trust: 'community',
  confidence: 1,
  last_seen_at: '2026-11-04T18:00:00Z',
  distance_m: 300,
  visibility: 'private',
  mine: false,
  owner_name: 'Ola',
  invitation: { id: 'i1', status: 'pending', seenAt: null },
  changed_at: null,
  last_post_at: null,
  ...extra,
});

function wrap(node: React.ReactNode) {
  return render(
    <I18nProvider initial="en">
      <AccountProvider>{node}</AccountProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  privateEvents.set([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('private events in the app', () => {
  it('reads them signed in, and feeds My plans and Private', async () => {
    signIn();
    serve((url) =>
      url.startsWith('/api/private')
        ? ok({
            events: [
              row('p1'),
              row('p2', { mine: true, invitation: null }),
              row('p3', { invitation: { id: 'i3', status: 'accepted', seenAt: null } }),
            ],
          })
        : ok({}, 404),
    );
    await refreshPrivate({ lat: 51.1, lng: 17.03 });
    expect(calls('/api/private')[0]![0]).toBe('/api/private?lat=51.10000&lng=17.03000');
    expect(invitations.accepted()).toEqual([
      { id: 'p1', private: true, status: 'pending' },
      { id: 'p2', private: true, status: 'owner' },
      { id: 'p3', private: true, status: 'accepted' },
    ]);
    privateEvents.clear();
    expect(invitations.accepted()).toEqual([]);
  });

  it('signed out, nothing is read and nothing stays', async () => {
    serve(() => ok({}, 500));
    privateEvents.set([rowToPrivate(row('p1') as never)]);
    await refreshPrivate(null);
    expect(privateEvents.list()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an invite link for its event, out of the address, and opens the event with it', async () => {
    window.history.replaceState(null, '', '/?i=abcdefghijklmnopqrstuv#/e/p1');
    captureInvite();
    expect(window.location.search).toBe('');
    expect(inviteToken('p1')).toBe('abcdefghijklmnopqrstuv');
    serve((url) =>
      url.startsWith('/api/private/p1') ? ok({ event: row('p1', { link: true }) }) : ok({}, 404),
    );
    const ev = await fetchPrivateEvent('p1', null);
    expect(calls('/api/private/p1')[0]![0]).toBe('/api/private/p1?i=abcdefghijklmnopqrstuv');
    expect(ev).toMatchObject({ id: 'p1', link: true, visibility: 'private' });
  });

  it('marks changes since the invitee last opened it, and puts a lock on its pin', () => {
    const e = rowToPrivate(
      row('p1', {
        invitation: { id: 'i', status: 'accepted', seenAt: '2026-11-04T10:00:00Z' },
        changed_at: '2026-11-04T12:00:00Z',
      }) as never,
    );
    expect(hasNews(e)).toBe(true);
    expect(hasNews({ ...e, changedAt: '2026-11-04T09:00:00Z' })).toBe(false);
    const pins = pinFeatures([{ key: 'k', kind: 'place', point: e.point, events: [e] }], {
      now: new Date('2026-11-04T12:00:00Z'),
      center: e.point,
      radiusM: 500,
      selectedId: null,
    });
    expect(pins.features[0]!.properties.locked).toBe(true);
  });

  it('turns /c/<token> into the contact route', () => {
    window.history.replaceState(null, '', '/c/abcdefghijklmnopqrstuv');
    adoptContactPath();
    expect(window.location.pathname + window.location.hash).toBe('/#/c/abcdefghijklmnopqrstuv');
  });
});

describe('the private card', () => {
  /** Answers are only offered before the event ends, so the card's event must stay ahead of the clock. */
  const future = { start_at: '2099-01-01T18:00:00Z', end_at: '2099-01-01T20:00:00Z' };

  it('a pending invitee answers; declining closes the card', async () => {
    signIn();
    serve((url) => {
      if (url === '/api/me') return ok(me());
      if (url.endsWith('/answer')) return ok({ status: 'declined' });
      return ok({}, 404);
    });
    const ev = rowToPrivate(row('p1', future) as never);
    privateEvents.set([ev]);
    const gone = vi.fn();
    wrap(<PrivatePanel ev={ev} center={null} onToast={vi.fn()} onGone={gone} />);
    expect(screen.getByText(/Private · invited by Ola/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    });
    await waitFor(() => expect(gone).toHaveBeenCalled());
    expect(JSON.parse(String(calls('/answer')[0]![1]!.body))).toEqual({ accept: false });
    expect(privateEvents.list()).toEqual([]);
  });

  it('a link signed out offers sign-in instead of an answer', () => {
    serve(() => ok({}, 404));
    const ev = rowToPrivate(row('p1', { ...future, link: true, invitation: null }) as never);
    wrap(<PrivatePanel ev={ev} center={null} onToast={vi.fn()} onGone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign in to accept' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: "I'm in" })).toBeNull();
  });

  it('the owner invites and sees the guest list', async () => {
    signIn();
    serve((url) => {
      if (url === '/api/me') return ok(me());
      if (url.endsWith('/guests'))
        return ok({ guests: [{ id: 'g1', status: 'accepted', name: 'Ola', link: false }] });
      if (url === '/api/contacts') return ok({ contacts: [], groups: [], link: null });
      return ok({}, 404);
    });
    const ev = rowToPrivate(row('p1', { ...future, mine: true, invitation: null }) as never);
    wrap(<PrivatePanel ev={ev} center={null} onToast={vi.fn()} onGone={vi.fn()} />);
    expect(await screen.findByText('1 of 1 accepted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    expect(await screen.findByRole('dialog', { name: 'Invite' })).toBeTruthy();
  });
});

describe('friends and organisers on the card', () => {
  const pub: NearbyEvent = {
    ...rowToPrivate(row('e1') as never),
    visibility: undefined,
    endAt: '2099-01-01T00:00:00Z',
  } as unknown as NearbyEvent;

  it('shows friends by name, and the per-event switch', async () => {
    signIn();
    serve((url) => {
      if (url === '/api/me') return ok(me());
      if (url === '/api/friends')
        return ok({
          shown: true,
          override: null,
          friends: [
            { name: 'Ola', kinds: ['going'] },
            { name: 'Tomek', kinds: ['here'] },
          ],
          fromMyLinks: [],
        });
      return ok({}, 404);
    });
    wrap(<FriendsLine eventId="e1" />);
    expect(await screen.findByText(/Tomek here · Ola going/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: "Show friends I'm going to this" })).toHaveProperty(
      'checked',
      true,
    );
  });

  it('shows the organiser and important posts first; the organiser can post', async () => {
    signIn();
    serve((url) => {
      if (url === '/api/me') return ok(me());
      if (url.endsWith('/posts'))
        return ok({
          organiser: { name: 'Klub', kind: 'event' },
          posts: [
            {
              id: 'a',
              kind: 'important',
              body: 'Bag checks',
              change: null,
              createdAt: '2026-11-04T10:00:00Z',
            },
            {
              id: 'b',
              kind: 'info',
              body: 'Happy hour',
              change: null,
              createdAt: '2026-11-04T11:00:00Z',
            },
          ],
        });
      if (url.endsWith('/mine'))
        return ok({ role: 'organiser', claim: null, reports: [], infoPosts: true });
      return ok({}, 404);
    });
    wrap(
      <OrganiserPanel
        ev={pub}
        now={new Date('2026-11-04T12:00:00Z')}
        onToast={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Organiser: Klub/)).toBeTruthy();
    const bodies = [...document.querySelectorAll('.post__body')].map((p) => p.textContent);
    expect(bodies).toEqual(['Bag checks', 'Happy hour']);
    expect(await screen.findByRole('button', { name: 'Post an update' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeTruthy();
  });

  it('offers "I organise this" to someone with no role', async () => {
    signIn();
    serve((url) => {
      if (url === '/api/me') return ok(me());
      if (url.endsWith('/posts')) return ok({ organiser: null, posts: [] });
      if (url.endsWith('/mine'))
        return ok({ role: null, claim: null, reports: [], infoPosts: true });
      return ok({}, 404);
    });
    wrap(
      <OrganiserPanel
        ev={pub}
        now={new Date('2026-11-04T12:00:00Z')}
        onToast={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'I organise this' }));
    expect(screen.getByRole('dialog', { name: 'I organise this' })).toBeTruthy();
  });
});

describe('views', () => {
  it('has the Private view in config', () => {
    expect(config.app.agenda.views).toContain('private');
  });

  it('free accounts get one private event a month', () => {
    expect(entitlementsFor(config.plans, 'account')['private.perMonth']).toBe(1);
    expect(entitlementsFor(config.plans, 'account')['private.create']).toBe(true);
    expect(entitlementsFor(config.plans, 'anonymous')['private.create']).toBe(false);
  });
});

export type { PrivateEvent };
