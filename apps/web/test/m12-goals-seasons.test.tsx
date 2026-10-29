import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NearbyEvent } from '@happow/core';
import { GuidanceCard } from '../src/components/Guidance';
import { ListView } from '../src/components/ListView';
import type { EventRepository } from '../src/data/repository';
import { useDistrictGoal } from '../src/hooks/useDistrictGoal';
import { I18nProvider } from '../src/i18n';

/** M12 slice N: district goals in empty states, and season collections in the list. */

vi.mock('maplibre-gl', () => ({ default: {} }));

const ev = (id: string, title: string, startAt: string, distanceM = 300): NearbyEvent => ({
  id,
  title,
  description: null,
  categoryIds: ['other'],
  startAt,
  endAt: new Date(Date.parse(startAt) + 2 * 3_600_000).toISOString(),
  endEstimated: false,
  timezone: 'Europe/Warsaw',
  venue: { id: 'v', name: 'Podwórko', address: null },
  point: { lat: 51.11, lng: 17.03 },
  h3r9: 'x',
  priceMin: null,
  priceMax: null,
  currency: null,
  isFree: true,
  rules: {},
  entry: null,
  graceMin: null,
  ageMin: null,
  family: null,
  officialUrl: null,
  ticketUrl: null,
  imageUrl: null,
  status: 'scheduled',
  trust: 'crawled',
  confidence: 1,
  lastSeenAt: startAt,
  distanceM,
});
const noGuidance = { hotspot: null, nearest: null, expandTo: null };
const wrap = (node: React.ReactNode) => render(<I18nProvider initial="en">{node}</I18nProvider>);

afterEach(cleanup);

describe('district goals (M12 §6.2)', () => {
  it('ask in the empty card only, with a way to add', () => {
    const onAdd = vi.fn();
    const goal = { id: 'r1', name: 'Nadodrze', count: 3 };
    wrap(
      <GuidanceCard
        guidance={noGuidance}
        radiusM={500}
        mode="empty"
        filtered={false}
        fallbackRadiusM={null}
        onExpand={vi.fn()}
        onClearFilters={vi.fn()}
        goal={goal}
        onAdd={onAdd}
      />,
    );
    expect(
      screen.getByText(/Nadodrze has 3 events this weekend: know something on\?/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }));
    expect(onAdd).toHaveBeenCalled();
    cleanup();
    wrap(
      <GuidanceCard
        guidance={{ ...noGuidance, hotspot: null }}
        radiusM={500}
        mode="hotspot"
        filtered={false}
        fallbackRadiusM={null}
        onExpand={vi.fn()}
        onClearFilters={vi.fn()}
        goal={goal}
        onAdd={onAdd}
      />,
    );
    expect(screen.queryByText(/Nadodrze/)).toBeNull();
  });

  it("asks for this weekend's count only while the reach is empty", async () => {
    const districtGoal = vi.fn(async () => ({ id: 'r1', name: 'Nadodrze', count: 0 }));
    const repo = { districtGoal } as unknown as EventRepository;
    const now = new Date('2026-10-29T12:00:00Z');
    const { result, rerender } = renderHook(
      ({ at }: { at: { lat: number; lng: number } | null }) => useDistrictGoal(repo, at, now),
      { initialProps: { at: null as { lat: number; lng: number } | null } },
    );
    expect(districtGoal).not.toHaveBeenCalled();
    rerender({ at: { lat: 51.12, lng: 17.04 } });
    await waitFor(() => expect(result.current).toMatchObject({ name: 'Nadodrze', count: 0 }));
    const [regionId, , from, to] = districtGoal.mock.calls[0] as unknown as [
      string,
      unknown,
      Date,
      Date,
    ];
    expect(regionId).toBe('wroclaw');
    // Saturday 31 Oct 00:00 to Monday 2 Nov 00:00, Warsaw time.
    expect(from.toISOString()).toBe('2026-10-30T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-01T23:00:00.000Z');
    // A move of a few metres doesn't ask again.
    rerender({ at: { lat: 51.12001, lng: 17.04001 } });
    expect(districtGoal).toHaveBeenCalledTimes(1);
    rerender({ at: null });
    expect(result.current).toBeNull();
  });
});

describe('season collections (M12 §6.3)', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const props = {
    now,
    radiusM: 500,
    nextRadiusM: null,
    guidance: noGuidance,
    filtered: false,
    onSelect: vi.fn(),
    onExpand: vi.fn(),
    onClearFilters: vi.fn(),
  };

  it('offers a running season with its count, and opens it by time, then distance', () => {
    const events = [
      ev('a', 'Koncert', '2026-10-30T18:00:00Z'),
      ev('b', 'Halloween na Nadodrzu', '2026-10-31T17:00:00Z', 900),
    ];
    const around = [ev('c', 'Dyniowe warsztaty', '2026-10-31T17:00:00Z', 200)];
    wrap(<ListView {...props} events={events} around={around} />);
    const chip = screen.getByRole('button', { name: 'Halloween · 2' });
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Halloween: 2 events around you')).toBeTruthy();
    const titles = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(titles.findIndex((x) => x.includes('Dyniowe'))).toBeLessThan(
      titles.findIndex((x) => x.includes('Halloween na')),
    );
    expect(screen.queryByText('Koncert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All events' }));
    expect(screen.getByText('Koncert')).toBeTruthy();
  });

  it('shows nothing extra when no event fits a running season', () => {
    wrap(<ListView {...props} events={[ev('a', 'Koncert', '2026-10-30T18:00:00Z')]} around={[]} />);
    expect(screen.queryByRole('group', { name: 'Seasons' })).toBeNull();
  });
});
