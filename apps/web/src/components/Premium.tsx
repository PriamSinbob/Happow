import { entitlementsFor, quota } from '@happow/core';
import { useAccount } from '../account';
import { config, region } from '../config';
import { useI18n } from '../i18n';
import { Icon } from './Icons';
import { Sheet } from './Sheet';

/** Tabler sparkles, filled: the premium mark (owner, 2026-10-24, `docs/design/account.html`). */
export function PremiumMark({ size = 14, label }: { size?: number; label?: string }) {
  return (
    <svg
      className="premium-mark"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" />
    </svg>
  );
}

/**
 * The last day a plan applies, from its end instant (midnight after it, local time):
 * "30.11.2026" / "30 Nov 2026".
 */
export function planLastDay(endsAt: string, lang: 'pl' | 'en'): string {
  const last = new Date(new Date(endsAt).getTime() - 1);
  return new Intl.DateTimeFormat(lang === 'pl' ? 'pl-PL' : 'en-GB', {
    day: lang === 'pl' ? '2-digit' : 'numeric',
    month: lang === 'pl' ? '2-digit' : 'short',
    year: 'numeric',
    timeZone: region.timezone,
  }).format(last);
}

const premium = entitlementsFor(config.plans, 'premium');

/** What premium unlocks (M8 §4). No buy button while no payment provider is configured. */
export function PremiumSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const { me } = useAccount();
  const early = me?.planSource === 'early_access' && me.planEndsAt ? me.planEndsAt : null;
  return (
    <Sheet
      title={
        <>
          <PremiumMark size={18} />
          {t('premium.title')}
        </>
      }
      onClose={onClose}
    >
      <p className="account-sheet__lead">{t('premium.lead')}</p>
      <ul className="perks">
        <li>
          <Icon name="check" size={18} />
          <span>{t('premium.events', { events: quota(premium, 'events.perMonth') })}</span>
        </li>
        <li>
          <Icon name="check" size={18} />
          <span>{t('premium.colours')}</span>
        </li>
      </ul>
      {early ? (
        <p className="account-note">{t('premium.early', { date: planLastDay(early, lang) })}</p>
      ) : (
        config.app.premium.providers.length === 0 && (
          <p className="account-note">{t('premium.notOnSale')}</p>
        )
      )}
      <div className="account-sheet__foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('premium.ok')}
        </button>
      </div>
    </Sheet>
  );
}
