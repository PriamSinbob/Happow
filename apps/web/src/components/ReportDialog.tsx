import { useEffect, useRef, useState } from 'react';
import { api, deviceId } from '../api';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

const REASONS = ['wrong_info', 'cancelled', 'inappropriate', 'other'] as const;
type Reason = (typeof REASONS)[number];

/** "Report a problem" sheet: one reason, an optional note, sent to the moderation queue. */
export function ReportDialog({
  eventId,
  onClose,
  onSent,
}: {
  eventId: string;
  onClose: () => void;
  onSent: () => void;
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
      onSent();
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
        <fieldset className="choices">
          <legend className="visually-hidden">{t('report.title')}</legend>
          {REASONS.map((r) => (
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
