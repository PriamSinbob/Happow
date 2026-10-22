import type { TimeWindow } from '@happow/core';
import { config } from '../config';
import { useI18n, type MessageKey } from '../i18n';
import { Icon } from './Icons';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export function windowLabel(t: T, w: TimeWindow): string {
  if ('endOfDay' in w) return t('window.today');
  if ('days' in w) return t('window.days', { days: w.days });
  return w.hours === 0 ? t('window.now') : t('window.hours', { hours: w.hours });
}

/** Lower-case phrase for the summary line: "happening now", "next 2 h", "today". */
export function windowSummary(t: T, w: TimeWindow): string {
  if ('endOfDay' in w) return t('summary.window.today');
  if ('days' in w) return t('summary.window.days', { days: w.days });
  return w.hours === 0 ? t('summary.window.now') : t('summary.window.hours', { hours: w.hours });
}

interface Props {
  window: TimeWindow;
  onWindow: (id: string) => void;
  activeCount: number;
  onOpenFilters: () => void;
}

/** Time-window chips (the app's primary axis) and the entry to category/price filters. */
export function FilterBar({ window, onWindow, activeCount, onOpenFilters }: Props) {
  const { t } = useI18n();
  return (
    <div className="filterbar">
      <div className="chips" role="radiogroup" aria-label={t('window.label')}>
        {config.app.timeWindows.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={w.id === window.id}
            className={`chip${w.id === window.id ? ' is-active' : ''}`}
            onClick={() => onWindow(w.id)}
          >
            {'hours' in w && w.hours === 0 && <span className="chip__live" aria-hidden />}
            {windowLabel(t, w)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`chip chip--filters${activeCount ? ' has-active' : ''}`}
        onClick={onOpenFilters}
        aria-haspopup="dialog"
      >
        <Icon name="filter" size={16} />
        <span className="chip__text">{t('filters.open')}</span>
        {activeCount > 0 && <span className="chip__count">{activeCount}</span>}
      </button>
    </div>
  );
}
