import { useState } from 'react';
import type { NearbyEvent } from '@happow/core';
import { ApiError } from '../api';
import { config, region } from '../config';
import { formatTime } from '../format';
import { eventUrl } from '../hooks/useHashRoute';
import { useI18n } from '../i18n';
import { downloadIcs } from '../ics';
import { pushSupport, reminders, useReminders } from '../reminders';
import { Icon } from './Icons';
import { Sheet } from './Sheet';

const { leads, dayBeforeAt } = config.app.reminders;

/**
 * The bell's choices: how long before the start, or the evening before. Push only; where push
 * can't work, the sheet says why and offers the phone's calendar instead.
 */
export function ReminderSheet({ ev, onClose }: { ev: NearbyEvent; onClose: () => void }) {
  const { t, lang } = useI18n();
  const current = useReminders()[ev.id] ?? null;
  const [choice, setChoice] = useState<string>(current ?? reminders.defaultLead());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();
  const label = useLeadLabel();

  const save = async (lead: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await reminders.set(ev.id, lead, lang);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'denied'
          ? t('reminder.blocked')
          : err instanceof ApiError && err.status === 409
            ? t('reminder.refused')
            : t('reminder.failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const calendar = (
    <button type="button" className="btn" onClick={() => downloadIcs(ev, eventUrl(ev.id))}>
      <Icon name="calendar" size={16} />
      {t('reminder.calendar')}
    </button>
  );

  return (
    <Sheet title={t('reminder.title')} onClose={onClose}>
      {support !== 'ok' && !current ? (
        <div className="reminder">
          <p>{t(`reminder.${support}`)}</p>
          {calendar}
        </div>
      ) : (
        <div className="reminder">
          <div className="reminder__leads" role="radiogroup" aria-label={t('reminder.title')}>
            {leads.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={choice === l}
                className={`reminder__lead${choice === l ? ' is-on' : ''}`}
                onClick={() => setChoice(l)}
              >
                {label(l)}
              </button>
            ))}
          </div>
          {error && (
            <p className="reminder__error" role="alert">
              {error}
            </p>
          )}
          <div className="reminder__actions">
            {current && (
              <button type="button" className="btn" disabled={busy} onClick={() => save(null)}>
                {t('reminder.off')}
              </button>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || choice === current}
              onClick={() => save(choice)}
            >
              <Icon name="bell" size={16} />
              {t('reminder.set')}
            </button>
          </div>
          <p className="reminder__note">
            {t('reminder.note', { time: formatTime(ev.startAt, region.timezone, lang) })}
          </p>
        </div>
      )}
    </Sheet>
  );
}

/** "15 min before", "2 hours before", "The evening before, at 18:00". */
export function useLeadLabel() {
  const { t } = useI18n();
  return (lead: string) => {
    if (lead === 'dayBefore') return t('reminder.dayBefore', { time: dayBeforeAt });
    const m = Number(lead);
    return m >= 60 && m % 60 === 0
      ? t('reminder.hours', { count: m / 60 })
      : t('reminder.min', { minutes: m });
  };
}
