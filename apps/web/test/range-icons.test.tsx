import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { windowRows } from '../src/windows';
import { FAST_FORWARD, RangeIcon } from '../src/components/Icons';

describe('time range icons', () => {
  it('map whole-day windows to Today, one week row and two week rows', () => {
    expect(windowRows({ id: 'today', endOfDay: true })).toBe(0);
    expect(windowRows({ id: 'week', days: 7 })).toBe(1);
    expect(windowRows({ id: 'later', days: 14 })).toBe(2);
    expect(windowRows({ id: 'future', afterDays: 14, months: 12 })).toBe('future');
    expect(windowRows({ id: '2h', hours: 2 })).toBeNull();
  });

  it('draw one filled day, one row, two rows or fast-forward', () => {
    const marks: [0 | 1 | 2 | 'future', string][] = [
      ['future', `d="${FAST_FORWARD}"`],
      [0, 'x="6.6" y="12.4" width="3.8" height="3.8"'],
      [1, 'd="M7 14h10"'],
      [2, 'd="M7 13h10M7 17h10"'],
    ];
    for (const [rows, mark] of marks) {
      const { container, unmount } = render(<RangeIcon rows={rows} />);
      const svg = container.innerHTML;
      expect(svg).toContain(mark);
      expect(svg).toContain('stroke-width="1.6"');
      unmount();
    }
  });
});
