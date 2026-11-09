import { useEffect, useState } from 'react';
import { useAccount } from '../account';
import { api } from '../api';
import { accessToken } from '../auth';
import {
  acceptContactLink,
  changeContact,
  contactLinkName,
  contactLinkUrl,
  deleteGroup,
  loadContacts,
  newContactLink,
  saveGroup,
  type Contact,
  type ContactBook,
  type Group,
} from '../contacts';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import { Icon } from './Icons';
import { shareLink } from './PrivatePanel';
import { Sheet } from './Sheet';
import { SignInSheet } from './SignIn';

/** "How your friends see you": the display name contacts and invitations need. */
export function NameSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [name, setName] = useState(account.me?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={t('contacts.nameTitle')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          setError(null);
          try {
            await api('me', {
              token: await accessToken(),
              method: 'PUT',
              body: { displayName: name.trim() },
            });
            await account.refresh();
            onSaved();
            onClose();
          } catch (err) {
            setError(errorText(t, err, lang));
            setBusy(false);
          }
        }}
      >
        <p className="account-sheet__lead">{t('contacts.nameLead')}</p>
        <label className="field">
          <span className="field__label">{t('contacts.nameLabel')}</span>
          <input
            value={name}
            maxLength={60}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="account-sheet__foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
            {t('contacts.nameSave')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * Contacts on the account card: the friends' switch, your contact link to share,
 * the people you're connected with, and groups. No address book, no search for people.
 */
export function ContactsSection() {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [book, setBook] = useState<ContactBook | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [group, setGroup] = useState<Group | 'new' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const me = account.me;

  const reload = () => loadContacts().then(setBook, () => setBook(null));
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

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

  const shareMine = () =>
    run(async () => {
      if (!me?.displayName) {
        setNaming(true);
        return;
      }
      const token = book?.link ?? (await newContactLink());
      const r = await shareLink(
        contactLinkUrl(token),
        t('contacts.shareText', { name: me.displayName }),
      );
      if (r === 'copied') setToast(t('private.linkCopied'));
      await reload();
    });

  if (!book || !me) return null;
  return (
    <section className="contrib contacts" aria-labelledby="contacts-title">
      <h3 id="contacts-title" className="contrib__title">
        {t('contacts.title')}
      </h3>
      <p className="contrib__line">
        {me.displayName ? t('contacts.youAre', { name: me.displayName }) : t('contacts.intro')}{' '}
        <button type="button" className="inline-link" onClick={() => setNaming(true)}>
          {me.displayName ? t('contacts.rename') : t('contacts.setName')}
        </button>
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={!!me.friendsVisible}
          disabled={busy}
          onChange={(e) =>
            void run(async () => {
              await api('me', {
                token: await accessToken(),
                method: 'PUT',
                body: { friendsVisible: e.target.checked },
              });
              await account.refresh();
            })
          }
        />
        <span>
          {t('friends.switch')}
          <span className="field__hint">{t('friends.switchHint')}</span>
        </span>
      </label>
      <div className="account-card__actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void shareMine()}>
          <Icon name="share" size={18} />
          {t('contacts.shareLink')}
        </button>
        {book.link && (
          <button
            type="button"
            className="inline-link"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await newContactLink();
                await reload();
                setToast(t('contacts.newLinkDone'));
              })
            }
          >
            {t('contacts.newLink')}
          </button>
        )}
      </div>

      {book.contacts.length > 0 ? (
        <ul className="my-events">
          {book.contacts.map((c) => (
            <ContactRow
              key={c.id}
              c={c}
              busy={busy}
              onAction={(action) =>
                void run(async () => {
                  await changeContact(c.id, action);
                  await reload();
                })
              }
            />
          ))}
        </ul>
      ) : (
        <p className="muted">{t('contacts.empty')}</p>
      )}

      <h3 className="contrib__title">{t('groups.title')}</h3>
      {book.groups.length > 0 && (
        <ul className="my-events">
          {book.groups.map((g) => (
            <li key={g.id}>
              <div className="my-events__row">
                <span className="my-events__title">{g.name}</span>
                <span className="my-events__meta">{t('groups.members', { count: g.members })}</span>
              </div>
              <button
                type="button"
                className="inline-link my-events__again"
                onClick={() => setGroup(g)}
              >
                {t('groups.edit')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="inline-link" onClick={() => setGroup('new')}>
        <Icon name="plus" size={16} /> {t('groups.new')}
      </button>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {toast && (
        <p className="muted" role="status">
          {toast}
        </p>
      )}
      {naming && <NameSheet onClose={() => setNaming(false)} onSaved={() => void reload()} />}
      {group && (
        <GroupSheet
          group={group === 'new' ? null : group}
          contacts={book.contacts.filter((c) => !c.blocked)}
          onClose={() => setGroup(null)}
          onSaved={() => void reload()}
        />
      )}
    </section>
  );
}

function ContactRow({
  c,
  busy,
  onAction,
}: {
  c: Contact;
  busy: boolean;
  onAction: (a: 'remove' | 'block' | 'unblock') => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="my-events__row">
        <span className="my-events__title">{c.name ?? '—'}</span>
        <span className={`my-events__meta${c.blocked ? ' is-warn' : ''}`}>
          {c.blocked ? t('contacts.blocked') : c.mutual ? '' : t('contacts.oneSided')}
        </span>
      </div>
      {open ? (
        <span className="guests__actions">
          {c.blocked ? (
            <button
              type="button"
              className="inline-link"
              disabled={busy}
              onClick={() => onAction('unblock')}
            >
              {t('contacts.unblock')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="inline-link"
                disabled={busy}
                onClick={() => onAction('remove')}
              >
                {t('contacts.remove')}
              </button>
              <button
                type="button"
                className="inline-link danger-link"
                disabled={busy}
                onClick={() => onAction('block')}
              >
                {t('contacts.block')}
              </button>
            </>
          )}
        </span>
      ) : (
        <button
          type="button"
          className="inline-link my-events__again"
          onClick={() => setOpen(true)}
        >
          {t('contacts.manage')}
        </button>
      )}
    </li>
  );
}

function GroupSheet({
  group,
  contacts,
  onClose,
  onSaved,
}: {
  group: Group | null;
  contacts: Contact[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const [name, setName] = useState(group?.name ?? '');
  const [members, setMembers] = useState<Set<string>>(
    () =>
      new Set(group ? contacts.filter((c) => c.groups.includes(group.id)).map((c) => c.id) : []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  };
  return (
    <Sheet title={group ? group.name : t('groups.new')} onClose={onClose}>
      <label className="field">
        <span className="field__label">{t('groups.name')}</span>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="choices">
        {contacts.map((c) => (
          <label key={c.id} className="choice">
            <input
              type="checkbox"
              checked={members.has(c.id)}
              onChange={() =>
                setMembers((s) => {
                  const n = new Set(s);
                  if (n.has(c.id)) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                })
              }
            />
            <span>{c.name ?? '—'}</span>
          </label>
        ))}
      </div>
      {!contacts.length && <p className="muted">{t('contacts.empty')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-sheet__foot">
        {group && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => void run(() => deleteGroup(group.id))}
          >
            <Icon name="trash" size={18} />
            {t('groups.delete')}
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              await saveGroup({
                ...(group && { id: group.id }),
                name: name.trim(),
                members: [...members],
              });
            })
          }
        >
          {t('groups.save')}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Someone's contact link (/c/<token>): whose it is, then "Add" after signing in. Both of
 * you become contacts; nothing else is shared.
 */
export function ContactLinkSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [name, setName] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    contactLinkName(token).then(setName, () => setName(null));
  }, [token]);

  const add = async () => {
    if (!account.me?.displayName) {
      setNaming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptContactLink(token);
      setDone(true);
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t('contacts.linkTitle')} onClose={onClose}>
      {name === undefined ? (
        <p className="muted">{t('account.loading')}</p>
      ) : name === null ? (
        <p className="account-sheet__lead">{t('contacts.linkGone')}</p>
      ) : done ? (
        <p className="account-sheet__lead">{t('contacts.added', { name })}</p>
      ) : (
        <p className="account-sheet__lead">{t('contacts.linkLead', { name })}</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-sheet__foot">
        <button type="button" className="btn" onClick={onClose}>
          {done || !name ? t('common.close') : t('common.cancel')}
        </button>
        {name && !done && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => (account.status === 'signedIn' ? void add() : setSignIn(true))}
          >
            {account.status === 'signedIn' ? t('contacts.add') : t('private.signInToAccept')}
          </button>
        )}
      </div>
      {signIn && (
        <SignInSheet
          onClose={() => setSignIn(false)}
          onSignedIn={() => {
            setSignIn(false);
            void add();
          }}
        />
      )}
      {naming && <NameSheet onClose={() => setNaming(false)} onSaved={() => void add()} />}
    </Sheet>
  );
}
