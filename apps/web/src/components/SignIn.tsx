import { useState } from 'react';
import { earlyAccessEnd, entitlementsFor, quota } from '@happow/core';
import { useAccount } from '../account';
import { requestCode, signInWithGoogle, verifyCode } from '../auth';
import { config, region } from '../config';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import { Icon } from './Icons';
import { planLastDay } from './Premium';
import { Sheet } from './Sheet';

const { auth } = config.app;
const google = auth.providers.includes('google');

/** Google's "G", as its sign-in branding asks for. */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width={18} height={18} aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * Sign-in (M8 §2, `docs/design/account.html`): Google, or a 6-digit code by email. With manual
 * delivery the sheet says plainly that a person sends the code.
 */
export function SignInSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestCode(email.trim(), lang);
      setStep('code');
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await verifyCode(email.trim(), code)) onClose();
      else setError(t('signIn.wrongCode'));
    } catch {
      setError(t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'code')
    return (
      <Sheet title={t('signIn.codeTitle')} onClose={onClose}>
        <form onSubmit={verify}>
          <p className="account-sheet__lead">
            {t(auth.emailDelivery === 'manual' ? 'signIn.codeManual' : 'signIn.codeSent', {
              email: email.trim(),
              hours: auth.codeValidHours,
            })}
          </p>
          <label className="field">
            <span className="field__label">{t('signIn.code')}</span>
            <input
              className="code-input"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <span className="field__hint">{t('signIn.codeHint')}</span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={code.length !== 6 || busy}
          >
            {t('signIn.submit')}
          </button>
          <p className="account-sheet__aside">
            <button
              type="button"
              className="inline-link"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              {t('signIn.changeEmail')}
            </button>
          </p>
        </form>
      </Sheet>
    );

  return (
    <Sheet title={t('signIn.title')} onClose={onClose}>
      <form onSubmit={send}>
        <p className="account-sheet__lead">{t(google ? 'signIn.lead' : 'signIn.leadCode')}</p>
        {google && (
          <>
            <button
              type="button"
              className="btn btn--google btn--block"
              onClick={() => void signInWithGoogle()}
            >
              <GoogleG />
              {t('signIn.google')}
            </button>
            <div className="or">{t('signIn.or')}</div>
          </>
        )}
        <label className="field">
          <span className="field__label">{t('signIn.email')}</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || busy}
        >
          <Icon name="mail" size={18} />
          {t('signIn.send')}
        </button>
      </form>
    </Sheet>
  );
}

const account = entitlementsFor(config.plans, 'account');
const premium = entitlementsFor(config.plans, 'premium');

/** Once per terms version, right after sign-in: the interim account terms (M8 §2, consent). */
export function TermsSheet() {
  const { t, lang } = useI18n();
  const { acceptTerms, signOut } = useAccount();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promo = config.plans.earlyAccess;
  const date = promo ? planLastDay(earlyAccessEnd(promo, region.timezone).toISOString(), lang) : '';

  async function done(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptTerms();
    } catch (err) {
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('terms.title')} onClose={null}>
      <form onSubmit={done}>
        <p className="account-sheet__lead">{t('terms.lead')}</p>
        <details className="account-terms" open>
          <summary>{t('terms.show')}</summary>
          <ul>
            <li>{t('terms.1')}</li>
            <li>
              {t('terms.2', {
                events: quota(account, 'events.perMonth'),
                autofill: quota(account, 'autofill.perMonth'),
                premiumEvents: quota(premium, 'events.perMonth'),
              })}
            </li>
            {promo && <li>{t('terms.3', { date })}</li>}
            <li>{t('terms.4')}</li>
            <li>{t('terms.5')}</li>
          </ul>
        </details>
        <label className="check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>{t('terms.accept')}</span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--block" disabled={!ok || busy}>
          {t('terms.done')}
        </button>
        <p className="account-sheet__aside">
          <button type="button" className="inline-link" onClick={signOut}>
            {t('account.signOut')}
          </button>
        </p>
      </form>
    </Sheet>
  );
}
