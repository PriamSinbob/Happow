import { useEffect, useState } from 'react';
import type { LatLng } from '@happow/core';
import { useAccount } from '../account';
import { loadContacts, type ContactBook } from '../contacts';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import {
  acceptInviteLink,
  answerInvitation,
  inviteLink,
  invitePeople,
  loadGuests,
  revokeInvitation,
  transferEvent,
  type Guest,
  type PrivateEvent,
} from '../private';
import { shareText } from '../shareEvent';
import { Icon } from './Icons';
import { useNameGate } from './NameField';
import { Sheet } from './Sheet';
import { SignInSheet } from './SignIn';

/** Hands a link to the phone's share sheet (WhatsApp, Messenger, SMS), or copies it. */
export async function shareLink(url: string, text: string): Promise<'shared' | 'copied' | 'none'> {
  try {
    if (navigator.share) {
      await navigator.share({ url, text });
      return 'shared';
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return 'none';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'none';
  }
}

/**
 * The private part of an event's card: the lock and who invited you; Accept or
 * Decline; for the organiser, inviting people, groups or by link, and the guest list.
 */
export function PrivatePanel({
  ev,
  center,
  onToast,
  onGone,
  onChanged = () => {},
}: {
  ev: PrivateEvent;
  center: LatLng | null;
  onToast: (text: string) => void;
  /** Declined: the card closes, as the event leaves your app. */
  onGone: () => void;
  /** Handed over: the event is read again, now as a guest's. */
  onChanged?: () => void;
}) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [guests, setGuests] = useState<Guest[] | null>(null);
  // Handing the event over: the guest picked, asked about once more before it happens.
  const [handing, setHanding] = useState<'pick' | Guest | null>(null);
  const status = ev.invitation?.status ?? null;
  // Activated or still waiting for the code: either may answer an invitation.
  const signedIn = account.member;
  const ended = Date.parse(ev.endAt) < Date.now();
  // Taking an invite link puts your name on the guest list: asked for here, with Accept.
  const name = useNameGate();
  const linkOnly = !!ev.link && !ev.invitation;

  const showGuests = ev.mine || status === 'accepted';
  useEffect(() => {
    if (!showGuests || !signedIn) return;
    let live = true;
    loadGuests(ev.id).then(
      (g) => live && setGuests(g),
      () => live && setGuests(null),
    );
    return () => {
      live = false;
    };
  }, [ev.id, showGuests, signedIn, inviting]);

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

  const answer = (accept: boolean) =>
    run(async () => {
      if (linkOnly) {
        if (!accept) {
          onGone();
          return;
        }
        try {
          await name.ensure();
          await acceptInviteLink(ev.id, center);
        } catch (err) {
          if (name.asksForName(err)) return;
          throw err;
        }
        onToast(t('private.accepted'));
        return;
      }
      await answerInvitation(ev.id, accept);
      onToast(t(accept ? 'private.accepted' : 'private.declined'));
      if (!accept) onGone();
    });

  return (
    <section className="private-panel" aria-label={t('private.badge')}>
      <p className="private-panel__head">
        <Icon name="lock" size={16} />
        <span>
          {t('private.badge')}
          {' · '}
          {ev.mine
            ? t('private.yours')
            : ev.ownerName
              ? t('private.invitedBy', { name: ev.ownerName })
              : t('private.invited')}
        </span>
      </p>

      {!ev.mine && !ended && (status === 'pending' || status === 'declined' || ev.link) && (
        <div className="private-panel__answer">
          {ev.link && !signedIn ? (
            <button type="button" className="btn btn--primary" onClick={() => setSignIn(true)}>
              {t('private.signInToAccept')}
            </button>
          ) : (
            <>
              {linkOnly && name.field}
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || (linkOnly && !name.ready)}
                onClick={() => void answer(true)}
              >
                <Icon name="check" size={18} />
                {t('private.accept')}
              </button>
              {status !== 'declined' && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void answer(false)}
                >
                  {t('private.decline')}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {status === 'accepted' && <p className="muted">{t('private.going')}</p>}

      {ev.mine && !ended && (
        <div className="private-panel__answer">
          <button type="button" className="btn" onClick={() => setInviting(true)}>
            <Icon name="users" size={18} />
            {t('private.invite')}
          </button>
          <button type="button" className="btn" onClick={() => setHanding('pick')}>
            {t('private.handOver')}
          </button>
        </div>
      )}

      {guests && guests.length > 0 && (
        <GuestList
          guests={guests}
          owner={ev.mine}
          busy={busy}
          onRevoke={(g) =>
            void run(async () => {
              await revokeInvitation(g.id!);
              setGuests(await loadGuests(ev.id));
            })
          }
          onShare={(g) =>
            void shareLink(
              `${window.location.origin}/e/${encodeURIComponent(ev.id)}?i=${g.token}`,
              shareText(ev, lang),
            ).then((r) => r === 'copied' && onToast(t('private.linkCopied')))
          }
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {inviting && <InviteSheet ev={ev} onClose={() => setInviting(false)} onToast={onToast} />}
      {handing && (
        <HandOverSheet
          guests={(guests ?? []).filter((g) => g.status === 'accepted' && g.person)}
          picked={handing === 'pick' ? null : handing}
          busy={busy}
          error={error}
          onPick={setHanding}
          onClose={() => {
            setHanding(null);
            setError(null);
          }}
          onConfirm={(g) =>
            void run(async () => {
              await transferEvent(ev.id, g.person!, center);
              setHanding(null);
              onToast(t('private.handedOver', { name: g.name ?? '' }));
              onChanged();
            })
          }
        />
      )}
      {signIn && (
        <SignInSheet
          onClose={() => setSignIn(false)}
          onSignedIn={() => {
            setSignIn(false);
            void answer(true);
          }}
          // The email is enough to accept: the code can follow later.
          onPending={() => {
            setSignIn(false);
            void answer(true);
          }}
        />
      )}
    </section>
  );
}

/**
 * "Hand over": pick one of the accepted guests, then confirm. They become the organiser; you stay
 * as a guest. Only people who accepted can take it, so it never goes to someone who isn't coming.
 */
function HandOverSheet({
  guests,
  picked,
  busy,
  error,
  onPick,
  onClose,
  onConfirm,
}: {
  guests: Guest[];
  picked: Guest | null;
  busy: boolean;
  error: string | null;
  onPick: (g: Guest | 'pick') => void;
  onClose: () => void;
  onConfirm: (g: Guest) => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet title={t('private.handOverTitle')} onClose={onClose}>
      {picked ? (
        <>
          <p className="account-sheet__lead">
            {t('private.handOverConfirm', { name: picked.name ?? '' })}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-sheet__foot">
            <button type="button" className="btn" onClick={() => onPick('pick')}>
              {t('common.back')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => onConfirm(picked)}
            >
              {t('private.handOverDo')}
            </button>
          </div>
        </>
      ) : guests.length ? (
        <>
          <p className="account-sheet__lead">{t('private.handOverLead')}</p>
          <div className="choices">
            {guests.map((g) => (
              <button key={g.person} type="button" className="choice" onClick={() => onPick(g)}>
                {g.name ?? '—'}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="account-sheet__lead">{t('private.handOverNone')}</p>
      )}
    </Sheet>
  );
}

function GuestList({
  guests,
  owner,
  busy,
  onRevoke,
  onShare,
}: {
  guests: Guest[];
  owner: boolean;
  busy: boolean;
  onRevoke: (g: Guest) => void;
  onShare: (g: Guest) => void;
}) {
  const { t } = useI18n();
  const shown = guests.filter((g) => g.status !== 'revoked');
  const accepted = shown.filter((g) => g.status === 'accepted').length;
  return (
    <div className="guests">
      <h3 className="contrib__title">
        {owner
          ? t('private.guestsCount', { accepted, invited: shown.length })
          : t('private.guestsAccepted', { count: accepted })}
      </h3>
      <ul className="my-events">
        {shown.map((g, i) => (
          <li key={g.id ?? `${g.person}-${i}`}>
            <div className="my-events__row">
              <span className="my-events__title">
                {g.name ?? g.label ?? t('private.unnamedLink')}
              </span>
              {owner && (
                <span className="my-events__meta">
                  {g.link && g.token ? t('private.linkUnused') : t(`private.status.${g.status}`)}
                </span>
              )}
            </div>
            {owner && g.id && (
              <span className="guests__actions">
                {g.token && (
                  <button type="button" className="inline-link" onClick={() => onShare(g)}>
                    {t('private.shareAgain')}
                  </button>
                )}
                <button
                  type="button"
                  className="inline-link danger-link"
                  disabled={busy}
                  onClick={() => onRevoke(g)}
                >
                  {t('private.revoke')}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Invite contacts and whole groups, or make a single-use link for someone not on Happow yet. */
function InviteSheet({
  ev,
  onClose,
  onToast,
}: {
  ev: PrivateEvent;
  onClose: () => void;
  onToast: (text: string) => void;
}) {
  const { t, lang } = useI18n();
  const [book, setBook] = useState<ContactBook | null>(null);
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<Set<number>>(new Set());
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Invitations carry your name: asked for in this window, not another one.
  const name = useNameGate();

  useEffect(() => {
    loadContacts().then(setBook, (err) => setError(errorText(t, err, lang)));
  }, [t, lang]);

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
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

  const contacts = book?.contacts.filter((c) => c.mutual && !c.blocked) ?? [];
  return (
    <Sheet title={t('private.inviteTitle')} onClose={onClose}>
      <section className="invite">
        {name.field}
        <h3 className="contrib__title">{t('private.byLink')}</h3>
        <p className="contrib__line">{t('private.byLinkHint')}</p>
        <label className="field">
          <span className="field__label">{t('private.linkLabel')}</span>
          <span className="field__row">
            <input
              value={label}
              maxLength={40}
              placeholder={t('private.linkLabelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--inline"
              disabled={busy || !name.ready}
              onClick={() =>
                void run(async () => {
                  await name.ensure();
                  const url = await inviteLink(ev.id, label);
                  const r = await shareLink(url, shareText(ev, lang));
                  if (r === 'copied') onToast(t('private.linkCopied'));
                  setLabel('');
                })
              }
            >
              <Icon name="share" size={16} />
              {t('private.makeLink')}
            </button>
          </span>
        </label>

        {book && (book.groups.length > 0 || contacts.length > 0) && (
          <>
            <h3 className="contrib__title">{t('private.fromContacts')}</h3>
            {book.groups.length > 0 && (
              <div className="choices">
                {book.groups.map((g) => (
                  <label key={g.id} className="choice">
                    <input
                      type="checkbox"
                      checked={groups.has(g.id)}
                      onChange={() => setGroups((s) => toggle(s, g.id))}
                    />
                    <span>
                      {g.name} <span className="muted">· {g.members}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="choices">
              {contacts.map((c) => (
                <label key={c.id} className="choice">
                  <input
                    type="checkbox"
                    checked={people.has(c.id)}
                    onChange={() => setPeople((s) => toggle(s, c.id))}
                  />
                  <span>{c.name ?? '—'}</span>
                </label>
              ))}
            </div>
          </>
        )}
        {book && !contacts.length && !book.groups.length && (
          <p className="muted">{t('private.noContacts')}</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="account-sheet__foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !name.ready || (!people.size && !groups.size)}
          onClick={() =>
            void run(async () => {
              await name.ensure();
              const n = await invitePeople(ev.id, [...people], [...groups]);
              onToast(t('private.invitedN', { count: n }));
              onClose();
            })
          }
        >
          {t('private.sendInvites')}
        </button>
      </div>
    </Sheet>
  );
}
