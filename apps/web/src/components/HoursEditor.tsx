import { useMemo } from 'react';
import type { OpeningWeek } from '@happow/core';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

/** One line of the editor: these days, open from–to (or around the clock). */
export interface HoursRow {
  days: boolean[];
  from: string;
  to: string;
  allDay: boolean;
}

const EVERY_DAY = [true, true, true, true, true, true, true];
export const newHoursRow = (days = EVERY_DAY): HoursRow => ({
  days: [...days],
  from: '',
  to: '',
  allDay: false,
});

const minutes = (clock: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(clock);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (min: number) =>
  `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** The week the rows describe; null while a row has no day or no times. Closing may pass midnight. */
export function rowsToWeek(rows: readonly HoursRow[]): OpeningWeek | null {
  const week: OpeningWeek = [[], [], [], [], [], [], []];
  for (const r of rows) {
    const from = r.allDay ? 0 : minutes(r.from);
    const to = r.allDay ? 1440 : minutes(r.to);
    if (from === null || to === null || !r.days.some(Boolean)) return null;
    r.days.forEach((on, d) => on && week[d]!.push([from, to <= from ? to + 1440 : to]));
  }
  return rows.length ? week : null;
}

/** Rows for a stored week: days with the same hours share a row. */
export function weekToRows(week: OpeningWeek): HoursRow[] {
  const rows = new Map<string, HoursRow>();
  week.forEach((spans, d) => {
    for (const [s, e] of spans) {
      const allDay = s === 0 && e === 1440;
      const key = `${s}-${e}`;
      const row = rows.get(key) ?? {
        days: EVERY_DAY.map(() => false),
        from: allDay ? '' : clock(s),
        to: allDay ? '' : clock(e),
        allDay,
      };
      row.days[d] = true;
      rows.set(key, row);
    }
  });
  return [...rows.values()];
}

/**
 * Opening hours as people say them: pick the days, then from and to. More lines for days with
 * other hours or a break in the day.
 */
export function HoursEditor({
  rows,
  onChange,
}: {
  rows: HoursRow[];
  onChange: (rows: HoursRow[]) => void;
}) {
  const { t, lang } = useI18n();
  // 1 Jan 2024 was a Monday.
  const dayNames = useMemo(() => {
    const short = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' });
    return EVERY_DAY.map((_, d) => {
      const at = new Date(Date.UTC(2024, 0, 1 + d));
      return { short: short.format(at).replace('.', ''), long: long.format(at) };
    });
  }, [lang]);
  const set = (i: number, patch: Partial<HoursRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="hours">
      {rows.map((r, i) => (
        <div key={i} className="hours__row">
          <div className="hours__days" role="group" aria-label={t('hours.days')}>
            {dayNames.map((d, j) => (
              <button
                key={j}
                type="button"
                className={`hours__day${r.days[j] ? ' is-on' : ''}`}
                aria-pressed={r.days[j]}
                aria-label={d.long}
                onClick={() => set(i, { days: r.days.map((on, k) => (k === j ? !on : on)) })}
              >
                {d.short}
              </button>
            ))}
          </div>
          <div className="hours__times">
            {!r.allDay && (
              <>
                <input
                  type="time"
                  value={r.from}
                  aria-label={t('hours.from')}
                  onChange={(e) => set(i, { from: e.target.value })}
                />
                <span aria-hidden>–</span>
                <input
                  type="time"
                  value={r.to}
                  aria-label={t('hours.to')}
                  onChange={(e) => set(i, { to: e.target.value })}
                />
              </>
            )}
            <label className="hours__all">
              <input
                type="checkbox"
                checked={r.allDay}
                onChange={(e) => set(i, { allDay: e.target.checked })}
              />
              {t('place.allDay')}
            </label>
            {rows.length > 1 && (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('hours.remove')}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--inline"
        onClick={() =>
          // The days no line has yet, or none: the next line is usually the weekend.
          onChange([...rows, newHoursRow(EVERY_DAY.map((_, d) => !rows.some((r) => r.days[d])))])
        }
      >
        <Icon name="plus" size={16} /> {t('hours.more')}
      </button>
    </div>
  );
}
