import { config, region } from '../config';
import { useI18n } from '../i18n';
import { selectablePresets, THEME_SETTINGS, useTheme } from '../theme';
import { Screen } from './Screen';

const NUMBERS = ['1', '2', '3', '4'] as const;

/** About, terms of use, privacy, sources and the takedown contact. */
export function About({ onClose, onModerate }: { onClose: () => void; onModerate: () => void }) {
  const { t, lang } = useI18n();
  const theme = useTheme();
  const email = config.app.legal.contactEmail;
  const [before, after] = t('about.contactBody', { email: '\u0000' }).split('\u0000');
  const sources = config.sources
    .filter(
      (s) => s.enabled && region.enabledSources.includes(s.id) && s.trustLevel !== 'community',
    )
    .map((s) => s.name);

  return (
    <Screen title={t('about.title')} onClose={onClose}>
      <div className="prose">
        <p className="lead">{t('about.intro')}</p>

        <h2>{t('about.appearance')}</h2>
        <div className="field">
          <span className="field__label" id="theme-label">
            {t('about.theme')}
          </span>
          <div className="segmented segmented--3" role="radiogroup" aria-labelledby="theme-label">
            {THEME_SETTINGS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={theme.setting === s}
                className={theme.setting === s ? 'is-active' : ''}
                onClick={() => theme.setSetting(s)}
              >
                {t(`about.theme.${s}`)}
              </button>
            ))}
          </div>
          <span className="field__hint">{t('about.theme.hint')}</span>
        </div>
        <div className="field">
          <span className="field__label" id="preset-label">
            {t('about.colour')}
          </span>
          <div className="segmented segmented--2" role="radiogroup" aria-labelledby="preset-label">
            {selectablePresets.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={theme.preset.id === p.id}
                className={theme.preset.id === p.id ? 'is-active' : ''}
                onClick={() => theme.setPreset(p.id)}
              >
                <span className="swatch" style={{ background: p[theme.name].live }} aria-hidden />
                {p.labels[lang]}
              </button>
            ))}
          </div>
          <span className="field__hint">{t('about.colour.hint')}</span>
        </div>

        <h2>{t('about.sources')}</h2>
        <p>{t('about.sourcesBody')}</p>
        {sources.length > 0 && <p className="muted">{sources.join(' · ')}</p>}

        <h2 id="terms">{t('about.terms')}</h2>
        <ul>
          {NUMBERS.map((n) => (
            <li key={n}>{t(`about.terms.${n}`)}</li>
          ))}
        </ul>

        <h2>{t('about.privacy')}</h2>
        <ul>
          {NUMBERS.map((n) => (
            <li key={n}>{t(`about.privacy.${n}`)}</li>
          ))}
          {config.app.analytics.plausibleDomain && <li>{t('about.privacy.analytics')}</li>}
        </ul>

        <h2>{t('about.contact')}</h2>
        <p>
          {email ? (
            <>
              {before}
              <a href={`mailto:${email}`}>{email}</a>
              {after}
            </>
          ) : (
            t('about.contactFallback')
          )}
        </p>

        <p className="muted small">
          {t('about.attribution')} ·{' '}
          <a href="/third-party-licenses.txt" target="_blank" rel="noopener">
            {t('about.licenses')}
          </a>
        </p>
        <p className="muted small">
          {t('about.draft')} · {region.name[lang]}
        </p>
        <p>
          <button type="button" className="inline-link" onClick={onModerate}>
            {t('about.moderate')}
          </button>
        </p>
      </div>
    </Screen>
  );
}
