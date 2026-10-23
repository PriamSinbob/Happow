import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { windowRows } from '../src/components/FilterBar';
import { RangeIcon } from '../src/components/Icons';

// Tests run from apps/web (jsdom), so resolve the design files from the working directory.
const design = (name: string) =>
  readFileSync(resolve(process.cwd(), `../../docs/design/icons/range-${name}.svg`), 'utf8');

describe('time range icons', () => {
  it('map whole-day windows to Today, one week row and two week rows', () => {
    expect(windowRows({ id: 'today', endOfDay: true })).toBe(0);
    expect(windowRows({ id: 'week', days: 7 })).toBe(1);
    expect(windowRows({ id: 'later', days: 14 })).toBe(2);
    expect(windowRows({ id: '2h', hours: 2 })).toBeNull();
  });

  it('draw the same marks as the design files', () => {
    const marks: [0 | 1 | 2, string][] = [
      [0, 'x="6.6" y="12.4" width="3.8" height="3.8"'],
      [1, 'd="M7 14h10"'],
      [2, 'd="M7 13h10M7 17h10"'],
    ];
    for (const [rows, mark] of marks) {
      const { container, unmount } = render(<RangeIcon rows={rows} />);
      const svg = container.innerHTML;
      expect(design(['today', 'week', 'later'][rows]!)).toContain(mark);
      expect(svg).toContain(mark);
      expect(svg).toContain('stroke-width="1.6"');
      unmount();
    }
  });
});
