import { describe, expect, it } from 'vitest';
import { dispatchLookbackMs, dueForDispatch, type RunRecord } from '../src/schedule';
import { config } from './helpers';

const policy = { skippedBackoffHours: 24, failedRetryMinutes: 60, runningTimeoutMinutes: 40 };
const now = new Date('2026-10-24T12:00:00Z');
const at = (iso: string) => new Date(`2026-10-24T${iso}:00Z`);
const run = (sourceId: string, startedAt: Date, status: RunRecord['status']): RunRecord => ({
  sourceId,
  regionId: 'wroclaw',
  startedAt,
  status,
});
/** Every scheduled source succeeded recently, so nothing is due unless a test changes that. */
const fresh: RunRecord[] = ['ticketmaster', 'meetup', 'ebilet', 'wroclaw-go', 'nfm'].map((id) =>
  run(id, at('11:50'), 'ok'),
);
const without = (id: string) => fresh.filter((r) => r.sourceId !== id);

describe('dueForDispatch', () => {
  it('starts nothing while every source is within its schedule', () => {
    expect(dueForDispatch(config, fresh, now, policy)).toEqual([]);
  });

  it('starts a run when a source has never run or its interval has passed', () => {
    expect(dueForDispatch(config, without('nfm'), now, policy)).toEqual(['nfm@wroclaw']);
    const stale = [...without('ticketmaster'), run('ticketmaster', at('10:58'), 'ok')];
    expect(dueForDispatch(config, stale, now, policy)).toEqual(['ticketmaster@wroclaw']);
  });

  it('backs off a day after a run skipped the source for missing secrets', () => {
    const skipped = [...without('meetup'), run('meetup', at('06:00'), 'skipped')];
    expect(dueForDispatch(config, skipped, now, policy)).toEqual([]);
    const later = new Date('2026-10-25T06:01:00Z');
    expect(dueForDispatch(config, skipped, later, policy)).toContain('meetup@wroclaw');
  });

  it('waits for a running source unless it has hung', () => {
    const running = [...without('nfm'), run('nfm', at('11:40'), 'running')];
    expect(dueForDispatch(config, running, now, policy)).toEqual([]);
    const hung = [...without('nfm'), run('nfm', at('11:00'), 'running')];
    expect(dueForDispatch(config, hung, now, policy)).toEqual(['nfm@wroclaw']);
  });

  it('retries a failed source after the shorter of its interval and the retry delay', () => {
    const failed = [
      ...without('ticketmaster'),
      run('ticketmaster', at('09:00'), 'ok'),
      run('ticketmaster', at('11:30'), 'failed'),
    ];
    expect(dueForDispatch(config, failed, now, policy)).toEqual([]);
    expect(dueForDispatch(config, failed, at('12:31'), policy)).toEqual(['ticketmaster@wroclaw']);
  });

  it('never dispatches for sources without a schedule or turned off', () => {
    const due = dueForDispatch(config, [], now, policy);
    expect(due).not.toContain('seed@wroclaw');
    expect(due).not.toContain('submissions@wroclaw');
    expect(due).not.toContain('threads@wroclaw');
  });

  it('reads back far enough for the longest schedule and the skip backoff', () => {
    expect(dispatchLookbackMs(config, policy)).toBe(25 * 3_600_000);
  });
});
