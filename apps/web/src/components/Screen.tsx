import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

/** Full-screen page over the map (add event, moderation, about): back button, title, Escape. */
export function Screen({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // A sheet opened inside the screen (sign-in on the add form) keeps the focus it took.
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={dialog}
      className="screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-title"
      tabIndex={-1}
    >
      <header className="screen__bar">
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.back')}>
          <Icon name="back" />
        </button>
        <h1 id="screen-title">{title}</h1>
      </header>
      <div className="screen__scroll">
        <div className={`screen__body${wide ? ' screen__body--wide' : ''}`}>{children}</div>
      </div>
    </div>
  );
}
