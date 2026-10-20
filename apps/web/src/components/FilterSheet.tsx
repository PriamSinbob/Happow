import { useEffect, useRef } from 'react';
import type { PriceFilter } from '@happow/core';
import { config } from '../config';
import type { FiltersState } from '../hooks/useFilters';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

const PRICES: PriceFilter[] = ['any', 'free', 'paid'];

interface Props {
  filters: FiltersState;
  count: number;
  loading: boolean;
  onClose: () => void;
}

/** Category multi-select and price filter. Changes apply live; the count updates behind the sheet. */
export function FilterSheet({ filters, count, loading, onClose }: Props) {
  const { t, lang } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={dialog}
        className="filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="filter-sheet__head">
          <h2 id="filters-title">{t('filters.title')}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t('filters.close')}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <section className="filter-sheet__section">
          <h3>{t('filters.categories')}</h3>
          <div className="cat-grid">
            {config.categories.map((c) => {
              const on = filters.categories.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  className={`cat-chip${on ? ' is-on' : ''}`}
                  style={{ ['--cat' as string]: c.color }}
                  onClick={() => filters.toggleCategory(c.id)}
                >
                  <span className="cat-chip__icon" aria-hidden>
                    {c.icon}
                  </span>
                  <span className="cat-chip__label">{c.labels[lang]}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="filter-sheet__section">
          <h3 id="price-label">{t('filters.price')}</h3>
          <div className="segmented segmented--3" role="radiogroup" aria-labelledby="price-label">
            {PRICES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={filters.price === p}
                className={filters.price === p ? 'is-active' : ''}
                onClick={() => filters.setPrice(p)}
              >
                {t(`filters.price.${p}`)}
              </button>
            ))}
          </div>
        </section>

        <footer className="filter-sheet__foot">
          <button
            type="button"
            className="btn"
            onClick={filters.clear}
            disabled={filters.activeCount === 0}
          >
            {t('filters.clear')}
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose} aria-busy={loading}>
            {t('filters.show', { count })}
          </button>
        </footer>
      </div>
    </div>
  );
}
