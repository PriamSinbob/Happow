import { useEffect, useRef, useState } from 'react';
import { FLAG_REASONS, type FlagReason } from '@happow/core';
import { api, deviceId } from '../api';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

/** Off or changed: everyone sees a warning at once. The rest go to moderators only. */
const OTHER_REASONS = ['wrong_info', 'inappropriate', 'other'] as const;
type Reason = FlagReason | (typeof OTHER_REASONS)[number];
const GROUPS = [
  { title: 'report.group.status', reasons: FLAG_REASONS },
  { title: 'report.group.other', reasons: OTHER_REASONS },
] as const;

/** "Report a problem" sheet: one reason, an optional note, sent to the moderation queue. */
export function ReportDialog({
  eventId,
  onClose,
  onSent,
}: {
  eventId: string;
  onClose: () => void;
  /** The reason, so a status report can show on this device straight away. */
  onSent: (reason: Reason) => void;
}) {
  const { t, lang } = useI18n();
  const dialog = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // don't also close the detail screen underneath
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || sending) return;
    setSending(true);
    setError(null);
    try {
      await api('reports', {
        body: { deviceId: deviceId(), eventId, reason, note: note.trim() || null },
      });
      onSent(reason);
    } catch (err) {
      setError(errorText(t, err, lang));
      setSending(false);
    }
  }

  return (
    <div className="overlay overlay--top" onClick={onClose}>
      <form
        ref={dialog}
        className="filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onSubmit={send}
      >
        <header className="filter-sheet__head">
          <h2 id="report-title">{t('report.title')}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t('common.cancel')}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        {GROUPS.map((g) => (
          <fieldset key={g.title} className="choices">
            <legend className="choices__title">{t(g.title)}</legend>
            {g.reasons.map((r) => (
              <label key={r} className={`choice${reason === r ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                {t(`report.reason.${r}`)}
              </label>
            ))}
          </fieldset>
        ))}
        <label className="field">
          <span className="field__label">{t('report.note')}</span>
          <textarea
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="filter-sheet__foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!reason || sending}>
            {t('report.send')}
          </button>
        </div>
      </form>
    </div>
  );
}
