import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { createApi } from '../src';
import { emailSender, resendSender, type EmailMessage, type EmailSender } from '../src/email';
import { alertEmail, sendFollowAlerts, type DueAlert } from '../src/followAlerts';

/** M13 §5: the email sender, sign-in codes by the app, and follow alerts by email. */

const config = loadConfig();
const SB = 'https://proj.supabase.co';

describe('Resend sender (contract)', () => {
  it('posts the documented request and accepts { id }', async () => {
    const f = vi.fn(async () => Response.json({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }));
    const s = resendSender({
      key: 're_test',
      from: 'Happow <hi@example.org>',
      endpoint: 'https://api.resend.com/emails',
      fetch: f as unknown as typeof fetch,
    });
    await s.send({ to: 'ala@example.org', subject: 'Kod', text: 'Twój kod: 123456' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_test');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Happow <hi@example.org>',
      to: ['ala@example.org'],
      subject: 'Kod',
      text: 'Twój kod: 123456',
    });
  });

  it('throws Resend’s message on an error answer', async () => {
    const f = vi.fn(async () =>
      Response.json(
        { statusCode: 403, name: 'validation_error', message: 'The domain is not verified.' },
        { status: 403 },
      ),
    );
    const s = resendSender({ key: 'k', from: 'a@b.c', endpoint: 'https://x', fetch: f as never });
    await expect(s.send({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow(/not verified/);
  });

  it('is off while the provider is none, the sender empty or the secret missing', () => {
    const cfg = config.app.email;
    expect(emailSender({ ...cfg, provider: 'none' }, { RESEND_API_KEY: 'k' })).toBeNull();
    expect(
      emailSender({ ...cfg, provider: 'resend', from: null }, { RESEND_API_KEY: 'k' }),
    ).toBeNull();
    expect(emailSender({ ...cfg, provider: 'resend', from: 'a@b.c' }, {})).toBeNull();
    expect(
      emailSender({ ...cfg, provider: 'resend', from: 'a@b.c' }, { RESEND_API_KEY: 'k' })?.provider,
    ).toBe('resend');
  });
});

describe('sign-in codes sent by the app (auth.emailDelivery "app")', () => {
  const appCfg = {
    ...config,
    app: { ...config.app, auth: { ...config.app.auth, emailDelivery: 'app' as const } },
  };
  function backend() {
    const calls: string[] = [];
    const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const path = String(input).slice(SB.length);
      calls.push(path);
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (path === '/rest/v1/rpc/rate_limit_hit') return Response.json(true);
      if (path === '/auth/v1/admin/users') return Response.json({ id: 'new', email: body.email });
      if (path === '/auth/v1/admin/generate_link')
        return Response.json({
          email_otp: '123456',
          action_link: `${SB}/auth/v1/verify?token=abc&redirect_to=${body.redirect_to}`,
        });
      return new Response('{}', { status: 404 });
    });
    return { f, calls };
  }
  const req = () =>
    new Request('https://happow.example/api/auth/code-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({ email: 'Ala@Example.org', locale: 'pl' }),
    });
  const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'k', SUBMITTER_SALT: 's' };

  it('makes the code and emails it in the person’s language, filing nothing for the admin', async () => {
    const sent: EmailMessage[] = [];
    const email: EmailSender = { provider: 'test', send: async (m) => void sent.push(m) };
    const b = backend();
    const res = await createApi(env, {
      config: appCfg,
      fetch: b.f as never,
      extractor: null,
      email,
    })(req());
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ala@example.org', subject: 'Twój kod do Happow: 123456' });
    expect(sent[0]!.text).toContain('123456');
    expect(b.calls).not.toContain('/rest/v1/rpc/request_code');
  });

  it('answers 503 without a sender, and 502 when sending fails', async () => {
    const none = await createApi(env, {
      config: appCfg,
      fetch: backend().f as never,
      extractor: null,
      email: null,
    })(req());
    expect(none.status).toBe(503);
    const failing: EmailSender = {
      provider: 'test',
      send: async () => {
        throw new Error('down');
      },
    };
    const res = await createApi(env, {
      config: appCfg,
      fetch: backend().f as never,
      extractor: null,
      email: failing,
    })(req());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'email_failed' });
  });
});

describe('follow alerts by email', () => {
  const alert: DueAlert = {
    id: 9,
    eventId: 'tm:1',
    title: 'Trasa 2026',
    venue: 'Hala Stulecia',
    performer: 'Dawid Podsiadło',
    startAt: '2026-11-14T19:00:00Z',
    timezone: 'Europe/Warsaw',
    hidden: false,
    status: 'scheduled',
    email: 'ala@example.org',
    locale: 'en',
    subscriptions: [],
  };

  it('says the same as the push, with the link and how to stop', () => {
    const m = alertEmail(alert, 'https://happow.example');
    expect(m.subject).toBe('New date: Dawid Podsiadło');
    expect(m.text).toContain('https://happow.example/e/tm%3A1');
    expect(m.text).toContain('Switch it off');
  });

  it('emails an alert with no push device and marks it done', async () => {
    const sent: EmailMessage[] = [];
    let done: number[] = [];
    const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const name = String(input).split('/rpc/')[1]!;
      if (name === 'follow_alerts_queue') return Response.json(0);
      if (name === 'follow_alerts_due') return Response.json([alert]);
      if (name === 'follow_alerts_done') {
        done = JSON.parse(String(init.body)).p_ids;
        return Response.json(null);
      }
      return new Response('{}', { status: 404 });
    });
    const secret = JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
      y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
      d: 'jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI',
    });
    await sendFollowAlerts(
      { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'k', VAPID_PRIVATE_KEY: secret },
      new Date('2026-11-05T10:00:00Z'),
      { fetch: f as never, email: { provider: 'test', send: async (m) => void sent.push(m) } },
    );
    expect(sent.map((m) => m.to)).toEqual(['ala@example.org']);
    expect(done).toEqual([9]);
  });
});
