import { useEffect, useState } from 'react';
import { useAccount } from '../account';
import { loadFriends, setFriendsOverride, type FriendsView } from '../contacts';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

/**
 * The friends' view on an event card (M11 §5, M9 §6): friends who are going, on the way or here,
 * by name, for every category, sensitive ones included. Both sides opt in: the account switch,
 * or "show friends I'm going to this" on the event, either way.
 */
export function FriendsLine({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const account = useAccount();
  const [view, setView] = useState<FriendsView | null>(null);
  const signedIn = account.status === 'signedIn';

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    loadFriends(eventId).then(
      (v) => live && setView(v),
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [eventId, signedIn]);

  if (!signedIn || !view) return null;
  const toggle = async () => {
    // The opposite of what shows now, for this event only.
    const show = !view.shown;
    const same = show === !!account.me?.friendsVisible;
    await setFriendsOverride(eventId, same ? null : show);
    setView(await loadFriends(eventId));
  };
  const names = (kind: 'going' | 'onway' | 'here') =>
    view.friends.filter((f) => f.kinds.includes(kind)).map((f) => f.name);
  const parts = (
    [
      ['here', 'friends.here'],
      ['onway', 'friends.onway'],
      ['going', 'friends.going'],
    ] as const
  )
    .map(([k, key]) => {
      const n = names(k);
      return n.length ? t(key, { names: n.join(', ') }) : null;
    })
    .filter(Boolean);

  return (
    <div className="friends-line">
      {view.shown && parts.length > 0 && (
        <p>
          <Icon name="users" size={16} /> {parts.join(' · ')}
        </p>
      )}
      {view.shown && view.fromMyLinks.length > 0 && (
        <p className="muted">{t('friends.fromLinks', { names: view.fromMyLinks.join(', ') })}</p>
      )}
      <label className="check check--small">
        <input type="checkbox" checked={view.shown} onChange={() => void toggle()} />
        <span>{t('friends.thisEvent')}</span>
      </label>
    </div>
  );
}
