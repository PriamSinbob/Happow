import type { NearbyEvent } from '@happow/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../analytics';
import { shareToken } from '../attendance';
import { useI18n } from '../i18n';
import { canShareFiles, previewFile, qrPath, shareText } from '../shareEvent';
import { Icon } from './Icons';

/**
 * Sharing an event (M9 §3): the clean link with a short text, the preview card as an image where
 * the phone can share files, and a QR code to scan from a screen or a printed flyer.
 */
export function ShareSheet({
  ev,
  url,
  onClose,
  onToast,
}: {
  ev: NearbyEvent;
  url: string;
  onClose: () => void;
  onToast: (text: string) => void;
}) {
  const { t, lang } = useI18n();
  const sheet = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // The link carries this device's share token, so it can see how many came through it (§5).
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    shareToken(ev.id)
      .then((t) => live && setToken(t))
      .catch(() => {
        /* offline: share the plain link */
      });
    return () => {
      live = false;
    };
  }, [ev.id]);
  const link = token ? `${url}?s=${token}` : url;
  const text = shareText(ev, lang);
  const qr = useMemo(() => qrPath(link), [link]);
  const files = useMemo(canShareFiles, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // don't also close the detail screen underneath
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    sheet.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      onToast(t('event.linkCopied'));
    } catch {
      /* no clipboard: the link is shown under the code */
    }
  }

  async function sendLink() {
    track('Share', { as: 'link' });
    if (!navigator.share) return copy();
    try {
      await navigator.share({ title: ev.title, text, url: link });
      onClose();
    } catch {
      /* the user dismissed the share sheet */
    }
  }

  async function sendImage() {
    if (busy) return;
    setBusy(true);
    track('Share', { as: 'image' });
    try {
      const file = await previewFile(ev.id);
      await navigator.share({ files: [file], text: `${text}\n${link}` });
      onClose();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        onToast(t('share.imageFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay overlay--top" onClick={onClose}>
      <div
        ref={sheet}
        className="filter-sheet share-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="filter-sheet__head">
          <h2 id="share-title">{t('share.title')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('nav.close')}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="share-sheet__actions">
          <button type="button" className="btn btn--primary" onClick={sendLink}>
            <Icon name="share" size={16} /> {t('share.link')}
          </button>
          {files && (
            <button type="button" className="btn" onClick={sendImage} disabled={busy}>
              <Icon name="camera" size={16} /> {t('share.image')}
            </button>
          )}
          <button type="button" className="btn" onClick={copy}>
            <Icon name="copy" size={16} /> {t('share.copy')}
          </button>
        </div>
        <figure className="share-sheet__qr">
          <svg
            viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
            role="img"
            aria-label={t('share.qr')}
            shapeRendering="crispEdges"
          >
            <rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
          <figcaption>
            {t('share.qr')}
            <span className="share-sheet__url">{link}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
