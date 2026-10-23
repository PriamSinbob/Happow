import { useEffect, useRef } from 'react';
import { priceFromToggles, priceToggles, type Language } from '@happow/core';
import { config } from '../config';
import type { FiltersState } from '../hooks/useFilters';
import { useI18n } from '../i18n';
import { AtlasEntry } from './Atlas';
import { Glyph, Icon } from './Icons';

interface Props {
  filters: FiltersState;
  /** Lit areas in the local atlas (§6). */
  atlasCount: number;
  count: number;
  loading: boolean;
  onClose: () => void;
  onAdd: () => void;
  onAbout: () => void;
  onAtlas: () => void;
}

/** Fanned category glyphs beside the add button, shrinking and fading outward (§15). */
const FAN = [
  { size: 20, opacity: 0.9 },
  { size: 16, opacity: 0.6 },
  { size: 13, opacity: 0.35 },
];
const FAN_LEFT = ['note', 'mask', 'frame'];
const FAN_RIGHT = ['basket', 'beer', 'confetti'];

/**
 * Settings (§5, §15; `docs/design/settings-rows.html`): the category chips, then wordless rows in
 * black and white: price and family toggles, add event, language, the atlas, About, and the
 * footer. Filters
 * apply live and the count updates behind the sheet.
 */
export function SettingsSheet({
  filters,
  atlasCount,
  count,
  loading,
  onClose,
  onAdd,
  onAbout,
  onAtlas,
}: Props) {
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
          {config.categories.map((c) => {
            const on = filters.categories.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                className={`cat-chip${on ? ' is-on' : ''}`}
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

        <button type="button" className="settings-row" aria-label={t('header.add')} onClick={onAdd}>
          {[...FAN].reverse().map((f, i) => (
            <span key={`l${i}`} className="settings-row__motif" style={{ opacity: f.opacity }}>
              <Glyph id={FAN_LEFT[FAN.length - 1 - i]!} size={f.size} />
            </span>
          ))}
          <span className="settings-row__main">
            <Icon name="plusCircle" size={38} strokeWidth={1.6} />
          </span>
          {FAN.map((f, i) => (
            <span key={`r${i}`} className="settings-row__motif" style={{ opacity: f.opacity }}>
              <Glyph id={FAN_RIGHT[i]!} size={f.size} />
            </span>
          ))}
        </button>

        <div className="settings-row" role="radiogroup" aria-label={t('settings.language')}>
          {languages.slice(0, half).map(langButton)}
          <span className="settings-row__globe" aria-hidden>
            <Icon name="world" size={30} strokeWidth={1.6} />
          </span>
          {languages.slice(half).map(langButton)}
        </div>

        <AtlasEntry count={atlasCount} onOpen={onAtlas} />

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
