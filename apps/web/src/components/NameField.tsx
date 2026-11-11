import { useId, useState, type ReactNode } from 'react';
import { useAccount } from '../account';
import { ApiError } from '../api';
import { saveName } from '../contacts';
import { errorText } from '../errors';
import { useI18n } from '../i18n';

/**
 * The name friends see (contacts, invitations, guest lists), set in place: a field and Save,
 * never a separate window. On the account's Contacts card.
 */
export function NameField() {
  const { t, lang } = useI18n();
  const account = useAccount();
  const id = useId();
  const saved = account.me?.displayName ?? '';
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const changed = name.trim() !== '' && name.trim() !== saved;

  return (
    <form
      className="name-field"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed || busy) return;
        setBusy(true);
        setError(null);
        try {
          await saveName(name.trim());
          await account.refresh();
          setName(name.trim());
          setDone(true);
        } catch (err) {
          setError(errorText(t, err, lang));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {t('contacts.nameLabel')}
        </label>
        <span className="field__row">
          <input
            id={id}
            value={name}
            maxLength={60}
            autoComplete="nickname"
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              setName(e.target.value);
              setDone(false);
            }}
          />
          <button type="submit" className="btn btn--inline" disabled={busy || !changed}>
            {t('contacts.nameSave')}
          </button>
        </span>
        <span className="field__hint" id={`${id}-hint`} role={done ? 'status' : undefined}>
          {done ? t('contacts.nameSaved') : t('contacts.nameLead')}
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * An action that shows your name to others (accepting an invite link, adding a contact,
 * inviting) asks for it right where it happens: a field above the action's own button, and
 * that one tap saves the name and does the action. Without an account it asks nothing.
 */
export function useNameGate() {
  const { t } = useI18n();
  const account = useAccount();
  const id = useId();
  const [name, setName] = useState('');
  // The server said so before the account had loaded (just signed in).
  const [asked, setAsked] = useState(false);
  const needed =
    account.status === 'signedIn' && (asked || (!!account.me && !account.me.displayName));

  const field: ReactNode = needed ? (
    <div className="field name-field">
      <label className="field__label" htmlFor={id}>
        {t('contacts.nameLabel')}
      </label>
      <input
        id={id}
        value={name}
        maxLength={60}
        autoComplete="nickname"
        aria-describedby={`${id}-hint`}
        onChange={(e) => setName(e.target.value)}
      />
      <span className="field__hint" id={`${id}-hint`}>
        {t('contacts.nameLead')}
      </span>
    </div>
  ) : null;

  return {
    field,
    /** The action's button waits for a name while one is needed. */
    ready: !needed || name.trim() !== '',
    /** Before the action: saves the typed name when one is needed. */
    async ensure(): Promise<void> {
      if (!needed) return;
      await saveName(name.trim());
      await account.refresh();
      setAsked(false);
    },
    /** True when the error only meant "no name yet": the field shows, no error text. */
    asksForName(err: unknown): boolean {
      if (!(err instanceof ApiError) || err.code !== 'name_required') return false;
      setAsked(true);
      return true;
    },
  };
}
