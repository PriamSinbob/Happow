import { useState } from 'react';
import { useI18n } from '../i18n';
import { ensurePush, pushSupport } from '../reminders';
import { Icon } from './Icons';

/**
 * "Notify me about changes": shown on an event that is yours while this device has not been
 * asked about notifications yet. One tap asks for the permission and subscribes; the organiser's
 * important updates and schedule changes then arrive as notifications, not only as the red "!".
 * Nothing shows where notifications are already on, blocked or impossible.
 */
export function NotifyHint({ onToast }: { onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<'ask' | 'busy' | 'done'>(() =>
    pushSupport() === 'ok' && Notification.permission === 'default' ? 'ask' : 'done',
  );
  if (state === 'done') return null;
  return (
    <button
      type="button"
      className="notify-hint"
      disabled={state === 'busy'}
      onClick={() => {
        setState('busy');
        ensurePush(lang).then(
          () => {
            setState('done');
            onToast(t('updates.notifyOn'));
          },
          () => setState('done'),
        );
      }}
    >
      <Icon name="bell" size={18} />
      <span>
        <strong>{t('updates.notify')}</strong>
        <span>{t('updates.notifyHint')}</span>
      </span>
    </button>
  );
}
