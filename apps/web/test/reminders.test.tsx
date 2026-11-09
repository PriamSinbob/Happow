import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReminderSheet } from '../src/components/ReminderSheet';
import { rowToEvent, type Row } from '../src/data/supabase';
import { I18nProvider } from '../src/i18n';
import { plans } from '../src/plans';
import { pushSupport, reminders } from '../src/reminders';

/** Web push on the device and the bell's reminders. */

vi.mock('../src/auth', () => ({ accessToken: async () => null }));

const ev = rowToEvent({
  id: 'tm:1',
  title: 'Koncert',
  category_ids: ['music'],
  start_at: '2026-11-06T19:00:00Z',
  end_at: '2026-11-06T21:00:00Z',
  timezone: 'Europe/Warsaw',
  venue_id: null,
  lat: 51.11,
  lng: 17.03,
  is_free: true,
  rules: {},
  status: 'scheduled',
  trust: 'api',
  confidence: 1,
  last_seen_at: '2026-11-06T10:00:00Z',
  distance_m: 300,
} as unknown as Row);

let calls: { path: string; body: Record<string, unknown> }[];
function server(answer: (path: string, body: Record<string, unknown>) => Response | unknown) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace('/api/', '');
      const body = JSON.parse(String(init.body ?? '{}'));
      calls.push({ path, body });
      const a = answer(path, body);
      return a instanceof Response ? a : Response.json(a);
    }),
  );
}

/** A browser with push: a service worker registration and a permission prompt. */
function browserWithPush(answer: NotificationPermission = 'granted') {
  let current: { toJSON: () => unknown } | null = null;
  const subscribe = vi.fn(async (_options: PushSubscriptionOptionsInit) => {
    current = {
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
      }),
    };
    return current;
  });
  const reg = { pushManager: { getSubscription: async () => current, subscribe } };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(reg) },
    configurable: true,
  });
  const requestPermission = vi.fn(async () => answer);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  return { subscribe, requestPermission };
}

const ui = (node: React.ReactNode) => render(<I18nProvider initial="en">{node}</I18nProvider>);

beforeEach(() => {
  localStorage.clear();
  plans.reset([]);
  reminders.reset({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('web push on the device', () => {
  it('knows when push can work', () => {
    expect(pushSupport()).toBe('none');
    browserWithPush();
    expect(pushSupport()).toBe('ok');
    vi.stubGlobal('Notification', { permission: 'denied' });
    expect(pushSupport()).toBe('blocked');
  });

  it('asks permission only on the first reminder, subscribes with the server key, once', async () => {
    const { subscribe, requestPermission } = browserWithPush();
    server((path) => (path === 'push/key' ? { key: 'BAAA' } : { ok: true }));
    expect(requestPermission).not.toHaveBeenCalled();
    await reminders.set('tm:1', '60', 'pl');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]![0]).toMatchObject({ userVisibleOnly: true });
    expect(calls.map((c) => c.path)).toEqual(['push/key', 'push/subscribe', 'reminders']);
    expect(calls[1]!.body).toMatchObject({
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
      lang: 'pl',
    });
    expect(calls[2]!.body).toMatchObject({ eventId: 'tm:1', lead: '60' });
    expect(reminders.get('tm:1')).toBe('60');
    // The next reminder doesn't subscribe again.
    await reminders.set('tm:2', '15', 'pl');
    expect(calls.slice(3).map((c) => c.path)).toEqual(['reminders']);
    // And the last lead chosen is offered first next time.
    expect(reminders.defaultLead()).toBe('15');
  });

  it('stops when the person says no', async () => {
    browserWithPush('denied');
    server(() => ({ ok: true }));
    await expect(reminders.set('tm:1', '60', 'en')).rejects.toThrow('denied');
    expect(calls).toEqual([]);
    expect(reminders.get('tm:1')).toBeNull();
  });
});

describe('the bell', () => {
  it('offers the leads with 60 minutes first, and sets one', async () => {
    browserWithPush();
    server((path) => (path === 'push/key' ? { key: 'BAAA' } : { ok: true }));
    const onClose = vi.fn();
    ui(<ReminderSheet ev={ev} onClose={onClose} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      '15 min before',
      '30 min before',
      '1 hour before',
      '2 hours before',
      'The evening before, at 18:00',
    ]);
    expect(screen.getByRole('radio', { name: '1 hour before' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'The evening before, at 18:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remind me' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(reminders.get('tm:1')).toBe('dayBefore');
  });

  it('without push, says why and offers the calendar instead', () => {
    ui(<ReminderSheet ev={ev} onClose={() => {}} />);
    expect(screen.getByText(/This browser can't show reminders/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('explains a refusal from the server', async () => {
    browserWithPush();
    server((path) =>
      path === 'push/key'
        ? { key: 'BAAA' }
        : path === 'reminders'
          ? Response.json({ error: 'reminder_refused' }, { status: 409 })
          : { ok: true },
    );
    ui(<ReminderSheet ev={ev} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remind me' }));
    expect((await screen.findByRole('alert')).textContent).toContain('has started');
  });

  it('turns a reminder off', async () => {
    browserWithPush();
    server(() => ({ ok: true }));
    reminders.reset({ 'tm:1': '30' });
    const onClose = vi.fn();
    ui(<ReminderSheet ev={ev} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'No reminder' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]!.body).toMatchObject({ eventId: 'tm:1', lead: null });
    expect(reminders.get('tm:1')).toBeNull();
  });
});

describe('reminders follow your plans', () => {
  it('removing an event from your plans removes its reminder', async () => {
    server(() => ({ ok: true }));
    plans.toggle('tm:1');
    reminders.reset({ 'tm:1': '60', 'tm:2': '15' });
    plans.toggle('tm:2');
    plans.toggle('tm:1');
    expect(reminders.get('tm:1')).toBeNull();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.find((c) => c.body.eventId === 'tm:1')!.body.lead).toBeNull();
  });

  it("refreshes from the server's pending list", async () => {
    server(() => ({ reminders: { 'tm:9': '120' } }));
    reminders.reset({ 'tm:1': '60' });
    await reminders.refresh();
    expect(calls[0]!.path).toBe('reminders/list');
    expect(reminders.get('tm:9')).toBe('120');
    expect(reminders.get('tm:1')).toBeNull();
  });
});
