import { useEffect, useRef, useState } from 'react';
import type { Atlas } from '../atlas/useAtlas';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

/** Clearing needs a deliberate hold, so the atlas can't be forgotten by accident. */
export const CLEAR_HOLD_MS = 1500;
const RING = 2 * Math.PI * 19;

type Toast = { ok: true; text?: string; label: string } | { ok: false; label: string };

/** The folded map with a lit spot, drawn for Happow (docs/design/atlas.html). */
export function AtlasGlyph({
  size = 34,
  strokeWidth = 1.6,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13M9 4v13M15 7v13" />
      <circle cx="12" cy="11.5" r="1.9" fill="currentColor" stroke="none" />
      <circle
        cx="12"
        cy="11.5"
        r="4.2"
        strokeWidth={strokeWidth * 0.625}
        strokeDasharray="1.2 1.6"
      />
    </svg>
  );
}

/**
 * The atlas bar (§6, `docs/design/atlas.html`), inside About with the theme and colour
 * settings (owner, 2026-10-23): export, the number of lit areas, import, and a hold-to-clear
 * bin. Wordless, black and white; every button has a translated name.
 */
export function AtlasBar({ atlas }: { atlas: Atlas }) {
  const { t } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [holding, setHolding] = useState(0);
  const hold = useRef<{ frame: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => () => cancelAnimationFrame(hold.current?.frame ?? 0), []);

  const stopHold = () => {
    if (hold.current) cancelAnimationFrame(hold.current.frame);
    hold.current = null;
    setHolding(0);
  };
  const startHold = () => {
    stopHold();
    const start = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / CLEAR_HOLD_MS);
      setHolding(p);
      if (p < 1) {
        hold.current = { frame: requestAnimationFrame(tick) };
        return;
      }
      stopHold();
      navigator.vibrate?.(6);
      void atlas.clear().then(() => setToast({ ok: true, text: '0', label: t('atlas.cleared') }));
    };
    hold.current = { frame: requestAnimationFrame(tick) };
  };

  return (
    <div className="atlas-bar">
      <button
        type="button"
        className="atlas-row__btn"
        aria-label={t('atlas.export')}
        onClick={() =>
          void atlas
            .exportFile()
            .then((ok) => ok && setToast({ ok: true, label: t('atlas.saved') }))
        }
      >
        <Icon name="download" size={24} strokeWidth={1.8} />
      </button>
      <span
        className="atlas-row__main"
        role="img"
        aria-label={t('atlas.label', { count: atlas.count })}
      >
        <AtlasGlyph />
        <span className="atlas-row__count">{atlas.count}</span>
      </span>
      <button
        type="button"
        className="atlas-row__btn"
        aria-label={t('atlas.import')}
        onClick={() => file.current?.click()}
      >
        <Icon name="upload" size={24} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="atlas-row__btn atlas-row__clear"
        aria-label={t('atlas.clear')}
        onPointerDown={(e) => {
          e.preventDefault();
          startHold();
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            startHold();
          }
        }}
        onKeyUp={stopHold}
        onBlur={stopHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="atlas-row__ring" viewBox="0 0 44 44" width={44} height={44} aria-hidden>
          {/* Not drawn at rest: a zero-length round-capped dash still paints a dot. */}
          {holding > 0 && (
            <circle
              cx="22"
              cy="22"
              r="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${(holding * RING).toFixed(1)} ${RING.toFixed(1)}`}
              transform="rotate(-90 22 22)"
            />
          )}
        </svg>
        <Icon name="trash" size={20} strokeWidth={1.8} />
      </button>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="atlas-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          void atlas
            .importFile(f)
            .then((n) =>
              setToast(
                n === null
                  ? { ok: false, label: t('atlas.badFile') }
                  : { ok: true, text: `+${n}`, label: t('atlas.imported', { count: n }) },
              ),
            );
        }}
      />
      <div role="status" className="visually-hidden">
        {toast?.label ?? ''}
      </div>
      {toast && (
        <div className="toast toast--icon atlas-row__toast" aria-hidden>
          <Icon name={toast.ok ? 'check' : 'none'} size={20} />
          {toast.ok && toast.text && <span className="sheet-btn__count">{toast.text}</span>}
        </div>
      )}
    </div>
  );
}
