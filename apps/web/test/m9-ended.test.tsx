import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NearbyEvent } from '@happow/core';
import { EventDetail } from '../src/components/EventDetail';
import { liveNearby } from '../src/components/NearbyNow';
import { rowToEvent, type Row } from '../src/data/supabase';
import { I18nProvider } from '../src/i18n';

/** M9 slice D: a link to an ended event still leads somewhere live. */

const event = (id: string, over: Partial<Row> = {}): NearbyEvent =>
  rowToEvent({
    id,
    title: `Event ${id}`,
    description: null,
    category_ids: ['music'],
    start_at: '2026-10-31T18:00:00Z',
    end_at: '2026-10-31T20:30:00Z',
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
    last_seen_at: '2026-10-30T10:00:00Z',
    distance_m: 300,
    ...over,
  } as unknown as Row);

const now = new Date('2026-11-02T18:00:00Z');
const live = (id: string, distance_m: number, over: Partial<Row> = {}) =>
  event(id, {
    start_at: '2026-11-02T17:00:00Z',
    end_at: '2026-11-02T21:00:00Z',
    distance_m,
    ...over,
  });

afterEach(cleanup);

describe('ended links (M9 slice D)', () => {
  it('lists only live events, nearest first, without the ended one', () => {
    const list = liveNearby(
      [
        live('far', 900),
        live('near', 100),
        live('cancelled', 50, { status: 'cancelled' }),
        live('later', 10, { start_at: '2026-11-02T19:00:00Z' }),
        event('old'),
      ],
      now,
      'old',
      5,
    );
    expect(list.map((e) => e.id)).toEqual(['near', 'far']);
    expect(liveNearby([live('a', 1), live('b', 2)], now, 'x', 1).map((e) => e.id)).toEqual(['a']);
  });

  it('marks the card ended and offers what is on now nearby', async () => {
    const onOpenEvent = vi.fn();
    const loadNearby = vi.fn(async () => [live('near', 120), event('old')]);
    render(
      <I18nProvider initial="en">
        <EventDetail
          ev={event('old')}
          loading={false}
          now={now}
          saved={false}
          onToggleSave={vi.fn()}
          onClose={vi.fn()}
          onReported={vi.fn()}
          onGo={vi.fn()}
          loadCredit={async () => null}
          loadNearby={loadNearby}
          onOpenEvent={onOpenEvent}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('This event has ended')).toBeTruthy();
    expect(loadNearby).toHaveBeenCalledWith({ lat: 51.11, lng: 17.03 }, expect.anything());
    fireEvent.click(await screen.findByRole('button', { name: /Event near/ }));
    expect(onOpenEvent).toHaveBeenCalledWith('near');
    expect(screen.queryByRole('button', { name: /Event old/ })).toBeNull();
  });

  it('says so when nothing is on nearby, and shows nothing extra for a live event', async () => {
    const props = {
      loading: false,
      now,
      saved: false,
      onToggleSave: vi.fn(),
      onClose: vi.fn(),
      onReported: vi.fn(),
      onGo: vi.fn(),
      loadCredit: async () => null,
      onOpenEvent: vi.fn(),
    };
    const { unmount } = render(
      <I18nProvider initial="en">
        <EventDetail {...props} ev={event('old')} loadNearby={async () => []} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Nothing is on nearby right now.')).toBeTruthy();
    unmount();
    const loadNearby = vi.fn(async () => []);
    render(
      <I18nProvider initial="en">
        <EventDetail {...props} ev={live('now', 10)} loadNearby={loadNearby} />
      </I18nProvider>,
    );
    expect(screen.queryByText('This event has ended')).toBeNull();
    expect(loadNearby).not.toHaveBeenCalled();
  });

  it('shows a hidden event as not available, never with its details', () => {
    // byId reads events_public, which leaves hidden events out, so the card gets no event.
    render(
      <I18nProvider initial="en">
        <EventDetail
          ev={null}
          loading={false}
          now={now}
          saved={false}
          onToggleSave={vi.fn()}
          onClose={vi.fn()}
          onReported={vi.fn()}
          onGo={vi.fn()}
          loadCredit={async () => null}
          loadNearby={async () => []}
          onOpenEvent={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/no longer listed/i)).toBeTruthy();
  });
});
