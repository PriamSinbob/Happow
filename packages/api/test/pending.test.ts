import { describe, expect, it } from 'vitest';
import { createApi } from '../src';
import { config, env, fail, req, SB, supabase as fake, type Rpc } from './helpers';

/**
 * Accounts that wait for activation: signed in with the email alone, able to accept invitations
 * and nothing more, folded into the real account once the code is typed. Also the updates of
 * many events in one call and handing a private event over.
 */

const DOMAIN = config.app.auth.pending.domain;
const now = () => new Date('2026-11-12T12:00:00Z');

function backend(rpc: Record<string, Rpc> = {}) {
  const deleted: string[] = [];
  const sb = fake(
    {
      profile_get: () => ({ body: { displayName: 'Ola', locale: 'pl', termsVersion: null } }),
      pending_email: () => ({ body: 'ola@example.org' }),
      pending_add: () => ({ status: 204, body: null }),
      event_visibility: () => ({ body: 'public' }),
      ...rpc,
    },
    {
      users: {
        'user-token': { id: 'u1', email: 'ala@example.org' },
        'wait-token': { id: 'p1', email: `p-123@${DOMAIN}` },
      },
      other: (url, init) => {
        const path = url.slice(SB.length);
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : {};
        if (path === '/auth/v1/admin/users' && method === 'POST')
          return Response.json({ id: 'p-new', email: body.email });
        if (path === '/auth/v1/admin/generate_link')
          return Response.json({ email_otp: '12345678', action_link: `${SB}/auth/v1/verify?x` });
        if (path === '/auth/v1/verify' && method === 'POST')
          return Response.json({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 });
        if (path.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
          deleted.push(path.split('/').pop()!);
          return new Response('{}', { status: 200 });
        }
        return undefined;
      },
    },
  );
  return {
    ...sb,
    deleted,
    api: createApi(env, { config, fetch: sb.fetch, now, extractor: null }),
  };
}

describe('POST /api/auth/pending', () => {
  it('signs the device in at once as a new account that waits for the code', async () => {
    const b = backend();
    const res = await b.api(
      req('auth/pending', { body: { email: 'Ola@Example.org', locale: 'pl' } }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({
      session: { access_token: 'acc', refresh_token: 'ref', expires_in: 3600 },
      email: 'ola@example.org',
    });
    // The account is a new one on the placeholder domain, never the email's own.
    const made = b.requests.find((r) => r.path === '/auth/v1/admin/users')!;
    expect(made.body.email).toMatch(
      new RegExp(`^p-[0-9a-f-]{36}@${DOMAIN.replace(/\./g, '\\.')}$`),
    );
    // Its code of any length is traded for the session on the server; no email is sent.
    expect(b.requests.find((r) => r.path === '/auth/v1/verify')!.body).toMatchObject({
      type: 'email',
      token: '12345678',
    });
    expect(b.call('pending_add')[0]!.args).toEqual({ p_user: 'p-new', p_email: 'ola@example.org' });
    expect(b.call('rate_limit_hit')[0]!.args).toMatchObject({
      p_bucket: 'pending',
      p_max: config.app.auth.pending.perHourPerClient,
    });
  });

  it('changes the email a waiting account waits for, without a new account', async () => {
    const b = backend();
    const res = await b.api(
      req('auth/pending', {
        token: 'wait-token',
        body: { email: 'new@example.org', locale: 'en' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'new@example.org' });
    expect(b.call('pending_add')[0]!.args).toEqual({ p_user: 'p1', p_email: 'new@example.org' });
    expect(b.requests.some((r) => r.path === '/auth/v1/admin/users')).toBe(false);
  });

  it('refuses a placeholder address, and is rate-limited per client', async () => {
    const b = backend();
    const bad = await b.api(req('auth/pending', { body: { email: `x@${DOMAIN}`, locale: 'pl' } }));
    expect(bad.status).toBe(400);
    const limited = backend({ rate_limit_hit: () => ({ body: false }) });
    expect(
      (await limited.api(req('auth/pending', { body: { email: 'a@example.org', locale: 'pl' } })))
        .status,
    ).toBe(429);
  });
});

describe('an account waiting for activation', () => {
  it('reads its profile as waiting, with the email it waits for and nothing a plan gives', async () => {
    const b = backend();
    const res = await b.api(req('me', { token: 'wait-token' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'p1',
      email: 'ola@example.org',
      pending: true,
      role: null,
      plan: 'anonymous',
      displayName: 'Ola',
      usage: { events: { used: 0, limit: 0 } },
    });
    // Never staff: the placeholder address is not looked up.
    expect(b.call('staff_role')).toHaveLength(0);
  });

  it('is refused everything that needs the activated account', async () => {
    const b = backend();
    for (const [path, init] of [
      ['me/export', {}],
      ['me/contributions', {}],
      ['me/events', {}],
      ['contacts', {}],
      ['places', { body: {} }],
      ['autofill', { body: { url: 'https://example.org' } }],
      ['private/submissions:abc/invite', { body: { link: true } }],
      [
        'private/submissions:abc/transfer',
        { body: { to: '0b7a3c1e-2f4d-4e5a-9b6c-7d8e9f0a1b2c' } },
      ],
      ['events/submissions:abc/posts', { body: { kind: 'important', body: 'x' } }],
    ] as const) {
      const res = await b.api(req(path, { token: 'wait-token', ...init }));
      expect(res.status, path).toBe(403);
      expect((await res.json()).error, path).toBe('activation_required');
    }
    // Adding an event treats it as signed out (an account is required), not as an account.
    const add = await b.api(
      req('submissions', { token: 'wait-token', body: { deviceId: 'device-0123456789' } }),
    );
    expect([400, 401]).toContain(add.status);
  });

  it('accepts invitations, answers them, takes a contact link and reads its private events', async () => {
    const b = backend({
      invitation_accept_link: () => ({ body: 'submissions:abc' }),
      invitation_answer: () => ({ body: 'accepted' }),
      private_events_for: () => ({ body: [] }),
      event_guests: () => ({ body: [] }),
      contacts_list: () => ({ body: { contacts: [], groups: [] } }),
      contact_link_accept: () => ({ body: { id: 'u1' } }),
      profile_update: () => ({ status: 204, body: null }),
      profile_prefs: () => ({ status: 204, body: null }),
    });
    const token = 'wait-token';
    const link = 'abcdefghijklmnopqrstuv';
    expect((await b.api(req('invitations/accept', { token, body: { token: link } }))).status).toBe(
      200,
    );
    expect(b.call('invitation_accept_link')[0]!.args).toEqual({ p_user: 'p1', p_token: link });
    expect(
      (await b.api(req('private/submissions:abc/answer', { token, body: { accept: true } })))
        .status,
    ).toBe(200);
    expect((await b.api(req('private', { token }))).status).toBe(200);
    expect((await b.api(req('private/submissions:abc/guests', { token }))).status).toBe(200);
    expect((await b.api(req(`contacts/link/${link}`, { token, body: {} }))).status).toBe(200);
    // Setting the name others see is part of accepting.
    expect(
      (await b.api(req('me', { token, method: 'PUT', body: { displayName: 'Ola' } }))).status,
    ).toBe(200);
  });

  it('deletes only itself', async () => {
    const b = backend();
    const res = await b.api(req('me', { token: 'wait-token', method: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(b.deleted).toEqual(['p1']);
    expect(b.call('account_forget')).toHaveLength(0);
  });
});

describe('POST /api/auth/activate', () => {
  it('folds the waiting account in and deletes it; needs both tokens, never a real account', async () => {
    const DOMAIN_USER = { id: 'p1', email: `p-123@${DOMAIN}` };
    const sb = fake(
      { pending_merge: () => ({ body: true }) },
      {
        users: {
          'user-token': { id: 'u1', email: 'ala@example.org' },
          'other-real-token-000000': { id: 'u2', email: 'ola@example.org' },
          'waiting-token-000000000': DOMAIN_USER,
        },
        other: (url, init) =>
          url.startsWith(`${SB}/auth/v1/admin/users/`) && init.method === 'DELETE'
            ? new Response('{}')
            : undefined,
      },
    );
    const api = createApi(env, { config, fetch: sb.fetch, now, extractor: null });
    const call = (token: string | undefined, pendingToken: string) =>
      api(req('auth/activate', { token, body: { pendingToken } }));

    expect((await call(undefined, 'waiting-token-000000000')).status).toBe(401);
    // A waiting account can't activate itself or another.
    expect((await call('waiting-token-000000000', 'waiting-token-000000000')).status).toBe(403);
    // Another real account's token is never folded in.
    expect((await call('user-token', 'other-real-token-000000')).status).toBe(400);
    expect(sb.call('pending_merge')).toHaveLength(0);

    const ok = await call('user-token', 'waiting-token-000000000');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ merged: true });
    expect(sb.call('pending_merge')[0]!.args).toEqual({ p_from: 'p1', p_to: 'u1' });
    expect(sb.requests.some((r) => r.method === 'DELETE' && r.path.endsWith('/users/p1'))).toBe(
      true,
    );
  });
});

describe('POST /api/events/updates', () => {
  it('answers the news of the asked events in one call, never cached', async () => {
    const news = [
      {
        id: 'submissions:abc',
        title: 'Koncert',
        status: 'scheduled',
        lastPostAt: '2026-11-12T11:00:00Z',
        changedAt: null,
        posts: [],
      },
    ];
    const b = backend({ events_updates: () => ({ body: news }) });
    const res = await b.api(
      req('events/updates', { body: { ids: ['submissions:abc', 'ticketmaster:1'] } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ updates: news });
    expect(b.call('events_updates')[0]!.args).toEqual({
      p_ids: ['submissions:abc', 'ticketmaster:1'],
      p_posts: config.app.organiser.updatesPosts,
    });
  });

  it('asks nothing for no ids, and refuses too many', async () => {
    const b = backend();
    const none = await b.api(req('events/updates', { body: { ids: [] } }));
    expect(await none.json()).toEqual({ updates: [] });
    expect(b.call('events_updates')).toHaveLength(0);
    const many = Array.from({ length: config.app.organiser.updatesMaxIds + 1 }, (_, i) => `a:${i}`);
    expect((await b.api(req('events/updates', { body: { ids: many } }))).status).toBe(400);
  });
});

describe('POST /api/private/:id/transfer', () => {
  const to = '0b7a3c1e-2f4d-4e5a-9b6c-7d8e9f0a1b2c';

  it('hands the event to an accepted guest and tells the others', async () => {
    const b = backend({
      event_transfer: () => ({ body: { owner: to, ownerName: 'Ola' } }),
      notice_enqueue: () => ({ body: 0 }),
    });
    const res = await b.api(
      req('private/submissions:abc/transfer', { token: 'user-token', body: { to } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ownerName: 'Ola', notified: 0 });
    expect(b.call('event_transfer')[0]!.args).toEqual({
      p_user: 'u1',
      p_event: 'submissions:abc',
      p_to: to,
    });
    expect(b.call('notice_enqueue')[0]!.args).toMatchObject({
      p_event: 'submissions:abc',
      p_kind: 'important',
      p_body: 'Nowy organizator: Ola',
      p_except: 'u1',
    });
  });

  it('is the owner’s alone, and only to someone who accepted', async () => {
    const b = backend({ event_transfer: fail('P0002') });
    expect(
      (await b.api(req('private/submissions:abc/transfer', { token: 'user-token', body: { to } })))
        .status,
    ).toBe(404);
    expect((await b.api(req('private/submissions:abc/transfer', { body: { to } }))).status).toBe(
      401,
    );
    const blocked = backend({ event_transfer: fail('HQ011') });
    expect(
      (
        await blocked.api(
          req('private/submissions:abc/transfer', { token: 'user-token', body: { to } }),
        )
      ).status,
    ).toBe(403);
  });
});
