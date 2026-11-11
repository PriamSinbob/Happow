import { render } from '@testing-library/react';
import { beforeAll, expect, it } from 'vitest';
import { TimeLine } from '../src/components/TimeLine';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';

beforeAll(() => {
  // jsdom has none; the line only uses it to follow its own width.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// 18:13 in Warsaw: the axis runs through the evening to midnight.
const NOW = new Date('2026-11-10T17:13:00Z');
const today = config.app.timeWindows.find((w) => w.id === 'today')!;

function hours(lang: 'pl' | 'en'): string[] {
  const { container } = render(
    <I18nProvider initial={lang}>
      <TimeLine
        window={today}
        onWindow={() => {}}
        now={NOW}
        timeZone="Europe/Warsaw"
        at={null}
        onAt={() => {}}
        day={null}
        onDay={() => {}}
        events={[]}
      />
    </I18nProvider>,
  );
  return [...container.querySelectorAll('.timeline__num')].map((n) => n.textContent ?? '');
}

it('counts the axis in the language’s clock, like the times beside it', () => {
  const pl = hours('pl');
  expect(pl).toContain('19');
  expect(pl).toContain('23');

  const en = hours('en');
  expect(en).toContain('7');
  expect(en).toContain('11');
  // No 24-hour numbers next to "6:13 PM".
  expect(en.some((h) => Number(h) > 12)).toBe(false);
});
