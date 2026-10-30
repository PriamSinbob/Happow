import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import qrcode from 'qrcode-generator';
import { GoButtons } from '../src/components/EventMeta';
import { ShareSheet } from '../src/components/ShareSheet';
import { rowToEvent, type Row } from '../src/data/supabase';
import { eventUrl } from '../src/hooks/useHashRoute';
import { I18nProvider } from '../src/i18n';
import { qrPath, shareText } from '../src/shareEvent';

/** M9 slice C: sharing an event, and the in-app route first. */

const ev = rowToEvent({
  id: 'ticketmaster:Z7 x',
  title: 'Koncert jazzowy',
  description: null,
  category_ids: ['music'],
  start_at: '2026-10-31T18:00:00Z',
  end_at: '2026-10-31T20:30:00Z',
  end_estimated: false,
  timezone: 'Europe/Warsaw',
  venue_id: 'v1',
  venue_name: 'Klub Pod Kolumnami',
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
  distance_m: 300,
} as unknown as Row);

const url = 'https://happow.example/e/ticketmaster%3AZ7%20x';

function sheet(onToast = vi.fn(), onClose = vi.fn()) {
  render(
    <I18nProvider initial="en">
      <ShareSheet ev={ev} url={url} onClose={onClose} onToast={onToast} />
    </I18nProvider>,
  );
  return { onToast, onClose };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.assign(navigator, { share: undefined, canShare: undefined });
});

describe('sharing (M9 slice C)', () => {
  it('links to the clean /e/<id> form', () => {
    expect(eventUrl('ticketmaster:Z7 x')).toBe(`${window.location.origin}/e/ticketmaster%3AZ7%20x`);
  });

  it('sends title, day and time, and venue as the text', () => {
    expect(shareText(ev, 'en')).toMatch(/^Koncert jazzowy · .*31.* 7:00 PM · Klub Pod Kolumnami$/);
  });

  it('shares the link with its text through the share sheet', async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share });
    const { onClose } = sheet();
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(share).toHaveBeenCalledWith({ title: ev.title, text: shareText(ev, 'en'), url });
  });

  it('copies the link where there is no share sheet', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { onToast } = sheet();
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Link copied'));
    expect(writeText).toHaveBeenCalledWith(url);
    // No file sharing in this browser: no image button.
    expect(screen.queryByRole('button', { name: /share as image/i })).toBeNull();
  });

  it('shares the preview card as an image where the browser can share files', async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share, canShare: () => true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([new Uint8Array([137, 80])]), { status: 200 })),
    );
    sheet();
    fireEvent.click(screen.getByRole('button', { name: /share as image/i }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('/e/ticketmaster%3AZ7%20x/preview.png');
    const data = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(data.files![0]!.type).toBe('image/png');
    expect(data.text).toContain(url);
  });

  it('draws a QR code of the clean link on the device', () => {
    sheet();
    const qr = qrPath(url);
    const ref = qrcode(0, 'M');
    ref.addData(url);
    ref.make();
    expect(qr.size).toBe(ref.getModuleCount());
    // Every dark module is in the path, and only those.
    const dark = qr.d.split('M').filter(Boolean).length;
    let expected = 0;
    for (let r = 0; r < qr.size; r++)
      for (let c = 0; c < qr.size; c++) if (ref.isDark(r, c)) expected++;
    expect(dark).toBe(expected);
    expect(screen.getByRole('img', { name: /scan to open/i })).toBeTruthy();
    expect(screen.getByText(url)).toBeTruthy();
  });

  it('puts the in-app route first and Google Maps second', () => {
    render(
      <I18nProvider initial="en">
        <GoButtons ev={ev} onGo={() => {}} />
      </I18nProvider>,
    );
    const [first, second] = [
      screen.getByRole('button', { name: /route in happow/i }),
      screen.getByRole('link', { name: /google maps/i }),
    ];
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.className).toContain('btn--primary');
    expect(second.className).not.toContain('btn--primary');
  });
});
