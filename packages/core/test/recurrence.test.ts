import { describe, expect, it } from 'vitest';
import { isoWeekday, lastRepeatDay, weeklyStarts } from '../src/recurrence';

/** M12 slice I: weekly repeats, as wall-clock values. */
describe('weekly repeats', () => {
  it('gives every chosen weekday from the start through the until day, at the same time', () => {
    // Sat 7 Nov 2026.
    expect(isoWeekday('2026-11-07T10:00')).toBe(6);
    expect(weeklyStarts('2026-11-07T10:00', { days: [6], until: '2026-11-28' }, 12)).toEqual([
      '2026-11-07T10:00',
      '2026-11-14T10:00',
      '2026-11-21T10:00',
      '2026-11-28T10:00',
    ]);
    expect(weeklyStarts('2026-11-05T18:30', { days: [2, 4], until: '2026-11-12' }, 12)).toEqual([
      '2026-11-05T18:30',
      '2026-11-10T18:30',
      '2026-11-12T18:30',
    ]);
  });

  it("leaves out the start's day when it isn't chosen", () => {
    expect(weeklyStarts('2026-11-07T10:00', { days: [7], until: '2026-11-15' }, 12)).toEqual([
      '2026-11-08T10:00',
      '2026-11-15T10:00',
    ]);
  });

  it('stops at the limit in weeks, and keeps the wall time across the change of clocks', () => {
    expect(lastRepeatDay('2026-11-07T10:00', 12)).toBe('2027-01-30');
    const all = weeklyStarts('2026-11-07T10:00', { days: [6], until: '2027-12-31' }, 12);
    expect(all).toHaveLength(13);
    expect(all.at(-1)).toBe('2027-01-30T10:00');
    // Across the end of summer time (25 Oct 2026) the clock time is unchanged.
    expect(weeklyStarts('2026-10-18T19:00', { days: [7], until: '2026-11-01' }, 12)).toEqual([
      '2026-10-18T19:00',
      '2026-10-25T19:00',
      '2026-11-01T19:00',
    ]);
  });

  it('gives nothing when the until day is before the start', () => {
    expect(weeklyStarts('2026-11-07T10:00', { days: [6], until: '2026-11-01' }, 12)).toEqual([]);
  });
});
