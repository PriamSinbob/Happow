import { useState } from 'react';
import { formatOpeningHours } from '@happow/core';
import { config } from '../config';
import { errorText } from '../errors';
import { formatTime } from '../format';
import { useI18n } from '../i18n';
import { changePlace, type OpenPlace } from '../places';
import { HoursEditor, rowsToWeek, weekToRows } from './HoursEditor';
import { Sheet } from './Sheet';

const { privateMaxHours } = config.app.places;

/**
 * Correct a place: its hours, a private party on now, or closed for good. Each shows at once.
 */
export function PlaceEdit({
  place,
  now,
  timeZone,
  onClose,
}: {
  place: OpenPlace;
  now: Date;
  timeZone: string;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<'pick' | 'hours' | 'closed'>('pick');
  const [rows, setRows] = useState(() => weekToRows(place.week));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const week = rowsToWeek(rows);
  // A party lasts until the place closes; around the clock, until the limit.
  const partyEnd =
    !place.privateParty && place.closesAt && place.closesAt > now
      ? place.closesAt
      : new Date(now.getTime() + privateMaxHours * 3_600_000 - 60_000);

  const send = async (change: Parameters<typeof changePlace>[1]) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await changePlace(place.id, change);
      onClose();
    } catch (err) {
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  };
  const foot = (label: string, disabled: boolean, run: () => void) => (
    <div className="account-sheet__foot">
      <button type="button" className="btn" onClick={() => setStep('pick')}>
        {t('common.back')}
      </button>
      <button type="button" className="btn btn--primary" disabled={busy || disabled} onClick={run}>
        {label}
      </button>
    </div>
  );

  return (
    <Sheet title={t('placeEdit.title', { name: place.name })} onClose={onClose}>
      {step === 'pick' && (
        <div className="choices">
          <button type="button" className="choice" onClick={() => setStep('hours')}>
            {t('placeEdit.hours')}
            <span>{t('placeEdit.hoursHint')}</span>
          </button>
          {place.privateParty ? (
            <button
              type="button"
              className="choice"
              disabled={busy}
              onClick={() => send({ privateUntil: null })}
            >
              {t('placeEdit.partyOver')}
              <span>{t('placeEdit.partyOverHint')}</span>
            </button>
          ) : (
            <button
              type="button"
              className="choice"
              disabled={busy}
              onClick={() => send({ privateUntil: partyEnd.toISOString() })}
            >
              {t('placeEdit.party')}
              <span>
                {t('placeEdit.partyHint', {
                  time: formatTime(partyEnd.toISOString(), timeZone, lang),
                })}
              </span>
            </button>
          )}
          <button type="button" className="choice" onClick={() => setStep('closed')}>
            {t('placeEdit.closed')}
            <span>{t('placeEdit.closedHint')}</span>
          </button>
        </div>
      )}
      {step === 'hours' && (
        <>
          <HoursEditor rows={rows} onChange={setRows} />
          {foot(
            t('placeEdit.save'),
            week === null,
            () => week && send({ openingHours: formatOpeningHours(week) }),
          )}
        </>
      )}
      {step === 'closed' && (
        <>
          <p className="account-sheet__lead">
            {t('placeEdit.closedConfirm', { name: place.name })}
          </p>
          {foot(t('placeEdit.closedDo'), false, () => send({ closed: true }))}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
