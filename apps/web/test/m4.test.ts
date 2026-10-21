import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../src/api';
import { errorText } from '../src/errors';
import { visibleFlag, withFlag } from '../src/flags';
import { routeHref, useRoute } from '../src/hooks/useHashRoute';
import { translate } from '../src/i18n';
import { rowToEvent } from '../src/data/supabase';

describe('routes', () => {
  it('round-trips event ids with source prefixes', () => {
    window.history.replaceState(null, '', '/');
    const { result } = renderHook(() => useRoute());
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]({ name: 'event', id: 'ticketmaster:Z7 x' }));
    expect(window.location.hash).toBe('#/e/ticketmaster%3AZ7%20x');
    expect(result.current[0]).toEqual({ name: 'event', id: 'ticketmaster:Z7 x' });
    act(() => result.current[1]({ name: 'about' }, true));
    expect(window.location.hash).toBe('#/about');
    expect(routeHref({ name: 'add' })).toBe('#/add');
  });
});

describe('api errors', () => {
  const t = (key: Parameters<typeof translate>[1], p?: Record<string, string | number>) =>
    translate('pl', key, p);
  it('maps codes to translated sentences', () => {
    expect(errorText(t, new ApiError(429, 'rate_limited'), 'pl')).toBe(
      translate('pl', 'error.rate_limited'),
    );
    expect(errorText(t, new ApiError(400, 'outside_region'), 'pl')).toContain('Wrocław');
    expect(errorText(t, new ApiError(500, 'server_error'), 'pl')).toBe(
      translate('pl', 'error.generic'),
    );
    expect(errorText(t, new TypeError('x'), 'pl')).toBe(translate('pl', 'error.network'));
  });
});

it('treats rows without the verified column as verified', () => {
  const row = {
    id: 'a',
    title: 'T',
    description: null,
    category_ids: [],
    start_at: '2026-10-20T10:00:00Z',
    end_at: '2026-10-20T12:00:00Z',
    end_estimated: false,
    timezone: 'Europe/Warsaw',
    venue_id: null,
    venue_name: null,
    venue_address: null,
    lat: 51,
    lng: 17,
    h3_r9: 'x',
    price_min: null,
    price_max: null,
    currency: null,
    is_free: true,
    rules: {},
    official_url: null,
    ticket_url: null,
    image_url: null,
    status: 'scheduled',
    trust: 'community',
    confidence: 1,
    last_seen_at: '2026-10-20T10:00:00Z',
  } as unknown as Parameters<typeof rowToEvent>[0];
  expect(rowToEvent(row).verified).toBe(true);
  expect(rowToEvent({ ...row, verified: false }).verified).toBe(false);
});

describe('community flags', () => {
  type Row = Parameters<typeof rowToEvent>[0];
  const row = {
    id: 'e1',
    title: 'T',
    description: null,
    category_ids: [],
    start_at: '2026-10-20T10:00:00Z',
    end_at: '2026-10-20T12:00:00Z',
    end_estimated: false,
    timezone: 'Europe/Warsaw',
    venue_id: null,
    lat: 51,
    lng: 17,
    h3_r9: 'x',
    is_free: true,
    rules: {},
    status: 'scheduled',
    trust: 'api',
    confidence: 1,
    last_seen_at: '2026-10-20T10:00:00Z',
    flag_reason: 'venue_closed',
    flag_count: 2,
    flag_at: '2026-10-20T10:30:00Z',
  } as unknown as Row;
  const base = rowToEvent(row);

  it('maps open status reports from the database', () => {
    expect(base.flag).toEqual({ reason: 'venue_closed', count: 2, at: '2026-10-20T10:30:00Z' });
    expect(rowToEvent({ ...row, flag_count: 0 }).flag).toBeNull();
    expect(rowToEvent({ ...row, flag_reason: 'nonsense' }).flag).toBeNull();
  });

  it("shows the server's flag at the threshold, and this device's own report at once", () => {
    expect(visibleFlag(base, {})).toEqual(base.flag);
    const none = { ...base, flag: null };
    expect(visibleFlag(none, {})).toBeNull();
    const mine = { e1: { reason: 'weather' as const, at: '2026-10-20T11:00:00Z' } };
    expect(visibleFlag(none, mine)).toEqual({ reason: 'weather', count: 1, at: mine.e1.at });
    expect(withFlag(base, {})).toBe(base); // unchanged events keep their identity
  });
});
