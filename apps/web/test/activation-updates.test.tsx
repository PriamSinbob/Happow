import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventPost, NearbyEvent } from '@happow/core';
import { AccountProvider, useAccount, type Me } from '../src/account';
import { loadSession } from '../src/auth';
import { EventCard } from '../src/components/EventCard';
import { linkParts } from '../src/components/Linkify';
import { OpenPlaceCard } from '../src/components/OpenPlaceCard';
import { PostList } from '../src/components/Posts';
import { SignInSheet } from '../src/components/SignIn';
import { config } from '../src/config';
import { routeHref } from '../src/hooks/useHashRoute';
import { I18nProvider } from '../src/i18n';
import { partyAt, toPlaces } from '../src/places';
import { pinFeatures, type PinGroup } from '../src/pins';
import { updates } from '../src/updates';
import { entitlementsFor } from '@happow/core';

/**
 * Signing in at once with the email and waiting for the code, codes of any length, the "!"
 * of an unseen update, the newest updates on the map's card with their links, and the private
 * party said wherever its place shows.
 */

const SUPABASE = 'https://auth.test';
const jwt = (email: string) => `x.${btoa(JSON.stringify({ email }))}.y`;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Handler = (url: string, init?: RequestInit) => Response;
let fetchMock: ReturnType<typeof vi.fn>;
function serve(handler: Handler) {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
}
const calls = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part));
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const profile = (over: Partial<Me> = {}): Me => ({
  id: 'p1',
  email: 'ola@example.org',
  role: null,
  pending: true,
  locale: 'en',
  termsVersion: config.app.legal.termsVersion,
  displayName: null,
  plan: 'anonymous',
  planSource: null,
  planEndsAt: null,
  entitlements: entitlementsFor(config.plans, 'anonymous'),
  usage: {
    month: '2026-11',
    resetsAt: '2026-11-30T23:00:00.000Z',
    events: { used: 0, limit: 0 },
    autofill: { used: 0, limit: 0 },
    private: { used: 0, limit: 0 },
  },
  ...over,
});

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  localStorage.clear();
  updates.reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function Status() {
  const a = useAccount();
  return (
    <p data-testid="status">
      {a.status}:{a.pending?.email ?? ''}:{String(a.member)}:{a.me?.email ?? ''}
    </p>
  );
}
const app = (sheet: React.ReactNode) =>
  render(
    <I18nProvider initial="en">
      <AccountProvider>
        <Status />
        {sheet}
      </AccountProvider>
    </I18nProvider>,
  );

describe('sign-in with the email alone', () => {
  it('signs in at once as waiting, then takes a code of more than 6 digits', async () => {
    let activated = false;
    serve((url, init) => {
      if (url.endsWith('/api/auth/code-request')) return ok({ ok: true }, 202);
      if (url.endsWith('/api/auth/pending'))
        return ok(
          {
            session: { access_token: jwt('p-1@pending'), refresh_token: 'r-p', expires_in: 3600 },
            email: 'ola@example.org',
          },
          201,
        );
      if (url.endsWith('/auth/v1/verify'))
        return ok({
          access_token: jwt('ola@example.org'),
          refresh_token: 'r-real',
          expires_in: 3600,
        });
      if (url.endsWith('/api/auth/activate')) {
        activated = true;
        return ok({ merged: true });
      }
      if (url.endsWith('/api/me')) {
        const waiting = new Headers(init?.headers)
          .get('authorization')
          ?.includes(jwt('p-1@pending'));
        return ok(
          waiting
            ? profile()
            : profile({ id: 'u1', pending: false, plan: 'account' as Me['plan'] }),
        );
      }
      return ok({}, 404);
    });
    const onSignedIn = vi.fn();
    app(<SignInSheet onClose={() => {}} onSignedIn={onSignedIn} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Ola@Example.org' } });
    fireEvent.click(screen.getByRole('button', { name: /Send me a code/ }));

    // Signed in right away, waiting for the code; the sheet now asks for it.
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('pending:ola@example.org:true:'),
    );
    expect(loadSession()).toMatchObject({ pending: true, email: 'ola@example.org' });
    expect(bodyOf(calls('/api/auth/pending')[0]!)).toEqual({
      email: 'ola@example.org',
      locale: 'en',
    });
    expect(screen.getByText(/accepting invitations and saving events work right now/)).toBeTruthy();

    // Supabase may make codes of up to 10 digits: all of them fit, and 6 is the least.
    const code = screen.getByLabelText(/Code from the email/) as HTMLInputElement;
    expect(code.maxLength).toBe(config.app.auth.codeDigits.max);
    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    fireEvent.change(code, { target: { value: '12345' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(code, { target: { value: '1234 5678' } });
    expect(code.value).toBe('12345678');
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(bodyOf(calls('/auth/v1/verify')[0]!)).toMatchObject({
      email: 'Ola@Example.org',
      token: '12345678',
    });
    // The waiting account is folded into the real one, with both tokens.
    await waitFor(() => expect(activated).toBe(true));
    const act = calls('/api/auth/activate')[0]!;
    expect(bodyOf(act)).toEqual({ pendingToken: jwt('p-1@pending') });
    expect(new Headers((act[1] as RequestInit).headers).get('authorization')).toBe(
      `Bearer ${jwt('ola@example.org')}`,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('signedIn::true:ola@example.org'),
    );
    expect(loadSession()?.pending).toBeUndefined();
    expect(localStorage.getItem('happow:pending-session')).toBeNull();
  });

  it('hands over to the caller as soon as the email is in (accepting an invitation)', async () => {
    serve((url) => {
      if (url.endsWith('/api/auth/code-request')) return ok({ ok: true }, 202);
      if (url.endsWith('/api/auth/pending'))
        return ok({
          session: { access_token: jwt('p-2@pending'), refresh_token: 'r', expires_in: 3600 },
          email: 'a@example.org',
        });
      if (url.endsWith('/api/me')) return ok(profile({ email: 'a@example.org' }));
      return ok({}, 404);
    });
    const onPending = vi.fn();
    app(<SignInSheet onClose={() => {}} onPending={onPending} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: /Send me a code/ }));
    await waitFor(() => expect(onPending).toHaveBeenCalled());
  });

  it('opens on the code for an account that is already waiting', async () => {
    localStorage.setItem(
      'happow:session',
      JSON.stringify({
        accessToken: jwt('p-1@pending'),
        refreshToken: 'r',
        expiresAt: Date.now() + 3_600_000,
        email: 'ola@example.org',
        pending: true,
      }),
    );
    serve((url) => (url.endsWith('/api/me') ? ok(profile()) : ok({}, 404)));
    const { rerender } = app(null);
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toContain('pending:ola@example.org'),
    );
    rerender(
      <I18nProvider initial="en">
        <AccountProvider>
          <SignInSheet onClose={() => {}} />
        </AccountProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/Code from the email/)).toBeTruthy());
    expect(screen.getByText(/ola@example.org/)).toBeTruthy();
  });
});

const post = (
  id: string,
  body: string,
  minutesAgo: number,
  kind: EventPost['kind'] = 'important',
) =>
  ({
    id,
    kind,
    body,
    change: null,
    createdAt: new Date(Date.parse('2026-11-12T12:00:00Z') - minutesAgo * 60_000).toISOString(),
  }) satisfies EventPost;
const news = (id: string, at: string, posts: EventPost[] = []) => ({
  id,
  title: `Event ${id}`,
  status: 'scheduled',
  lastPostAt: at,
  changedAt: null,
  posts,
});

describe('updates', () => {
  it('marks an event unread until its card showed the update, and announces it once', () => {
    updates.setPublic([news('a', '2026-11-12T11:00:00Z', [post('p1', 'Doors at 19:00', 60)])]);
    expect(updates.isUnread('a')).toBe(true);
    expect(updates.unread().has('a')).toBe(true);
    // Announced once: the next poll with the same news says nothing.
    expect(updates.takeNew().map((n) => n.id)).toEqual(['a']);
    updates.setPublic([news('a', '2026-11-12T11:00:00Z')]);
    expect(updates.takeNew()).toEqual([]);

    updates.markSeen('a');
    expect(updates.isUnread('a')).toBe(false);
    // A newer post brings the mark and the announcement back.
    updates.setPublic([news('a', new Date(Date.now() + 2 * 86_400_000).toISOString())]);
    expect(updates.isUnread('a')).toBe(true);
    expect(updates.takeNew()).toHaveLength(1);
  });

  it('counts a private event’s change for its guests, never for its owner', () => {
    const base = { title: 'Party', changedAt: null, lastPostAt: '2026-11-12T11:00:00Z' };
    updates.setPrivate([
      { id: 'mine', mine: true, invitation: null, ...base },
      { id: 'seen', mine: false, invitation: { seenAt: '2026-11-12T11:30:00Z' }, ...base },
      { id: 'new', mine: false, invitation: { seenAt: '2026-11-12T10:00:00Z' }, ...base },
      { id: 'quiet', mine: false, invitation: { seenAt: null }, ...base, lastPostAt: null },
      { id: 'asked', mine: false, invitation: { seenAt: null, status: 'pending' }, ...base },
    ]);
    expect([...updates.unread()]).toEqual(['new']);
  });

  it('puts the "!" on the pin of an event with unseen news', () => {
    const ev = (id: string) =>
      ({
        id,
        title: id,
        categoryIds: ['music'],
        startAt: '2026-11-12T11:30:00Z',
        endAt: '2026-11-12T13:00:00Z',
        endEstimated: false,
        point: { lat: 51.11, lng: 17.03 },
        distanceM: 0,
        entry: null,
        graceMin: null,
        ageMin: 18,
        family: null,
      }) as NearbyEvent;
    const group = (id: string): PinGroup => ({
      key: id,
      kind: 'place',
      point: { lat: 51.11, lng: 17.03 },
      events: [ev(id)],
    });
    const props = pinFeatures([group('a'), group('b')], {
      now: new Date('2026-11-12T12:00:00Z'),
      center: { lat: 51.11, lng: 17.03 },
      radiusM: 500,
      selectedId: null,
      unread: new Set(['a']),
    }).features.map((f) => f.properties);
    expect(props.map((p) => p.news)).toEqual([true, false]);
  });

  it('makes links in an update tappable, and nothing else', () => {
    expect(linkParts('Bilety: https://example.org/t?a=1. Do zobaczenia!')).toEqual([
      { text: 'Bilety: ', href: null },
      { text: 'https://example.org/t?a=1', href: 'https://example.org/t?a=1' },
      { text: '. Do zobaczenia!', href: null },
    ]);
    expect(linkParts('www.example.org (mapa)')[0]).toEqual({
      text: 'www.example.org',
      href: 'https://www.example.org',
    });
    expect(linkParts('javascript:alert(1) <b>x</b>')).toEqual([
      { text: 'javascript:alert(1) <b>x</b>', href: null },
    ]);

    render(
      <I18nProvider initial="en">
        <PostList
          posts={[post('p1', 'New gate: https://example.org/gate', 5)]}
          ev={{ timezone: 'Europe/Warsaw' }}
          now={new Date('2026-11-12T12:00:00Z')}
        />
      </I18nProvider>,
    );
    const link = screen.getByRole('link', { name: 'https://example.org/gate' });
    expect(link.getAttribute('href')).toBe('https://example.org/gate');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows the newest few on the map’s card, the rest in Details, and clears the mark', async () => {
    const posts = [
      post('p1', 'Oldest', 300, 'info'),
      post('p2', 'Older', 200, 'info'),
      post('p3', 'Second', 100),
      post('p4', 'Newest', 10, 'schedule'),
      post('p5', 'Third', 150, 'info'),
    ];
    serve((url) => (url.includes('/posts') ? ok({ organiser: null, posts }) : ok({}, 404)));
    updates.setPublic([news('e1', '2026-11-12T11:50:00Z', [posts[3]!])]);
    expect(updates.isUnread('e1')).toBe(true);
    const onDetails = vi.fn();
    const ev = {
      id: 'e1',
      title: 'Koncert',
      categoryIds: ['music'],
      startAt: '2026-11-12T19:00:00Z',
      endAt: '2026-11-12T21:00:00Z',
      endEstimated: false,
      timezone: 'Europe/Warsaw',
      point: { lat: 51.11, lng: 17.03 },
      distanceM: 300,
      venue: null,
      isFree: true,
      priceMin: null,
      priceMax: null,
      currency: 'PLN',
      rules: {},
      ageMin: null,
      family: null,
      entry: null,
      graceMin: null,
      status: 'scheduled',
      trust: 'community',
      verified: true,
      performers: [],
      flag: null,
    } as unknown as NearbyEvent;
    render(
      <I18nProvider initial="en">
        <EventCard
          ev={ev}
          now={new Date('2026-11-12T12:00:00Z')}
          onClose={() => {}}
          onDetails={onDetails}
          onGo={() => {}}
        />
      </I18nProvider>,
    );
    // At once, from the last look at the news; then the card's own read.
    expect(screen.getByText('Newest')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy());
    const shown = [...document.querySelectorAll('.post__body')].map((n) => n.textContent);
    expect(shown).toEqual(['Newest', 'Second', 'Third'].slice(0, config.app.organiser.cardPosts));
    expect(screen.queryByText('Oldest')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /2 more updates in Details/ }));
    expect(onDetails).toHaveBeenCalled();
    expect(updates.isUnread('e1')).toBe(false);
  });
});

describe('a private party at a place', () => {
  const tz = 'Europe/Warsaw';
  const at = new Date('2026-11-10T20:00:00+01:00');
  const here = { lat: 51.11, lng: 17.03 };
  const places = toPlaces([
    {
      id: 'pub',
      name: 'Pub Ruska',
      kind: 'amenity=pub',
      lat: 51.11,
      lng: 17.03,
      address: 'ul. Ruska 1',
      website: null,
      opening_hours: 'Mo-Su 12:00-23:00',
      private_until: '2026-11-10T22:00:00Z',
    },
  ]);

  it('is said on the card of an event held there, by name and until when', () => {
    const party = partyAt(places, at, { lat: 51.11005, lng: 17.03 }, here);
    expect(party).toMatchObject({ id: 'pub', privateParty: true });
    // Not next door, and not once it is over.
    expect(partyAt(places, at, { lat: 51.12, lng: 17.03 }, here)).toBeNull();
    expect(partyAt(places, new Date('2026-11-10T22:30:00Z'), here, here)).toBeNull();
  });

  it('shows on the place’s own card, with a private event of your own one tap away', () => {
    const party = partyAt(places, at, here, here)!;
    const onPrivateEvent = vi.fn();
    render(
      <I18nProvider initial="en">
        <OpenPlaceCard
          place={party}
          now={at}
          timeZone={tz}
          onClose={() => {}}
          onEdit={() => {}}
          onPrivateEvent={onPrivateEvent}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('status').textContent).toContain('Private party');
    expect(screen.getByRole('status').textContent).toContain('until 11:00');
    fireEvent.click(screen.getByRole('button', { name: /Private event here/ }));
    expect(onPrivateEvent).toHaveBeenCalled();
    expect(routeHref({ name: 'add', place: 'osm:node/1' })).toBe('#/add?place=osm%3Anode%2F1');
  });
});
