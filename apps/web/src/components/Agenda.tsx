import { agendaDays, type NearbyEvent } from '@happow/core';
import { config, region } from '../config';
import { formatRelativeDay } from '../format';
import { useI18n } from '../i18n';
import { downloadDayIcs } from '../ics';
import { eventUrl } from '../hooks/useHashRoute';
import { Icon } from './Icons';
import { Row } from './ListView';

/**
 * The list in "My plans" and "Saved" (M10 §1): your events by day in the region's time zone, a
 * running one first today; ended ones folded under "Past". A day with two or more events offers
 * the evening queue; each day can go into the phone's calendar in one file.
 */
export function Agenda({
  events,
  gone,
  now,
  isGoing,
  onSelect,
  onUnsave,
  onRemoveGone,
  onPlan,
}: {
  events: NearbyEvent[];
  /** Ids on the list the server no longer lists. */
  gone: string[];
  now: Date;
  isGoing: (id: string) => boolean;
  onSelect: (id: string) => void;
  onUnsave: (id: string) => void;
  onRemoveGone: () => void;
  /** The evening queue for one day ("2026-11-07"). */
  onPlan: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  const { days, past } = agendaDays(events, now, region.timezone, config.app.agenda.keepPastDays);
  const row = (ev: NearbyEvent) => (
    <Row
      key={ev.id}
      ev={ev}
      now={now}
      onSelect={onSelect}
      tag={isGoing(ev.id) ? t('agenda.going') : undefined}
      onUnsave={() => onUnsave(ev.id)}
    />
  );

  if (!days.length && !past.length && !gone.length)
    return (
      <div className="list list--empty">
        <p className="agenda__empty">
          <Icon name="bookmark" />
          {t('agenda.empty')}
        </p>
      </div>
    );

  return (
    <div className="agenda">
      {days.length > 0 && (
        <ul className="list">
          {days.map(({ day, events: evs }) => {
            const label = formatRelativeDay(
              new Date(Math.max(Date.parse(evs[0]!.startAt), now.getTime())).toISOString(),
              now,
              region.timezone,
              lang,
            );
            return (
              <li key={day} className="agenda__day">
                <div className="list__day agenda__head">
                  <span>{label}</span>
                  <span className="agenda__tools">
                    {evs.length > 1 && (
                      <button type="button" className="btn btn--small" onClick={() => onPlan(day)}>
                        <Icon name="walk" size={16} />
                        {t('agenda.plan')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`${t('agenda.calendar')}: ${label}`}
                      onClick={() =>
                        downloadDayIcs(evs, (ev) => eventUrl(ev.id), `${label} ${day}`)
                      }
                    >
                      <Icon name="calendar" />
                    </button>
                  </span>
                </div>
                <ul className="list">{evs.map(row)}</ul>
              </li>
            );
          })}
        </ul>
      )}
      {gone.length > 0 && (
        <p className="agenda__gone">
          {t('agenda.gone', { count: gone.length })}
          <button type="button" className="btn btn--small" onClick={onRemoveGone}>
            {t('agenda.removeGone')}
          </button>
        </p>
      )}
      {past.length > 0 && (
        <details className="agenda__past">
          <summary>{t('agenda.past', { count: past.length })}</summary>
          <ul className="list">{past.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
