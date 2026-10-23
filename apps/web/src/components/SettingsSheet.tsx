import { useEffect, useRef } from 'react';
import type { Language, PriceFilter } from '@happow/core';
import { config } from '../config';
import type { FiltersState } from '../hooks/useFilters';
import { useI18n } from '../i18n';
import { Glyph, Icon, type IconName } from './Icons';

const PRICES: PriceFilter[] = ['any', 'free', 'paid'];

interface Props {
  filters: FiltersState;
  count: number;
  loading: boolean;
  onClose: () => void;
  onAdd: () => void;
  onAbout: () => void;
}

/**
 * Settings (§5): the filters first (categories, price; they apply live and the count updates
 * behind the sheet), then adding an event, the language and About.
 */
export function SettingsSheet({ filters, count, loading, onClose, onAdd, onAbout }: Props) {
  const { t, lang, setLang } = useI18n();
  const otherLang = config.app.languages.find((l) => l !== lang) as Language | undefined;
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
        aria-labelledby="settings-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="filter-sheet__head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t('settings.close')}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <h3 className="settings__group">{t('filters.title')}</h3>
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
                    <Glyph id={c.glyph} size={18} />
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

        <ul className="settings__rows">
          <SettingsRow icon="plus" label={t('header.add')} onClick={onAdd} />
          {otherLang && (
            <SettingsRow
              icon="language"
              label={t('settings.language')}
              value={t(`language.${otherLang}`)}
              onClick={() => setLang(otherLang)}
            />
          )}
          <SettingsRow icon="info" label={t('header.about')} onClick={onAbout} />
        </ul>

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

function SettingsRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" className="settings__row" onClick={onClick}>
        <Icon name={icon} size={20} />
        <span className="settings__label">{label}</span>
        {value && <span className="settings__value">{value}</span>}
      </button>
    </li>
  );
}
