import { useState } from 'react';
import { useAccount } from '../account';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import { ContributorSection } from './Contributor';
import { FeedsSection } from './Feeds';
import { Icon } from './Icons';
import { planLastDay, PremiumMark } from './Premium';
import { Sheet } from './Sheet';

/**
 * The account card at the top of About (M8 §2, §4, `docs/design/account.html`): signed out, what
 * a free account gives and the way in; signed in, the email, the plan and its end, export, sign
 * out and delete. M12 slice F adds the contributor's section.
 */
export function AccountCard({
  onSignIn,
  onPremium,
  onDelete,
  onOpenEvent,
  onAddAgain,
}: {
  onSignIn: () => void;
  onPremium: () => void;
  onDelete: () => void;
  onOpenEvent: (id: string) => void;
  onAddAgain: (submissionId: string) => void;
}) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { me } = account;

  if (account.status === 'signedOut')
    return (
      <div className="account-card">
        <p className="account-card__perks">{t('account.perks')}</p>
        <button type="button" className="btn btn--primary" onClick={onSignIn}>
          {t('account.signIn')}
        </button>
      </div>
    );
  if (!me)
    return (
      <div className="account-card">
        <p className="muted">{t('account.loading')}</p>
      </div>
    );

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setBusy(false);
    }
  };
  const premium = me.plan === 'premium';

  return (
    <div className="account-card">
      <div className="account-card__who">
        <span className="account-card__avatar" aria-hidden>
          {me.email.slice(0, 1).toUpperCase()}
        </span>
        <div className="account-card__id">
          <div className="account-card__email">{me.email}</div>
          {premium ? (
            <button type="button" className="account-card__plan" onClick={onPremium}>
              <PremiumMark size={13} />
              <span>
                {me.planEndsAt
                  ? t('account.premiumUntil', { date: planLastDay(me.planEndsAt, lang) })
                  : t('account.premium')}
                {me.planSource === 'early_access' && ` · ${t('account.earlyAccess')}`}
              </span>
            </button>
          ) : (
            <div className="account-card__plan account-card__plan--usage">
              {t('account.free')} ·{' '}
              {t('account.events', {
                used: me.usage.events.used,
                limit: me.usage.events.limit,
              })}
            </div>
          )}
        </div>
      </div>
      <ContributorSection onOpenEvent={onOpenEvent} onAddAgain={onAddAgain} />
      <FeedsSection />
      <div className="account-card__actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run(account.exportData)}
        >
          <Icon name="download" size={18} />
          {t('account.export')}
        </button>
        <button type="button" className="btn" onClick={account.signOut}>
          {t('account.signOut')}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="button" className="inline-link danger-link" onClick={onDelete}>
          {t('account.delete')}
        </button>
      </div>
    </div>
  );
}

/** "Delete your account?" (M8 §2): DELETE /api/me, then signed out. */
export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const { deleteAccount } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      onClose();
    } catch (err) {
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('account.delete.title')} onClose={onClose} role="alertdialog">
      <p className="account-sheet__lead">{t('account.delete.body')}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-sheet__foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy}
          onClick={() => void remove()}
        >
          <Icon name="trash" size={18} />
          {t('account.delete')}
        </button>
      </div>
    </Sheet>
  );
}
