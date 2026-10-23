import { useEffect, useRef } from 'react';
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
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Next tick, so the hold that opened the grid does not close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', away));
    window.addEventListener('keydown', key);
    box.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')?.focus();
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div ref={box} className="pick-grid" role={current ? 'radiogroup' : 'group'} aria-label={label}>
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
  );
}
