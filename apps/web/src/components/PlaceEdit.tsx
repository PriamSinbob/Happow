import { useState } from 'react';
import { formatOpeningHours } from '@happow/core';
import { config } from '../config';
import { errorText } from '../errors';
import { formatTime } from '../format';
import { useI18n } from '../i18n';
import { changePlace, hereNow, type ClosedReport, type OpenPlace } from '../places';
import { HoursEditor, rowsToWeek, weekToRows } from './HoursEditor';
import { Sheet } from './Sheet';

const { privateMaxHours, closed: closedRule } = config.app.places;

/**
 * Correct a place: its hours or a private party on now, which show at once, or a report that it
 * is closed for good, made at the place (the phone's position is checked); it leaves the map once
 * `places.closed.reports` accounts reported it.
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
  const [step, setStep] = useState<'pick' | 'hours' | 'closed' | 'reported'>('pick');
  const [report, setReport] = useState<ClosedReport | null>(null);
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
  // Closed for good: from where the phone is now. Gone at once once enough people said so.
  const reportClosed = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let at;
    try {
      at = await hereNow();
    } catch {
      setError(t('placeEdit.noLocation'));
      setBusy(false);
      return;
    }
    try {
      const done = await changePlace(place.id, { closed: true, at });
      if (done.closed) return onClose();
      setReport({
        closed: false,
        reports: done.reports ?? 1,
        needed: done.needed ?? closedRule.reports,
      });
      setStep('reported');
    } catch (err) {
      setError(errorText(t, err, lang));
    }
    setBusy(false);
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
            {t('placeEdit.closedConfirm', {
              name: place.name,
              count: closedRule.reports,
              m: closedRule.withinM,
            })}
          </p>
          {foot(t('placeEdit.closedDo'), false, reportClosed)}
        </>
      )}
      {step === 'reported' && report && (
        <>
          <p className="account-sheet__lead" role="status">
            {t('placeEdit.reported', {
              name: place.name,
              count: report.reports,
              needed: report.needed,
            })}
          </p>
          <div className="account-sheet__foot">
            <button type="button" className="btn btn--primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
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
