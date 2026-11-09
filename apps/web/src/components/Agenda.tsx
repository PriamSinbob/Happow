import { agendaDays, type NearbyEvent } from '@happow/core';
import { config, region } from '../config';
import { formatRelativeDay } from '../format';
import { useI18n } from '../i18n';
import { hasNews, isPrivate } from '../private';
import { downloadDayIcs } from '../ics';
import { eventUrl } from '../hooks/useHashRoute';
import { Icon } from './Icons';
import { TimeRow } from './ListView';

/**
 * The list in "My plans" and "Saved": your events by day in the region's time zone, a
 * running one first today; ended ones folded under "Past". A day with two or more events offers
 * the evening queue; each day can go into the phone's calendar in one file.
 */
export function Agenda({
  events,
  gone,
  now,
  isGoing,
  isInvited = () => false,
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
  /** An accepted invitation: tagged, and it can't be un-bookmarked here. */
  isInvited?: (id: string) => boolean;
  onSelect: (id: string) => void;
  onUnsave: (id: string) => void;
  onRemoveGone: () => void;
  /** The evening queue for one day ("2026-11-07"). */
  onPlan: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  const { days, past } = agendaDays(events, now, region.timezone, config.app.agenda.keepPastDays);
  /** A row; `anchor` is its day, so a start on another day is spelled out. */
  const row = (ev: NearbyEvent, anchor: Date) => {
    const invited = isInvited(ev.id);
    // A private event: yours, waiting for your answer, or accepted; a dot when it changed.
    const priv = isPrivate(ev) ? ev : null;
    const privTag = priv
      ? [
          t(
            priv.mine
              ? 'agenda.yours'
              : priv.invitation?.status === 'pending'
                ? 'agenda.pending'
                : 'agenda.invited',
          ),
          hasNews(priv) ? t('agenda.changed') : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
    return (
      <TimeRow
        key={ev.id}
        ev={ev}
        now={now}
        anchor={anchor}
        onSelect={onSelect}
        tag={
          privTag ??
          (isGoing(ev.id) ? t('agenda.going') : invited ? t('agenda.invited') : undefined)
        }
        onUnsave={invited ? undefined : () => onUnsave(ev.id)}
      />
    );
  };

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
            const anchor = new Date(Math.max(Date.parse(evs[0]!.startAt), now.getTime()));
            const label = formatRelativeDay(anchor.toISOString(), now, region.timezone, lang);
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
                <ul className="list tt">{evs.map((ev) => row(ev, anchor))}</ul>
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
          <ul className="list tt">{past.map((ev) => row(ev, now))}</ul>
        </details>
      )}
    </div>
  );
}
