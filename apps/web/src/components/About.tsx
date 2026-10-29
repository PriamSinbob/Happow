import { useState } from 'react';
import { can } from '@happow/core';
import { useAccount } from '../account';
import type { Atlas } from '../atlas/useAtlas';
import { authAvailable } from '../auth';
import { config, region } from '../config';
import { useI18n } from '../i18n';
import { selectablePresets, THEME_SETTINGS, useTheme } from '../theme';
import { AccountCard, DeleteAccountSheet } from './Account';
import { AtlasBar } from './Atlas';
import { Icon } from './Icons';
import { PremiumMark, PremiumSheet } from './Premium';
import { Screen } from './Screen';
import { SignInSheet } from './SignIn';

const NUMBERS = ['1', '2', '3', '4'] as const;
/** Presets in the order of the plans that unlock them. */
const TIERS = ['anonymous', 'account', 'premium'];

/** About, terms of use, privacy, sources and the takedown contact. */
export function About({
  atlas,
  onClose,
  onModerate,
  onOpenEvent,
}: {
  /** The local atlas (§6): its bar sits with the theme and colour settings. */
  atlas: Atlas;
  onClose: () => void;
  onModerate: () => void;
  /** One of the account's own events, from the contributor section. */
  onOpenEvent: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const theme = useTheme();
  const account = useAccount();
  const [sheet, setSheet] = useState<'signIn' | 'premium' | 'delete' | null>(null);
  const signedIn = account.me !== null;
  const allowed = selectablePresets(account.entitlements);
  // Signed out (or still loading): only the presets anyone may use. Signed in: all, by tier, so
  // the free ones keep the first row; the locked ones carry the mark.
  const shown = config.theme.presets
    .filter((p) => signedIn || p.tier === 'anonymous')
    .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
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

        {authAvailable() && (
          <>
            <h2>{t('account.title')}</h2>
            <AccountCard
              onSignIn={() => setSheet('signIn')}
              onPremium={() => setSheet('premium')}
              onDelete={() => setSheet('delete')}
              onOpenEvent={onOpenEvent}
            />
          </>
        )}

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
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={theme.preset.id === p.id}
                className={theme.preset.id === p.id ? 'is-active' : ''}
                onClick={() => (allowed.includes(p) ? theme.setPreset(p.id) : setSheet('premium'))}
              >
                <span className="swatch" style={{ background: p[theme.name].live }} aria-hidden />
                {p.labels[lang]}
                {p.tier === 'premium' && <PremiumMark size={12} label={t('account.premium')} />}
              </button>
            ))}
          </div>
          <span className="field__hint">
            {account.status !== 'signedOut' || !authAvailable()
              ? t('about.colour.hint')
              : t('about.colour.signIn')}
          </span>
        </div>
        <AtlasBar atlas={atlas} transfer={can(account.entitlements, 'atlas.export')} />

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
        {account.me?.role && (
          <button type="button" className="mod-row" onClick={onModerate}>
            <Icon name="shield" size={18} />
            {t('about.moderate')}
          </button>
        )}
      </div>
      {sheet === 'signIn' && <SignInSheet onClose={() => setSheet(null)} />}
      {sheet === 'premium' && <PremiumSheet onClose={() => setSheet(null)} />}
      {sheet === 'delete' && <DeleteAccountSheet onClose={() => setSheet(null)} />}
    </Screen>
  );
}
