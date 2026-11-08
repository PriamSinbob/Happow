import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi, createEventPage } from '../src';
import { claimCode, toColumns } from '../src/organisers';

/** M11: private events, contacts, invitations, friends, claims, posts and edits. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUBMITTER_SALT: 'salt' };
const now = () => new Date('2026-11-04T18:00:00Z');
const config = loadConfig();

type Rpc = (args: Record<string, unknown>) => { status?: number; body: unknown };
function backend(rpc: Record<string, Rpc> = {}, pages: Record<string, Response> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const users: Record<string, { id: string; email: string }> = {
    'user-token': { id: 'u1', email: 'ala@example.org' },
    'ola-token': { id: 'u2', email: 'ola@example.org' },
    'mod-token': { id: 'u9', email: 'mod@example.org' },
  };
  const all: Record<string, Rpc> = {
    rate_limit_hit: () => ({ body: true }),
    staff_role: (a) => ({ body: a.p_email === 'mod@example.org' ? 'moderator' : null }),
    grants_active: () => ({ body: [] }),
    usage_get: () => ({ body: { events: 0, autofills: 0, private: 0 } }),
    profile_get: () => ({ body: { displayName: 'Ala' } }),
    contributor_trusted: () => ({ body: false }),
    event_visibility: () => ({ body: 'public' }),
    organiser_at: () => ({ body: false }),
    ...rpc,
  };
  const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
      const name = url.slice(`${SB}/rest/v1/rpc/`.length);
      const args = JSON.parse(String(init.body ?? '{}'));
      calls.push({ name, args });
      const h = all[name];
      if (!h) return new Response('{}', { status: 404 });
      const { status = 200, body } = h(args);
      return new Response(JSON.stringify(body), { status });
    }
    if (url === `${SB}/auth/v1/user`) {
      const token = new Headers(init.headers).get('authorization')?.replace('Bearer ', '') ?? '';
      const u = users[token];
      return u ? Response.json(u) : new Response('{}', { status: 401 });
    }
    return pages[url]?.clone() ?? new Response('not found', { status: 404 });
  });
  const api = createApi(env, { config, fetch: f as typeof fetch, now, extractor: null });
  const call = (name: string) => calls.filter((c) => c.name === name);
  return { api, call, fetch: f as typeof fetch };
}
const req = (path: string, init: { token?: string; body?: unknown; method?: string } = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
const fail =
  (code: string): Rpc =>
  () => ({ status: 400, body: { code, message: code } });

const event = {
  title: 'Urodziny Ali',
  categoryIds: ['music'],
  venueName: 'U Ali',
  address: 'ul. Ruska 46',
  point: { lat: 51.1105, lng: 17.0255 },
  start: '2026-11-07T19:00',
  end: '2026-11-07T23:00',
  isFree: true,
  url: null,
};
const submit = (b: ReturnType<typeof backend>, extra: object = {}, token = 'user-token') =>
  b.api(
    req('submissions', {
      token,
      body: { deviceId: 'device-0123456789', event, private: true, ...extra },
    }),
  );

describe('private events (slice A)', () => {
  it('stores a private event at once, with both quotas, and no rewards', async () => {
    const b = backend({ submit_private: () => ({ body: 'submissions:abc' }) });
    const res = await submit(b);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      eventId: 'submissions:abc',
      status: 'published',
      private: true,
    });
    const args = b.call('submit_private')[0]!.args;
    // Early access gives everyone premium in the test's month.
    expect(args).toMatchObject({ p_user: 'u1', p_max: 300, p_private_max: 300 });
    expect(b.call('submit_event')).toHaveLength(0);
    expect(b.call('contribution_award')).toHaveLength(0);
    expect(b.call('first_place_mark')).toHaveLength(0);
  });

  it('answers 429 kind private when the month’s private events are used, and refuses repeats', async () => {
    const b = backend({ submit_private: fail('HQ002') });
    const res = await submit(b);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'quota_exceeded', kind: 'private' });
    const rep = await submit(b, { repeat: { days: [6], until: '2026-11-28' } });
    expect(rep.status).toBe(400);
  });

  it('refuses an account whose private events were blocked', async () => {
    const b = backend({ profile_get: () => ({ body: { privateBlocked: true } }) });
    expect((await submit(b)).status).toBe(403);
  });

  it('reads private events only signed in, never cached', async () => {
    const b = backend({ private_events_for: () => ({ body: [{ id: 'p1' }] }) });
    expect((await b.api(req('private'))).status).toBe(401);
    const res = await b.api(req('private?lat=51.1&lng=17.03', { token: 'user-token' }));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ events: [{ id: 'p1' }] });
    expect(b.call('private_events_for')[0]!.args).toEqual({
      p_user: 'u1',
      p_lat: 51.1,
      p_lng: 17.03,
    });
  });

  it('opens one with a link token before sign-in; strangers get 404', async () => {
    const token = 'abcdefghijklmnopqrstuv';
    const b = backend({
      private_event_get: (a) => ({ body: a.p_token === token ? { id: 'p1', link: true } : null }),
    });
    const ok = await b.api(req(`private/p1?i=${token}`));
    expect(await ok.json()).toEqual({ event: { id: 'p1', link: true } });
    expect((await b.api(req('private/p1?i=wrongwrongwrongwrong'))).status).toBe(404);
    expect((await b.api(req('private/p1'))).status).toBe(401);
  });

  it('reports on a private event: only from someone who may see it', async () => {
    const b = backend({
      event_visibility: () => ({ body: 'private' }),
      event_visible_to: (a) => ({ body: a.p_user === 'u2' }),
      report_event: () => ({ body: true }),
    });
    const body = { deviceId: 'device-0123456789', eventId: 'p1', reason: 'wrong_info' };
    expect((await b.api(req('reports', { body }))).status).toBe(404);
    expect((await b.api(req('reports', { body, token: 'user-token' }))).status).toBe(404);
    expect((await b.api(req('reports', { body, token: 'ola-token' }))).status).toBe(201);
  });
});

describe('contacts and invitations (slices B, C)', () => {
  it('needs a display name first', async () => {
    const b = backend({ profile_get: () => ({ body: { displayName: null } }) });
    const res = await b.api(req('contacts/link', { token: 'user-token', body: {} }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'name_required' });
  });

  it('makes a contact link, shows whose it is, and adds them', async () => {
    const b = backend({
      contact_link_new: (a) => ({ body: a.p_token }),
      contact_link_owner: () => ({ body: { id: 'u1', name: 'Ala' } }),
      contacts_list: () => ({ body: { contacts: [], groups: [], link: null } }),
      contact_link_accept: () => ({ body: { id: 'u1', name: 'Ala' } }),
    });
    const made = (await (
      await b.api(req('contacts/link', { token: 'user-token', body: {} }))
    ).json()) as {
      token: string;
      url: string;
    };
    expect(made.url).toBe(`/c/${made.token}`);
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Before sign-in: only the name.
    expect(await (await b.api(req(`contacts/link/${made.token}`))).json()).toEqual({ name: 'Ala' });
    const added = await b.api(req(`contacts/link/${made.token}`, { token: 'ola-token', body: {} }));
    expect(await added.json()).toEqual({ id: 'u1', name: 'Ala' });
  });

  it('maps a block to 403 and the group limit to 409', async () => {
    const b = backend({
      contact_link_accept: fail('HQ011'),
      contacts_list: () => ({ body: { contacts: [] } }),
      group_save: fail('HQ012'),
    });
    const t = 'abcdefghijklmnopqrstuv';
    expect((await b.api(req(`contacts/link/${t}`, { token: 'ola-token', body: {} }))).status).toBe(
      403,
    );
    expect(
      (await b.api(req('contacts/groups', { token: 'user-token', body: { name: 'Bieg' } }))).status,
    ).toBe(409);
  });

  it('invites people and groups, or makes a single-use link', async () => {
    const b = backend({
      invite_people: () => ({ body: 2 }),
      invite_link: () => ({ body: '11111111-2222-4333-8444-555555555555' }),
    });
    const people = await b.api(
      req('private/p1/invite', {
        token: 'user-token',
        body: { people: ['11111111-2222-4333-8444-555555555555'], groups: [3] },
      }),
    );
    expect(await people.json()).toEqual({ invited: 2 });
    expect(b.call('invite_people')[0]!.args).toMatchObject({ p_groups: [3], p_max: 200 });
    const link = (await (
      await b.api(
        req('private/p1/invite', { token: 'user-token', body: { link: true, label: 'Zosia' } }),
      )
    ).json()) as { url: string; token: string };
    expect(link.url).toBe(`/e/p1?i=${link.token}`);
    expect(b.call('invite_link')[0]!.args).toMatchObject({ p_label: 'Zosia', p_token: link.token });
  });

  it('answers, accepts a link and revokes', async () => {
    const b = backend({
      invitation_answer: (a) => ({ body: a.p_accept ? 'accepted' : 'declined' }),
      invitation_accept_link: () => ({ body: 'p1' }),
      invitation_revoke: () => ({ body: false }),
    });
    const ans = await b.api(
      req('private/p1/answer', { token: 'ola-token', body: { accept: false } }),
    );
    expect(await ans.json()).toEqual({ status: 'declined' });
    const acc = await b.api(
      req('invitations/accept', { token: 'ola-token', body: { token: 'abcdefghijklmnopqrstuv' } }),
    );
    expect(await acc.json()).toEqual({ eventId: 'p1' });
    const rev = await b.api(
      req('invitations/11111111-2222-4333-8444-555555555555', {
        token: 'user-token',
        method: 'DELETE',
      }),
    );
    expect(rev.status).toBe(404);
  });
});

describe("the friends' view (slice E)", () => {
  it('reads friends with the hashed device, and sets the per-event override', async () => {
    const b = backend({
      friends_on_event: () => ({ body: { friends: [{ name: 'Ola', kinds: ['going'] }] } }),
      friend_override_set: () => ({ body: null }),
    });
    const res = await b.api(
      req('friends', {
        token: 'user-token',
        body: { eventId: 'e1', deviceId: 'device-0123456789' },
      }),
    );
    expect(await res.json()).toEqual({ friends: [{ name: 'Ola', kinds: ['going'] }] });
    expect(b.call('friends_on_event')[0]!.args.p_device).toMatch(/^[0-9a-f]{64}$/);
    await b.api(
      req('friends', { token: 'user-token', method: 'PUT', body: { eventId: 'e1', show: null } }),
    );
    expect(b.call('friend_override_set')[0]!.args).toEqual({
      p_user: 'u1',
      p_event: 'e1',
      p_show: null,
    });
  });

  it('PUT /api/me takes the account switch', async () => {
    const b = backend({
      profile_update: () => ({ body: null }),
      profile_friends: () => ({ body: null }),
    });
    await b.api(req('me', { token: 'user-token', method: 'PUT', body: { friendsVisible: true } }));
    expect(b.call('profile_friends')[0]!.args).toEqual({ p_user: 'u1', p_on: true });
  });
});

describe('claims (slice F)', () => {
  const claim = {
    id: '11111111-2222-4333-8444-555555555555',
    code: 'happow-claim-ABCDEFGHJK',
    page_url: 'https://klub.example/wydarzenie',
    status: 'pending',
  };
  const page = (html: string) =>
    new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('makes codes people can type', () => {
    expect(claimCode()).toMatch(/^happow-claim-[A-HJ-NP-Z2-9]{10}$/);
  });

  it('needs evidence for a moderator claim', async () => {
    const b = backend({ claim_open: () => ({ body: claim }) });
    const body = { kind: 'event', target: 'e1', organiserName: 'Klub', method: 'moderator' };
    expect((await b.api(req('claims', { token: 'user-token', body }))).status).toBe(400);
    const ok = await b.api(
      req('claims', { token: 'user-token', body: { ...body, evidence: 'I run it' } }),
    );
    expect(ok.status).toBe(201);
    expect(b.call('claim_open')[0]!.args.p_code).toMatch(/^happow-claim-/);
  });

  it('approves when the code is on the page', async () => {
    const b = backend(
      {
        claim_get: () => ({ body: claim }),
        claim_checked: () => ({ body: null }),
        claim_decide: () => ({ body: { ...claim, status: 'approved' } }),
      },
      { [claim.page_url]: page(`<html><meta name="happow" content="${claim.code}"></html>`) },
    );
    const res = await b.api(req(`claims/${claim.id}/check`, { token: 'user-token', body: {} }));
    expect(await res.json()).toMatchObject({ result: 'approved' });
    expect(b.call('claim_decide')[0]!.args).toMatchObject({ p_action: 'approve', p_by: 'site' });
  });

  it('says missing without the code, and respects robots.txt', async () => {
    const b = backend(
      { claim_get: () => ({ body: claim }), claim_checked: () => ({ body: null }) },
      { [claim.page_url]: page('<html>nothing</html>') },
    );
    const res = await b.api(req(`claims/${claim.id}/check`, { token: 'user-token', body: {} }));
    expect(await res.json()).toMatchObject({ result: 'missing' });
    const blocked = backend(
      { claim_get: () => ({ body: claim }), claim_checked: () => ({ body: null }) },
      {
        'https://klub.example/robots.txt': new Response('User-agent: *\nDisallow: /'),
        [claim.page_url]: page(claim.code),
      },
    );
    const r2 = await blocked.api(
      req(`claims/${claim.id}/check`, { token: 'user-token', body: {} }),
    );
    expect(await r2.json()).toMatchObject({ result: 'blocked' });
    expect(blocked.call('claim_decide')).toHaveLength(0);
  });

  it('lets moderators decide claims, edits and posts', async () => {
    const b = backend({
      moderation_queue: () => ({ body: { submissions: [], reports: [] } }),
      trusted_recent: () => ({ body: [] }),
      claims_queue: () => ({ body: [{ id: claim.id }] }),
      edits_queue: () => ({ body: [] }),
      post_reports_queue: () => ({ body: [] }),
      claim_decide: () => ({ body: { status: 'approved' } }),
      edit_decide: () => ({ body: { action: 'reject' } }),
      post_moderate: () => ({ body: true }),
    });
    const q = await (await b.api(req('moderation', { token: 'mod-token' }))).json();
    expect(q).toMatchObject({ claims: [{ id: claim.id }], edits: [], posts: [] });
    expect(
      (
        await b.api(
          req(`moderation/claims/${claim.id}`, { token: 'mod-token', body: { action: 'approve' } }),
        )
      ).status,
    ).toBe(200);
    expect(b.call('claim_decide')[0]!.args).toMatchObject({ p_by: 'mod@example.org' });
    await b.api(req('moderation/edits/4', { token: 'mod-token', body: { action: 'reject' } }));
    expect(b.call('edit_decide')[0]!.args).toEqual({
      p_id: 4,
      p_approve: false,
      p_by: 'mod@example.org',
    });
    expect(
      (
        await b.api(
          req(`moderation/posts/${claim.id}`, { token: 'user-token', body: { action: 'hide' } }),
        )
      ).status,
    ).toBe(403);
  });
});

describe('posts and edits (slices G, H)', () => {
  it('serves posts of a public event from the edge cache, a private one only to guests', async () => {
    const b = backend({ event_posts_get: () => ({ body: { organiser: null, posts: [] } }) });
    const res = await b.api(req('events/e1/posts'));
    expect(res.headers.get('cache-control')).toBe(
      `public, max-age=${config.app.organiser.postsCacheSec}`,
    );
    const p = backend({
      event_visibility: () => ({ body: 'private' }),
      event_visible_to: () => ({ body: false }),
    });
    expect((await p.api(req('events/p1/posts'))).status).toBe(401);
    expect((await p.api(req('events/p1/posts', { token: 'user-token' }))).status).toBe(404);
  });

  it('posts a schedule change, and queues the notice for everyone interested', async () => {
    const b = backend({
      post_add: () => ({ body: { id: 'x', kind: 'schedule' } }),
      notice_enqueue: () => ({ body: 4 }),
    });
    const res = await b.api(
      req('events/e1/posts', {
        token: 'user-token',
        body: {
          kind: 'schedule',
          body: 'Start 19:30',
          change: { startAt: '2026-11-07T18:30:00Z' },
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ notified: 4 });
    expect(b.call('post_add')[0]!.args).toMatchObject({
      p_change: { start_at: '2026-11-07T18:30:00Z' },
      p_per_day: config.app.organiser.postsPerEventPerDay,
    });
    expect(b.call('notice_enqueue')[0]!.args).toMatchObject({ p_kind: 'schedule', p_except: 'u1' });
    // An info post sends nothing; a schedule post needs a change.
    const info = backend({ post_add: () => ({ body: {} }) });
    await info.api(
      req('events/e1/posts', { token: 'user-token', body: { kind: 'info', body: 'Happy hour' } }),
    );
    expect(info.call('notice_enqueue')).toHaveLength(0);
    expect(
      (
        await info.api(
          req('events/e1/posts', { token: 'user-token', body: { kind: 'schedule', body: 'x' } }),
        )
      ).status,
    ).toBe(400);
  });

  it('a post that fails the notice still stands', async () => {
    const b = backend({ post_add: () => ({ body: {} }), notice_enqueue: fail('XX000') });
    const res = await b.api(
      req('events/e1/posts', {
        token: 'user-token',
        body: { kind: 'important', body: 'Bag checks' },
      }),
    );
    expect(res.status).toBe(201);
  });

  it('edits: maps fields, checks times, and notifies a cancellation', async () => {
    expect(toColumns({ startAt: 'a', isFree: true, ticketUrl: null })).toEqual({
      start_at: 'a',
      is_free: true,
      ticket_url: null,
    });
    const b = backend({
      event_fields: () => ({
        body: { start_at: '2026-11-07T18:00:00Z', end_at: '2026-11-07T20:00:00Z' },
      }),
      event_role: () => ({ body: 'organiser' }),
      event_edit: () => ({ body: { status: 'applied', role: 'organiser' } }),
      notice_enqueue: () => ({ body: 1 }),
    });
    const bad = await b.api(
      req('events/e1/edit', {
        token: 'user-token',
        body: { fields: { endAt: '2026-11-07T17:00:00Z' } },
      }),
    );
    expect(bad.status).toBe(400);
    const res = await b.api(
      req('events/e1/edit', { token: 'user-token', body: { fields: { status: 'cancelled' } } }),
    );
    expect(await res.json()).toMatchObject({ status: 'applied', notified: 1 });
    expect(b.call('notice_enqueue')[0]!.args).toMatchObject({ p_kind: 'cancelled' });
    expect(b.call('event_edit')[0]!.args).toMatchObject({
      p_fields: { status: 'cancelled' },
      p_trusted: false,
    });
  });

  it('publishes at once at a venue the account organises', async () => {
    const b = backend({
      organiser_at: () => ({ body: true }),
      usage_take: () => ({ body: true }),
      submit_event: () => ({ body: 's1' }),
      contribution_award: () => ({ body: null }),
      first_place_mark: () => ({ body: false }),
    });
    const res = await submit(b, { private: false });
    expect(await res.json()).toMatchObject({ status: 'published', trusted: true });
    expect(b.call('submit_event')[0]!.args).toMatchObject({ p_trusted: true });
  });
});

describe('links to a private event (slice D)', () => {
  it('previews with generic tags, never the title', async () => {
    const f = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/rpc/event_by_id')) return Response.json([]);
      if (url.endsWith('/rpc/event_visibility')) return Response.json('private');
      return new Response('{}', { status: 404 });
    });
    const page = createEventPage(env, { config, fetch: f as typeof fetch, now });
    const res = await page.page(
      new Request('https://happow.example/e/submissions%3Ap1'),
      '<html lang="pl"><head><title>Happow</title></head><body></body></html>',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('Wydarzenie prywatne · Happow');
    expect(html).not.toContain('Urodziny');
  });
});
