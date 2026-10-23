import type { TimeWindow } from '@happow/core';
import type { MessageKey } from './i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Name of a time range ("Today", "7 days"), the accessible label of its icon. */
export function windowLabel(t: T, w: TimeWindow): string {
  if ('endOfDay' in w) return t('window.today');
  if ('days' in w) return t('window.days', { days: w.days });
  return t('window.hours', { hours: w.hours });
}

/** Calendar icon for whole-day windows (docs/design/icons): Today, ≤ 7 days, longer. Null for hours. */
export function windowRows(w: TimeWindow): 0 | 1 | 2 | null {
  if ('endOfDay' in w) return 0;
  if ('days' in w) return w.days <= 7 ? 1 : 2;
  return null;
}
