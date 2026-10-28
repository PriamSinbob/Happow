import { describe, expect, it, vi } from 'vitest';
import { saveWeeklyMetrics } from '../src';
import { localWeekdayHour } from '../src/metrics';

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' };
const deps = (saved = true) => {
  const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    if (String(input) === `${SB}/rest/v1/rpc/metrics_save`) return Response.json(saved);
    throw new Error(`unexpected ${String(input)}`);
  });
  return {
    fetch,
    app: {
      defaultRegion: 'wroclaw',
      metrics: { eveningFromHour: 18, weekly: { weekday: 1, hour: 8 } },
    },
    regions: [{ id: 'wroclaw', timezone: 'Europe/Warsaw' }],
  };
};

describe('localWeekdayHour', () => {
  it('reads the wall clock of the time zone, across the change to winter time', () => {
    // Sun 25 Oct 2026: 01:00 UTC is 03:00 summer time → 02:00 winter time in Warsaw.
    expect(localWeekdayHour(new Date('2026-10-25T00:30:00Z'), 'Europe/Warsaw')).toEqual({
      weekday: 7,
      hour: 2,
    });
    expect(localWeekdayHour(new Date('2026-10-25T01:30:00Z'), 'Europe/Warsaw')).toEqual({
      weekday: 7,
      hour: 2,
    });
    expect(localWeekdayHour(new Date('2026-10-25T23:00:00Z'), 'Europe/Warsaw')).toEqual({
      weekday: 1,
      hour: 0,
    });
  });
});

describe('saveWeeklyMetrics', () => {
  it('does nothing before Monday 08:00 local time', async () => {
    const d = deps();
    // Mon 26 Oct 2026 07:45 in Warsaw (UTC+1).
    const r = await saveWeeklyMetrics(env, new Date('2026-10-26T06:45:00Z'), d);
    expect(r).toEqual({ region: 'wroclaw', due: false });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('does nothing on other days', async () => {
    const d = deps();
    const r = await saveWeeklyMetrics(env, new Date('2026-10-27T09:00:00Z'), d);
    expect(r.due).toBe(false);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('saves from Monday 08:00 local time on, with the configured evening', async () => {
    const d = deps();
    const now = new Date('2026-10-26T07:00:00Z');
    const r = await saveWeeklyMetrics(env, now, d);
    expect(r).toEqual({ region: 'wroclaw', due: true, saved: true });
    const init = d.fetch.mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body))).toEqual({
      p_region: 'wroclaw',
      p_at: now.toISOString(),
      p_evening_hour: 18,
    });
  });

  it('reports a week that already has its row', async () => {
    const r = await saveWeeklyMetrics(env, new Date('2026-10-26T15:00:00Z'), deps(false));
    expect(r).toEqual({ region: 'wroclaw', due: true, saved: false });
  });

  it('says why when the Supabase secrets are missing', async () => {
    const d = deps();
    const r = await saveWeeklyMetrics({}, new Date('2026-10-26T07:00:00Z'), d);
    expect(r.reason).toMatch(/SUPABASE_URL/);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('reads the real config by default', async () => {
    const r = await saveWeeklyMetrics({}, new Date('2026-10-27T09:00:00Z'));
    expect(r).toEqual({ region: 'wroclaw', due: false });
  });
});
