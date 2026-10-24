import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

/**
 * A bottom sheet over a screen (sign-in, terms, premium, confirmations): Escape or the scrim
 * closes it, and focus goes back to what opened it.
 */
export function Sheet({
  title,
  onClose,
  children,
  role = 'dialog',
}: {
  title: ReactNode;
  /** Null for a sheet that must be answered (the terms after sign-in). */
  onClose: (() => void) | null;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers pass a new arrow each render; keep the latest without re-running the effects.
  const close = useRef(onClose);
  close.current = onClose;

  // Focus once on open: re-focusing on every render would close the phone's keyboard mid-typing.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !close.current) return;
      e.stopImmediatePropagation(); // don't also close the screen underneath
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="overlay overlay--top" onClick={() => close.current?.()}>
      <div
        ref={dialog}
        className="filter-sheet account-sheet"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="filter-sheet__head">
          <h2 id={titleId} className="account-sheet__title">
            {title}
          </h2>
          {onClose && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => close.current?.()}
              aria-label={t('common.close')}
            >
              <Icon name="close" />
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
