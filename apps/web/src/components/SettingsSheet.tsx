import { useEffect, useRef } from 'react';
import { priceFromToggles, priceToggles, type Category, type Language } from '@happow/core';
import { config } from '../config';
import type { FiltersState } from '../hooks/useFilters';
import { useLongPress } from '../hooks/useLongPress';
import { useI18n } from '../i18n';
import { Glyph, Icon } from './Icons';

interface Props {
  filters: FiltersState;
  count: number;
  loading: boolean;
  onClose: () => void;
  onAbout: () => void;
}

/**
 * A category chip: a tap shows only this kind (highlighted), a hold hides this kind and shows
 * everything else (greyed out). A tap or a hold on a hidden chip makes it neutral again.
 */
function CategoryChip({ category: c, filters }: { category: Category; filters: FiltersState }) {
  const { t, lang } = useI18n();
  const press = useLongPress(
    () => filters.toggleCategory(c.id),
    () => filters.toggleExcluded(c.id),
  );
  const on = filters.categories.includes(c.id);
  const out = filters.excluded.includes(c.id);
  const name = c.labels[lang];
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={out ? t('filters.excluded', { name }) : undefined}
      className={`cat-chip${on ? ' is-on' : ''}${out ? ' is-out' : ''}`}
      {...press}
    >
      <span className="cat-chip__icon" aria-hidden>
        <Glyph id={c.glyph} size={18} />
      </span>
      <span className="cat-chip__label">{name}</span>
    </button>
  );
}

/**
 * Settings: the category chips, then wordless rows: price and family toggles, language, About,
 * and the footer. Filters apply live and the count updates behind the sheet.
 */
export function SettingsSheet({ filters, count, loading, onClose, onAbout }: Props) {
  const { t, lang, setLang } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  // The last price toggle that is on can't go off: it nudges instead.
  const nudge = (b: HTMLElement) => {
    b.classList.remove('is-nudge');
    void b.offsetWidth; // restart the animation
    b.classList.add('is-nudge');
  };
  const price = priceToggles(filters.price);
  const languages = config.app.languages as Language[];
  const half = Math.ceil(languages.length / 2);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const togglePrice = (key: 'free' | 'paid', button: HTMLElement) => {
    const next = { ...price, [key]: !price[key] };
    const p = priceFromToggles(next.free, next.paid);
    if (p) filters.setPrice(p);
    else nudge(button);
  };

  const langButton = (l: Language) => (
    <span key={l} className="lang-field">
      <button
        type="button"
        role="radio"
        aria-checked={l === lang}
        aria-label={t(`language.${l}`)}
        className={`lang-code${l === lang ? ' is-on' : ''}`}
        onClick={() => setLang(l)}
      >
        {l.toUpperCase()}
      </button>
    </span>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={dialog}
        className="filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cat-grid" role="group" aria-label={t('filters.categories')}>
          {config.categories.map((c) => (
            <CategoryChip key={c.id} category={c} filters={filters} />
          ))}
        </div>

        <div className="toggle-row">
          <div className="toggle-track" role="group" aria-label={t('filters.price')}>
            {(['free', 'paid'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={price[key]}
                aria-label={t(`filters.price.${key}`)}
                className={`toggle${price[key] ? ' is-on' : ''}`}
                onClick={(e) => togglePrice(key, e.currentTarget)}
              >
                <Icon
                  name={key === 'free' ? 'ticketFree' : 'ticketPaid'}
                  size={28}
                  strokeWidth={1.8}
                />
              </button>
            ))}
          </div>
          <div className="toggle-track">
            <button
              type="button"
              aria-pressed={filters.family}
              aria-label={t('family.mode')}
              className={`toggle${filters.family ? ' is-on' : ''}`}
              onClick={() => filters.setFamily(!filters.family)}
            >
              <Glyph id="family" size={28} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="settings-row" role="radiogroup" aria-label={t('settings.language')}>
          {languages.slice(0, half).map(langButton)}
          <span className="settings-row__globe" aria-hidden>
            <Icon name="world" size={30} strokeWidth={1.6} />
          </span>
          {languages.slice(half).map(langButton)}
        </div>

        <button
          type="button"
          className="settings-row"
          aria-label={t('header.about')}
          onClick={onAbout}
        >
          <span className="settings-row__motif" style={{ opacity: 0.35 }}>
            <Icon name="dice" size={13} />
          </span>
          <span className="settings-row__motif" style={{ opacity: 0.6 }}>
            <Icon name="gear" size={17} />
          </span>
          <span className="settings-row__main">
            <Icon name="infoCircle" size={34} strokeWidth={1.6} />
          </span>
          <span className="settings-row__motif" style={{ opacity: 0.6 }}>
            <Icon name="shield" size={17} />
          </span>
          <span className="settings-row__motif" style={{ opacity: 0.35 }}>
            <Glyph id="tag" size={13} />
          </span>
        </button>

        <footer className="settings-foot">
          <button
            type="button"
            className="sheet-btn"
            aria-label={t('filters.clear')}
            onClick={filters.clear}
            disabled={filters.activeCount === 0}
          >
            <Icon name="filterOff" size={22} />
          </button>
          <button
            type="button"
            className="sheet-btn sheet-btn--show"
            aria-label={t('filters.show', { count })}
            onClick={onClose}
            aria-busy={loading}
          >
            <Icon name="check" size={20} />
            <span className="sheet-btn__count">{count}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
