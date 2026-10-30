import { useEffect, useState } from 'react';
import { openedFromLink } from '../hooks/useHashRoute';
import { useI18n } from '../i18n';
import { storage } from '../storage';
import { Icon } from './Icons';

const SEEN = 'iosHintSeen';

/** Safari on an iPhone or iPad (iPadOS reports a Mac with touch), outside the installed app. */
export function isIosBrowser(nav: Navigator = navigator, standalone = isStandalone()): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return ios && !standalone;
}

function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

/**
 * iOS can't open shared links in an installed web app, so a link opens in Safari, where the whole
 * app works anyway (M9 §7). On a card opened from a shared link there, one line suggests adding
 * Happow to the Home Screen: shown once on this device, dismissible, never again.
 */
export function InstallHint({ fromLink = openedFromLink }: { fromLink?: boolean }) {
  const { t } = useI18n();
  const [show] = useState(() => fromLink && isIosBrowser() && !storage.get(SEEN));
  const [open, setOpen] = useState(show);
  useEffect(() => {
    if (show) storage.set(SEEN, '1');
  }, [show]);
  if (!open) return null;
  return (
    <p className="install-hint" role="note">
      <span>{t('install.iosHint')}</span>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen(false)}
        aria-label={t('nav.close')}
      >
        <Icon name="close" size={16} />
      </button>
    </p>
  );
}
