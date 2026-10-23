import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Glyph } from './Icons';

export interface PickOption {
  id: string;
  glyph: string;
  label: string;
}

/**
 * The grid a hold opens under the top row (docs/design/map-shortcut.html): glyphs only, the
 * current one ringed. A tap outside or Escape closes it.
 */
export function PickGrid({
  label,
  options,
  current,
  onPick,
  onClose,
}: {
  label: string;
  options: PickOption[];
  current?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus goes back to the button that opened the grid.
    const opener = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    const el = box.current;
    (
      el?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      el?.querySelector<HTMLButtonElement>('button')
    )?.focus();
    return () => {
      window.removeEventListener('keydown', key);
      opener?.focus?.();
    };
  }, [onClose]);

  // Arrow keys move through the grid, five to a row.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key];
    if (!step) return;
    e.preventDefault();
    const opts = [...(box.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    opts[Math.max(0, Math.min(opts.length - 1, i + step))]?.focus();
  };

  return (
    <>
      {/* A tap outside only closes the grid: it picks no pin and toggles nothing. */}
      <div className="pick-grid-backdrop" onPointerDown={onClose} aria-hidden />
      <div
        ref={box}
        className="pick-grid"
        role={current ? 'radiogroup' : 'group'}
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role={current ? 'radio' : undefined}
            aria-checked={current ? o.id === current : undefined}
            aria-label={o.label}
            className={`pick-grid__opt${o.id === current ? ' is-current' : ''}`}
            onClick={() => onPick(o.id)}
          >
            <Glyph id={o.glyph} size={22} />
          </button>
        ))}
      </div>
    </>
  );
}
