import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThanksButton } from '../src/components/GoThere';
import { I18nProvider } from '../src/i18n';
import { thanked } from '../src/thanks';

/** M12 slice M: a one-tap thanks once you've arrived, once per device. */

vi.mock('maplibre-gl', () => ({ default: {} }));

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('thanks after arriving (M12 §6.4)', () => {
  it('sends one anonymous thanks and remembers it on the device', async () => {
    const fetchMock = vi.fn(async () => ok({ added: true }, 202));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <I18nProvider initial="en">
        <ThanksButton eventId="submissions:e1" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thanks' }));
    expect(await screen.findByText('Thanks sent to whoever added it')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/thanks');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ deviceId: expect.any(String), eventId: 'submissions:e1' });
    // No account, no name: only the device id the counts already use.
    expect(new Headers(init.headers).get('authorization')).toBeNull();
    expect(thanked('submissions:e1')).toBe(true);
    cleanup();
    render(
      <I18nProvider initial="en">
        <ThanksButton eventId="submissions:e1" />
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Thanks' })).toBeNull();
  });

  it('stays for another try when sending fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ error: 'rate_limited' }, 429)),
    );
    render(
      <I18nProvider initial="en">
        <ThanksButton eventId="submissions:e2" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thanks' }));
    await vi.waitFor(() =>
      expect((screen.getByRole('button', { name: 'Thanks' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(thanked('submissions:e2')).toBe(false);
  });
});
