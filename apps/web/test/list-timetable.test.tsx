import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NearbyEvent } from '@happow/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventCard } from '../src/components/EventCard';
import { ListView } from '../src/components/ListView';
import { I18nProvider } from '../src/i18n';

/** The list as a timetable: sections by time, events at one venue under one header. */

vi.mock('maplibre-gl', () => ({ default: {} }));

const now = new Date('2026-10-29T10:00:00Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();

const ev = (id: string, startMin: number, venue: string, distanceM = 300): NearbyEvent => ({
  id,
  title: `Event ${id}`,
  description: null,
  categoryIds: ['other'],
  startAt: at(startMin),
  endAt: at(startMin + 120),
  endEstimated: false,
  timezone: 'Europe/Warsaw',
  venue: { id: venue, name: `Venue ${venue}`, address: null },
  point: { lat: 51.11, lng: 17.03 },
  h3r9: 'x',
  priceMin: null,
  priceMax: null,
  currency: null,
  isFree: false,
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
  lastSeenAt: at(0),
  distanceM,
});

const props = {
  now,
  radiusM: 1000,
  nextRadiusM: null,
  around: [],
  guidance: { hotspot: null, nearest: null, expandTo: null },
  filtered: false,
  onExpand: vi.fn(),
  onClearFilters: vi.fn(),
};

afterEach(cleanup);

describe('the timetable list', () => {
  it('splits today into on now, the next hour and later, and shows a venue once, at its next event', () => {
    const onSelect = vi.fn();
    const events = [
      ev('later-solo', 300, 'b'),
      ev('live', -30, 'a'),
      ev('k1', 20, 'k'),
      ev('k2', 40, 'k'),
      ev('k3', 50, 'k'),
      ev('k4', 55, 'k'),
      ev('k-late', 240, 'k'),
    ];
    const { container } = render(
      <I18nProvider initial="en">
        <ListView {...props} events={events} onSelect={onSelect} />
      </I18nProvider>,
    );
    const headers = [...container.querySelectorAll('.list__day')].map((h) => h.textContent);
    expect(headers).toEqual(['Now', 'Next hour', 'Later']);
    // On now: the ring of time left instead of a start time.
    expect(container.querySelector('.tt-time--live .live-ring')).not.toBeNull();
    // One header for venue k, though its last event is later: three lines, the rest folded.
    expect(screen.getAllByText('Venue k')).toHaveLength(1);
    expect(screen.queryByText('Event k4')).toBeNull();
    expect(screen.queryByText('Event k-late')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /\+2 more/ }));
    expect(screen.getByText('Event k-late')).toBeTruthy();
    fireEvent.click(screen.getByText('Event k2'));
    expect(onSelect).toHaveBeenCalledWith('k2');
  });

  it('labels the folded line "later" when only events from later sections are hidden', () => {
    const events = [ev('k1', 20, 'k'), ev('k-late', 240, 'k'), ev('solo', 300, 'b')];
    const { container } = render(
      <I18nProvider initial="en">
        <ListView {...props} events={events} onSelect={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: /later/ })).toBeTruthy();
    // The lone event still makes "Later"; venue k stays under "Next hour".
    const headers = [...container.querySelectorAll('.list__day')].map((h) => h.textContent);
    expect(headers).toEqual(['Next hour', 'Later']);
  });
});

describe('a card opened from a list row', () => {
  const card = (onBack?: () => void) =>
    render(
      <I18nProvider initial="en">
        <EventCard
          ev={ev('a', 30, 'v1')}
          now={now}
          onBack={onBack}
          onClose={vi.fn()}
          onDetails={vi.fn()}
          onGo={vi.fn()}
        />
      </I18nProvider>,
    );

  it('has a back arrow to the list; a card opened from a pin has none', () => {
    const onBack = vi.fn();
    card(onBack);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(onBack).toHaveBeenCalled();
    cleanup();
    card();
    expect(screen.queryByRole('button', { name: 'Back to the list' })).toBeNull();
  });
});

describe('the list window', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
  const rule = (selector: string) => css.slice(css.indexOf(`\n${selector} {`)).split('}')[0] ?? '';

  it('shows no scroll bar, and waits out of sight without losing its scroll position', () => {
    expect(rule('.list-overlay')).toContain('scrollbar-width: none');
    const parked = rule('.list-overlay.is-parked');
    expect(parked).toContain('visibility: hidden');
    expect(parked).not.toContain('display: none');
  });

  it('gives long titles a second line', () => {
    for (const selector of ['.tt-row__title', '.row__title']) {
      expect(rule(selector)).toContain('-webkit-line-clamp: 2');
      expect(rule(selector)).not.toContain('nowrap');
    }
  });
});
