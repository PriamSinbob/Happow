import { describe, expect, it } from 'vitest';
import { windowRows } from '../src/windows';

describe('time range icons', () => {
  it('map whole-day windows to Today, one week row and two week rows', () => {
    expect(windowRows({ id: 'today', endOfDay: true })).toBe(0);
    expect(windowRows({ id: 'week', days: 7 })).toBe(1);
    expect(windowRows({ id: 'later', days: 14 })).toBe(2);
    expect(windowRows({ id: 'future', afterDays: 14, months: 12 })).toBe('future');
    expect(windowRows({ id: '2h', hours: 2 })).toBeNull();
  });
});
