import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../account';
import { loadFriends, setFriendsOverride, type FriendsView } from '../contacts';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

export interface Friends {
  view: FriendsView | null;
  toggle: () => Promise<void>;
}

/**
 * The friends' view of one event, loaded once and shared by the switch in the answer row and the
 * names under it. Both sides opt in: the account switch, or the per-event switch, either way.
 * Null view when signed out or not loaded: neither part shows.
 */
export function useFriends(eventId: string, enabled = true): Friends {
  const account = useAccount();
  const [view, setView] = useState<FriendsView | null>(null);
  const signedIn = enabled && account.status === 'signedIn';
  const friendsVisible = !!account.me?.friendsVisible;

  useEffect(() => {
    if (!signedIn) {
      setView(null);
      return;
    }
    let live = true;
    loadFriends(eventId).then(
      (v) => live && setView(v),
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [eventId, signedIn]);

  const toggle = useCallback(async () => {
    if (!view) return;
    // The opposite of what shows now, for this event only.
    const show = !view.shown;
    await setFriendsOverride(eventId, show === friendsVisible ? null : show);
    setView(await loadFriends(eventId));
  }, [eventId, view, friendsVisible]);

  return { view: signedIn ? view : null, toggle };
}

/** Icon-only switch beside "I'm going": show friends I'm going to this. */
export function FriendsToggle({ friends }: { friends: Friends }) {
  const { t } = useI18n();
  if (!friends.view) return null;
  return (
    <button
      type="button"
      className="btn going__btn going__btn--icon"
      aria-pressed={friends.view.shown}
      aria-label={t('friends.thisEvent')}
      onClick={() => void friends.toggle()}
    >
      <Icon name="users" size={20} />
    </button>
  );
}

/** Friends who are going, on the way or here, by name, for every category. */
export function FriendsLine({ friends }: { friends: Friends }) {
  const { t } = useI18n();
  const view = friends.view;
  if (!view?.shown) return null;
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
  if (!parts.length && !view.fromMyLinks.length) return null;

  return (
    <div className="friends-line">
      {parts.length > 0 && (
        <p>
          <Icon name="users" size={16} /> {parts.join(' · ')}
        </p>
      )}
      {view.fromMyLinks.length > 0 && (
        <p className="muted">{t('friends.fromLinks', { names: view.fromMyLinks.join(', ') })}</p>
      )}
    </div>
  );
}
