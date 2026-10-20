import { config, region } from '../config';
import { useI18n } from '../i18n';
import { Screen } from './Screen';

const NUMBERS = ['1', '2', '3', '4'] as const;

/** About, terms of use, privacy, sources and the takedown contact. */
export function About({ onClose, onModerate }: { onClose: () => void; onModerate: () => void }) {
  const { t, lang } = useI18n();
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

        <p className="muted small">{t('about.attribution')}</p>
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
