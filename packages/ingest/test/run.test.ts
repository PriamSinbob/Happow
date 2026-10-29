import { describe, expect, it, vi } from 'vitest';
import {
  coveringCircle,
  geohash,
  HttpClient,
  HttpError,
  isDue,
  missedWindow,
  plannedRuns,
  redact,
  type NormalizedEvent,
} from '../src';
import { config, region, source } from './helpers';
import { intervalMs } from '@happow/core';

describe('scheduling', () => {
  // The rules on an hourly source; config's own schedules change.
  const tm = { ...source('ticketmaster'), schedule: '60m' };
  const now = new Date('2026-10-24T12:00:00Z');

  it('runs a source when it has never succeeded or its interval has passed', () => {
    expect(isDue(tm, null, now)).toBe(true);
    expect(isDue(tm, new Date('2026-10-24T11:00:00Z'), now)).toBe(true);
    // A cron tick a few minutes early still counts.
    expect(isDue(tm, new Date('2026-10-24T11:03:00Z'), now)).toBe(true);
    expect(isDue(tm, new Date('2026-10-24T11:30:00Z'), now)).toBe(false);
  });

  it('lets a starting run take a source due soon, at most half its interval early', () => {
    const daily = { ...source('nfm'), schedule: '24h' };
    const sixHours = 6 * 3_600_000;
    // Last read 19 h ago: due in 5 h, so a run starting now takes it along.
    expect(isDue(daily, new Date('2026-10-23T17:00:00Z'), now)).toBe(false);
    expect(isDue(daily, new Date('2026-10-23T17:00:00Z'), now, sixHours)).toBe(true);
    // Due in 7 h: it waits for a later run.
    expect(isDue(daily, new Date('2026-10-23T19:00:00Z'), now, sixHours)).toBe(false);
    // An hourly source is never taken more than half an hour early.
    expect(isDue(tm, new Date('2026-10-24T11:40:00Z'), now, sixHours)).toBe(false);
    expect(isDue(tm, new Date('2026-10-24T11:30:00Z'), now, sixHours)).toBe(true);
  });

  it('keeps the dispatcher to a few runs a day: no hourly sources, slow retries', () => {
    const { dispatch } = config.app.ingest;
    expect(dispatch.failedRetryMinutes).toBeGreaterThanOrEqual(360);
    expect(dispatch.batchAheadHours).toBeGreaterThan(0);
    for (const s of config.sources.filter((x) => x.enabled && x.schedule))
      expect(intervalMs(s.schedule!)).toBeGreaterThanOrEqual(12 * 3_600_000);
  });

  it('never schedules sources without a schedule (the manual seed)', () => {
    expect(isDue(source('seed'), null, now)).toBe(false);
  });

  it('plans only enabled sources the region turns on', () => {
    const runs = plannedRuns(config).map((r) => `${r.source.id}@${r.region.id}`);
    expect(runs).toContain('ticketmaster@wroclaw');
    expect(runs).toContain('meetup@wroclaw');
  });
});

describe('geo helpers', () => {
  it('encodes geohashes', () => {
    expect(geohash({ lat: 57.64911, lng: 10.40744 }, 11)).toBe('u4pruydqqvj');
  });

  it('covers the whole region bbox', () => {
    const { radiusM } = coveringCircle(region);
    expect(radiusM).toBeGreaterThan(10_000);
    expect(radiusM).toBeLessThan(25_000);
  });
});

describe('HttpClient', () => {
  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const http = new HttpClient({ userAgent: 'ua', fetch, sleep });
    expect(await http.json('https://api.example/x')).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('does not retry client errors and hides keys in the error', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
    const http = new HttpClient({ userAgent: 'ua', fetch, sleep: async () => {} });
    const err = await http.text('https://api.example/x?apikey=SECRET&a=1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.message).not.toContain('SECRET');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('spaces requests to the rate limit', async () => {
    const waits: number[] = [];
    const fetch = vi.fn(async () => new Response('{}'));
    const http = new HttpClient({
      userAgent: 'ua',
      minIntervalMs: 200,
      fetch,
      sleep: async (ms) => void waits.push(ms),
    });
    await http.text('https://a.example');
    await http.text('https://a.example');
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(150);
  });

  it('redacts credentials in URLs', () => {
    expect(redact('https://x/?apikey=abc&page=1')).toBe('https://x/?apikey=***&page=1');
  });
});

describe('possibly cancelled window', () => {
  const window = { from: new Date('2026-10-24T00:00:00Z'), to: new Date('2026-10-26T00:00:00Z') };
  const at = (startAt: string) => ({ event: { startAt } }) as unknown as NormalizedEvent;

  it('checks only up to the latest start the run returned (paged APIs cut the tail)', () => {
    const w = missedWindow(window, [at('2026-10-24T18:00:00Z'), at('2026-10-25T09:00:00Z')], 2);
    expect(w).toEqual({ from: window.from, to: new Date('2026-10-25T09:00:00Z'), afterRuns: 2 });
  });

  it('checks nothing after an empty run', () => {
    expect(missedWindow(window, [], 2)).toBeNull();
  });
});
