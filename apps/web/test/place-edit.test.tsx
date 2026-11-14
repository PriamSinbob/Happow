import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaceEdit } from '../src/components/PlaceEdit';
import { I18nProvider } from '../src/i18n';
import { openPlaces, toPlaces } from '../src/places';

/** Correcting a place from its card: each choice sends one change. */

const changePlace = vi.hoisted(() =>
  vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true })),
);
const hereNow = vi.hoisted(() => vi.fn(async () => ({ lat: 51.111, lng: 17.031 })));
vi.mock('../src/places', async (orig) => ({
  ...(await orig<typeof import('../src/places')>()),
  changePlace,
  hereNow,
}));

const tz = 'Europe/Warsaw';
const now = new Date('2026-11-10T20:00:00+01:00');
const [place] = openPlaces(
  toPlaces([
    {
      id: 'node/1',
      name: 'Pod Latarnią',
      kind: 'amenity=pub',
      lat: 51.11,
      lng: 17.03,
      address: null,
      website: null,
      opening_hours: 'Mo-Su 16:00-23:00',
    },
  ]),
  now,
  tz,
  { lat: 51.11, lng: 17.03 },
  {},
  [],
);

describe('correcting a place', () => {
  const onClose = vi.fn();
  const open = () =>
    render(
      <I18nProvider initial="en">
        <PlaceEdit place={place!} now={now} timeZone={tz} onClose={onClose} />
      </I18nProvider>,
    );
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('marks a private party until the place closes', async () => {
    open();
    fireEvent.click(screen.getByText('Private party'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(changePlace).toHaveBeenCalledWith('node/1', {
      privateUntil: new Date('2026-11-10T23:00:00+01:00').toISOString(),
    });
  });

  it('saves new hours, starting from the ones it has', async () => {
    open();
    fireEvent.click(screen.getByText('Different opening hours'));
    fireEvent.change(screen.getByLabelText('Open until'), { target: { value: '01:00' } });
    fireEvent.click(screen.getByText('Save the hours'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(changePlace).toHaveBeenCalledWith('node/1', { openingHours: 'Mo-Su 16:00-01:00' });
  });

  it('reports a place closed for good from where the phone is, and says how many more it takes', async () => {
    changePlace.mockResolvedValueOnce({ ok: true, closed: false, reports: 1, needed: 3 });
    open();
    fireEvent.click(screen.getByText('Closed for good'));
    expect(changePlace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Report closed for good'));
    await screen.findByText(/Reports so far: 1 of 3/);
    expect(changePlace).toHaveBeenCalledWith('node/1', {
      closed: true,
      at: { lat: 51.111, lng: 17.031 },
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends no report without the phone's position", async () => {
    hereNow.mockRejectedValueOnce(new Error('denied'));
    open();
    fireEvent.click(screen.getByText('Closed for good'));
    fireEvent.click(screen.getByText('Report closed for good'));
    await screen.findByRole('alert');
    expect(changePlace).not.toHaveBeenCalled();
  });
});
