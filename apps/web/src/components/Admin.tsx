import { useCallback, useEffect, useRef, useState } from 'react';
import { localDay } from '@happow/core';
import {
  activeFirst,
  addGrant,
  decideSource,
  deleteCodeRequest,
  endGrant,
  generateCode,
  grantEndsAt,
  listCodeRequests,
  listGrants,
  listSources,
  restoreTrust,
  sourceLists,
  type CodeRequest,
  type Grant,
  type ReadyEmail,
  type SourceAction,
  type SourceCandidate,
} from '../admin';
import { ApiError } from '../api';
import { region } from '../config';
import { errorText } from '../errors';
import { formatAgo, formatDay, formatTime, isSameDay } from '../format';
import { useI18n } from '../i18n';
import { Icon } from './Icons';
import { planLastDay, PremiumMark } from './Premium';
import { Sheet } from './Sheet';

/**
 * The admin's tabs in the staff screen (M8 slice F, `docs/design/admin.html`): sign-in code
 * requests with a ready email to send by hand, and manual premium grants. M12 slice C2 adds the
 * website check's candidates (Sources).
 */

/** Copies `text`; when the clipboard is refused, selects `el` so it can be copied by hand. */
async function copy(text: string, el: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return false;
  }
}

/** Code requests, oldest first. `reload` changes when the staff bar's Refresh is tapped. */
export function CodeRequests({
  reload,
  onCount,
}: {
  reload: number;
  onCount: (n: number) => void;
}) {
  const { t, lang } = useI18n();
  const [requests, setRequests] = useState<CodeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mail, setMail] = useState<ReadyEmail | null>(null);
  const [deleting, setDeleting] = useState<CodeRequest | null>(null);
  const count = useRef(onCount);
  count.current = onCount;

  const load = useCallback(async () => {
    try {
      const list = await listCodeRequests();
      setRequests(list);
      setError(null);
      count.current(list.length);
    } catch (err) {
      setError(errorText(t, err, lang));
    }
  }, [t, lang]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  async function generate(r: CodeRequest) {
    setBusy(r.id);
    setRowError(null);
    try {
      setMail(await generateCode(r.id));
      // The row now says when its code was made.
      void load();
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === 'auth_failed'
          ? t('admin.codes.authFailed')
          : errorText(t, err, lang);
      setRowError({ id: r.id, message });
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  const made = (iso: string) =>
    isSameDay(iso, now, region.timezone)
      ? t('admin.codes.madeAt', { time: formatTime(iso, region.timezone, lang) })
      : t('admin.codes.madeOn', {
          // "23.10" / "23 Oct": the weekday adds nothing within the 7 days a request lives.
          day: new Intl.DateTimeFormat(lang, {
            day: 'numeric',
            month: lang === 'pl' ? '2-digit' : 'short',
            timeZone: region.timezone,
          }).format(new Date(iso)),
          time: formatTime(iso, region.timezone, lang),
        });

  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {requests === null && !error && <p className="muted">{t('event.loading')}</p>}
      {requests?.length === 0 && (
        <div className="admin-empty">
          <Icon name="mail" size={32} strokeWidth={1.6} />
          <strong>{t('admin.codes.empty')}</strong>
          <span>{t('admin.codes.emptyLead')}</span>
        </div>
      )}
      {requests && requests.length > 0 && (
        <section className="mod-section">
          <h2>{t('admin.codes.heading', { count: requests.length })}</h2>
          {requests.map((r) => {
            const locale = r.locale === 'pl' ? 'pl' : 'en';
            return (
              <article key={r.id} className="mod-card">
                <div className="admin-card__top">
                  <h3 className="admin-card__email">{r.email}</h3>
                  <span className="admin-lang">
                    <span aria-hidden>{locale.toUpperCase()}</span>
                    <span className="visually-hidden">{t(`language.${locale}`)}</span>
                  </span>
                </div>
                <p className="mod-card__meta">
                  {formatAgo(r.createdAt, now, lang, t('time.justNow'))} ·{' '}
                  {r.existingUser ? t('admin.codes.hasAccount') : t('admin.codes.newAccount')}
                </p>
                {r.generatedAt && (
                  <p className="admin-made">
                    <Icon name="check" size={15} strokeWidth={2.4} />
                    {made(r.generatedAt)}
                  </p>
                )}
                {rowError?.id === r.id && (
                  <p className="form-error admin-row-error" role="alert">
                    {rowError.message}
                  </p>
                )}
                <div className="admin-actions">
                  <button
                    type="button"
                    className={r.generatedAt ? 'btn' : 'btn btn--primary'}
                    disabled={busy === r.id}
                    onClick={() => void generate(r)}
                  >
                    {r.generatedAt ? t('admin.codes.again') : t('admin.codes.generate')}
                  </button>
                  <button
                    type="button"
                    className="inline-link danger-link"
                    onClick={() => setDeleting(r)}
                  >
                    {t('admin.codes.delete')}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {mail && <ReadyEmailSheet mail={mail} onClose={() => setMail(null)} />}
      {deleting && (
        <DeleteRequestSheet
          request={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const left = (requests ?? []).filter((x) => x.id !== deleting.id);
            setRequests(left);
            onCount(left.length);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

function DeleteRequestSheet({
  request,
  onClose,
  onDeleted,
}: {
  request: CodeRequest;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteCodeRequest(request.id);
      onDeleted();
    } catch (err) {
      // Gone already (signed in, or purged): it leaves the list either way.
      if (err instanceof ApiError && err.status === 404) return onDeleted();
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('admin.delete.title')} onClose={onClose} role="alertdialog">
      <p className="account-sheet__lead admin-sheet__who">{request.email}</p>
      <p className="account-sheet__lead">{t('admin.delete.body')}</p>
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
          {t('admin.codes.delete')}
        </button>
      </div>
    </Sheet>
  );
}

/** After Generate: the code to read out, and the email to send from the owner's own address. */
export function ReadyEmailSheet({ mail, onClose }: { mail: ReadyEmail; onClose: () => void }) {
  const { t } = useI18n();
  const address = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState<'address' | 'email' | null>(null);
  /** What was selected for copying by hand after the clipboard refused. */
  const [manual, setManual] = useState<'address' | 'email' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copyIt(what: 'address' | 'email') {
    const ok =
      what === 'address'
        ? await copy(mail.email, address.current)
        : await copy(`${mail.subject}\n\n${mail.body}`, body.current);
    setManual(ok ? null : what);
    setCopied(ok ? what : null);
    clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setCopied(null), 2000);
  }

  const hint = (what: 'address' | 'email') =>
    manual === what && (
      <p className="admin-hint" role="status">
        {t('admin.ready.holdToCopy')}
      </p>
    );

  return (
    <Sheet title={t('admin.ready.title')} onClose={onClose}>
      <div className="admin-code">
        <div className="admin-code__num">
          <span aria-hidden>
            {mail.code.slice(0, 3)}
            <span className="admin-code__gap" />
            {mail.code.slice(3)}
          </span>
          {/* Read digit by digit, as it would be over the phone. */}
          <span className="visually-hidden">{mail.code.split('').join(' ')}</span>
        </div>
        <div className="admin-code__for">{t('admin.ready.codeFor', { email: mail.email })}</div>
      </div>
      <div className="admin-ro">
        <span className="admin-ro__label">{t('admin.ready.to')}</span>
        <div className="admin-ro__line">
          <div
            ref={address}
            className={manual === 'address' ? 'admin-ro__value is-selected' : 'admin-ro__value'}
          >
            {mail.email}
          </div>
          <button
            type="button"
            className="copy-btn"
            aria-label={
              copied === 'address' ? t('admin.ready.copied') : t('admin.ready.copyAddress')
            }
            onClick={() => void copyIt('address')}
          >
            <Icon name={copied === 'address' ? 'check' : 'copy'} size={18} />
          </button>
        </div>
        {hint('address')}
      </div>
      <div className="admin-ro">
        <span className="admin-ro__label">{t('admin.ready.subject')}</span>
        <div className="admin-ro__value">{mail.subject}</div>
      </div>
      <div className="admin-ro">
        <span className="admin-ro__label">{t('admin.ready.body')}</span>
        <pre
          ref={body}
          className={
            manual === 'email'
              ? 'admin-ro__value admin-ro__body is-selected'
              : 'admin-ro__value admin-ro__body'
          }
        >
          {mail.body}
        </pre>
        {hint('email')}
      </div>
      <div className="account-sheet__foot">
        <button type="button" className="btn" onClick={() => void copyIt('email')}>
          <Icon name={copied === 'email' ? 'check' : 'copy'} size={18} />
          {copied === 'email' ? t('admin.ready.copied') : t('admin.ready.copyEmail')}
        </button>
        <a className="btn btn--primary" href={mail.mailto}>
          <Icon name="mail" size={18} />
          {t('admin.ready.openMail')}
        </a>
      </div>
      <p className="account-note admin-note">{t('admin.ready.againNote')}</p>
      <button type="button" className="btn btn--block" onClick={onClose}>
        {t('admin.ready.done')}
      </button>
    </Sheet>
  );
}

/** Grants, active first. End only on active manual ones; Give premium on top. */
export function Grants({ reload }: { reload: number }) {
  const { t, lang } = useI18n();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  const [trusting, setTrusting] = useState(false);
  const [ending, setEnding] = useState<Grant | null>(null);

  const load = useCallback(async () => {
    try {
      setGrants(activeFirst(await listGrants()));
      setError(null);
    } catch (err) {
      setError(errorText(t, err, lang));
    }
  }, [t, lang]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const now = Date.now();
  const end = (g: Grant) =>
    g.endsAt === null
      ? t('admin.grants.noEnd')
      : Date.parse(g.endsAt) <= now
        ? t('admin.grants.endedOn', { date: planLastDay(g.endsAt, lang) })
        : t('admin.grants.until', { date: planLastDay(g.endsAt, lang) });

  const active = grants?.filter((g) => g.active) ?? [];
  const ended = grants?.filter((g) => !g.active) ?? [];
  const card = (g: Grant) => (
    <article key={g.id} className={g.active ? 'mod-card' : 'mod-card mod-card--ended'}>
      <div className="admin-card__top">
        <h3 className="admin-card__email">{g.email}</h3>
      </div>
      <p className="admin-plan">
        {g.plan === 'premium' && <PremiumMark size={13} />}
        <span>
          {g.plan === 'premium' ? t('account.premium') : t('account.free')} ·{' '}
          {t(`admin.grants.source.${g.source}`)} · {end(g)}
        </span>
      </p>
      {g.note && <blockquote className="mod-card__note">{g.note}</blockquote>}
      <div className="admin-actions admin-actions--grant">
        <span className="mod-card__meta">
          {g.createdBy && t('admin.grants.by', { email: g.createdBy })}
        </span>
        {g.active && g.source === 'manual' && (
          <button type="button" className="inline-link danger-link" onClick={() => setEnding(g)}>
            {t('admin.grants.end')}
          </button>
        )}
      </div>
    </article>
  );

  return (
    <>
      <button
        type="button"
        className="btn btn--primary btn--block admin-give"
        onClick={() => setGiving(true)}
      >
        <PremiumMark size={16} />
        {t('admin.grants.give')}
      </button>
      <button type="button" className="btn btn--block admin-give" onClick={() => setTrusting(true)}>
        {t('admin.trust.restore')}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {grants === null && !error && <p className="muted">{t('event.loading')}</p>}
      {grants?.length === 0 && <p className="muted">{t('admin.grants.empty')}</p>}
      {active.length > 0 && (
        <section className="mod-section">
          <h2>{t('admin.grants.active', { count: active.length })}</h2>
          {active.map(card)}
        </section>
      )}
      {ended.length > 0 && (
        <section className="mod-section">
          <h2>{t('admin.grants.ended', { count: ended.length })}</h2>
          {ended.map(card)}
        </section>
      )}
      {giving && (
        <GiveGrantSheet
          onClose={() => setGiving(false)}
          onGiven={() => {
            setGiving(false);
            void load();
          }}
        />
      )}
      {trusting && <RestoreTrustSheet onClose={() => setTrusting(false)} />}
      {ending && (
        <EndGrantSheet
          grant={ending}
          onClose={() => setEnding(null)}
          onEnded={() => {
            setEnding(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function EndGrantSheet({
  grant,
  onClose,
  onEnded,
}: {
  grant: Grant;
  onClose: () => void;
  onEnded: () => void;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await endGrant(grant.id);
      onEnded();
    } catch (err) {
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('admin.end.title')} onClose={onClose} role="alertdialog">
      <p className="account-sheet__lead">{t('admin.end.body', { email: grant.email })}</p>
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
          onClick={() => void confirm()}
        >
          {t('admin.end.confirm')}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Restore trust (M12 §5.3): a rejection removes a contributor's trust until the admin gives it
 * back here. Their events then skip the queue again, while they still meet the threshold.
 */
export function RestoreTrustSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function restore() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await restoreTrust(email.trim());
      setRestored(email.trim());
      setEmail('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? t('admin.trust.notFound')
          : errorText(t, err, lang),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('admin.trust.restore')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void restore();
        }}
        noValidate
      >
        <p className="account-sheet__lead">{t('admin.trust.lead')}</p>
        <div className="field">
          <label className="field__label" htmlFor="trust-email">
            {t('admin.give.email')}
          </label>
          <input
            id="trust-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setRestored(null);
            }}
          />
        </div>
        {restored && (
          <p className="muted" role="status">
            {t('admin.trust.done', { email: restored })}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="account-sheet__foot">
          <button type="button" className="btn" onClick={onClose}>
            {restored ? t('add.close') : t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!ready || busy}>
            {t('admin.trust.confirm')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Give premium: email, no end or a last day (sent as midnight after it), an optional note. */
export function GiveGrantSheet({ onClose, onGiven }: { onClose: () => void; onGiven: () => void }) {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [dated, setDated] = useState(false);
  const [lastDay, setLastDay] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = localDay(new Date(), region.timezone);
  // ISO dates compare as text.
  const past = dated && lastDay !== '' && lastDay < today;
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (!dated || (lastDay && !past));

  async function give() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addGrant({
        email: email.trim(),
        endsAt: dated ? grantEndsAt(lastDay) : null,
        ...(note.trim() && { note: note.trim() }),
      });
      onGiven();
    } catch (err) {
      // A past day never gets here (the form refuses it), so invalid_input is the email.
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={
        <>
          <PremiumMark size={18} />
          {t('admin.grants.give')}
        </>
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void give();
        }}
        noValidate
      >
        <p className="account-sheet__lead">{t('admin.give.lead')}</p>
        <div className="field">
          <label className="field__label" htmlFor="grant-email">
            {t('admin.give.email')}
          </label>
          <input
            id="grant-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <fieldset className="field">
          <legend id="grant-end-label" className="field__label">
            {t('admin.give.end')}
          </legend>
          <div
            className="segmented segmented--2"
            role="radiogroup"
            aria-labelledby="grant-end-label"
          >
            {[false, true].map((d) => (
              <button
                key={String(d)}
                type="button"
                role="radio"
                aria-checked={dated === d}
                className={dated === d ? 'is-active' : ''}
                onClick={() => setDated(d)}
              >
                {d ? t('admin.give.lastDay') : t('admin.give.noEnd')}
              </button>
            ))}
          </div>
        </fieldset>
        {dated && (
          <div className="field">
            <label className="field__label" htmlFor="grant-day">
              {t('admin.give.lastDayLabel')}
            </label>
            <input
              id="grant-day"
              type="date"
              min={today}
              value={lastDay}
              aria-invalid={past}
              aria-describedby="grant-day-hint"
              onChange={(e) => setLastDay(e.target.value)}
            />
            <span
              id="grant-day-hint"
              className={past ? 'field__error admin-field-error' : 'field__hint'}
              role={past ? 'alert' : undefined}
            >
              {past ? t('admin.give.pastDate') : t('admin.give.lastDayHint')}
            </span>
          </div>
        )}
        <div className="field">
          <label className="field__label" htmlFor="grant-note">
            {t('admin.give.note')}
          </label>
          <input
            id="grant-note"
            type="text"
            maxLength={500}
            value={note}
            aria-describedby="grant-note-hint"
            onChange={(e) => setNote(e.target.value)}
          />
          <span id="grant-note-hint" className="field__hint">
            {t('admin.give.noteHint')}
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--block" disabled={!ready || busy}>
          {t('admin.grants.give')}
        </button>
      </form>
    </Sheet>
  );
}

const KIND_CHIP: Record<SourceCandidate['kind'], string> = {
  ical: 'iCal',
  tribe: 'API',
  jsonld: 'JSON-LD',
};
type SourceView = 'new' | 'read' | 'rejected';
const SOURCE_VIEWS: SourceView[] = ['new', 'read', 'rejected'];

/**
 * The website check's candidates (M12 slice C2, `docs/design/admin.html`): New, Read (paused
 * first) and Rejected. Every decision can be undone from another list, so none asks first.
 */
export function Sources({ reload, onCount }: { reload: number; onCount: (n: number) => void }) {
  const { t, lang } = useI18n();
  const [all, setAll] = useState<SourceCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [view, setView] = useState<SourceView>('new');
  // Accepted here: the card stays in New, saying when reading starts, until the next refresh.
  const [justAccepted, setJustAccepted] = useState<ReadonlySet<number>>(new Set());
  const count = useRef(onCount);
  count.current = onCount;

  const load = useCallback(async () => {
    try {
      const list = await listSources();
      setAll(list);
      setJustAccepted(new Set());
      setError(null);
      count.current(sourceLists(list).fresh.length);
    } catch (err) {
      setError(errorText(t, err, lang));
    }
  }, [t, lang]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  async function decide(c: SourceCandidate, action: SourceAction) {
    setBusy(c.id);
    setRowError(null);
    try {
      const { status } = await decideSource(c.id, action);
      const next = (all ?? []).map((x) =>
        x.id === c.id
          ? { ...x, status, decidedAt: new Date().toISOString(), failures: 0, lastError: null }
          : x,
      );
      setAll(next);
      const accepted = new Set(justAccepted);
      if (action === 'accept') accepted.add(c.id);
      else accepted.delete(c.id);
      setJustAccepted(accepted);
      count.current(sourceLists(next).fresh.length);
    } catch (err) {
      // Decided elsewhere meanwhile (another tab, or a run paused it): show the current lists.
      if (err instanceof ApiError && (err.code === 'already_reviewed' || err.status === 404))
        void load();
      else setRowError({ id: c.id, message: errorText(t, err, lang) });
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  const tz = region.timezone;
  /** A sample's start as the check stored it: a date, an instant, or local wall time. */
  const sampleWhen = (start: string) => {
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(start))
      return `${formatDay(start, tz, lang)} ${formatTime(start, tz, lang)}`;
    // A date or a wall time is already local: read it as UTC so no zone shifts it.
    const day = formatDay(`${start.slice(0, 10)}T12:00:00Z`, 'UTC', lang);
    if (start.length === 10) return day;
    return `${day} ${formatTime(`${start.slice(0, 16)}:00Z`, 'UTC', lang)}`;
  };

  const lists = sourceLists(all ?? []);
  const fresh = (all ?? []).filter((c) => c.status === 'new' || justAccepted.has(c.id));
  const shown = view === 'new' ? fresh : view === 'read' ? lists.read : lists.rejected;
  const counts = {
    new: lists.fresh.length,
    read: lists.read.length,
    rejected: lists.rejected.length,
  };

  const button = (c: SourceCandidate, action: SourceAction) => (
    <button
      type="button"
      className="btn btn--primary"
      disabled={busy === c.id}
      onClick={() => void decide(c, action)}
    >
      {t(`admin.sources.${action}`)}
    </button>
  );
  const link = (c: SourceCandidate, action: SourceAction, danger = true) => (
    <button
      type="button"
      className={danger ? 'inline-link danger-link' : 'inline-link danger-link admin-quiet-link'}
      disabled={busy === c.id}
      onClick={() => void decide(c, action)}
    >
      {t(`admin.sources.${action}`)}
    </button>
  );
  const kind = (c: SourceCandidate) => t(`admin.sources.kind.${c.kind}`);
  const ago = (iso: string) => formatAgo(iso, now, lang, t('time.justNow'));

  const card = (c: SourceCandidate) => {
    const accepted = justAccepted.has(c.id) && c.status === 'accepted';
    const meta =
      c.status === 'rejected'
        ? t('admin.sources.rejectedOn', {
            date: c.decidedAt ? formatDay(c.decidedAt, tz, lang) : '',
          })
        : c.status === 'paused'
          ? kind(c)
          : c.status === 'accepted' && !accepted
            ? `${kind(c)} · ${
                c.lastRunAt
                  ? t('admin.sources.lastRun', {
                      when: ago(c.lastRunAt),
                      events: t('admin.sources.events', { count: c.lastRunEvents ?? 0 }),
                    })
                  : t('admin.sources.notRunYet')
              }`
            : `${kind(c)} · ${t('admin.sources.upcoming', { count: c.eventCount })} · ${t(
                'admin.sources.found',
                { ago: ago(c.foundAt) },
              )}`;
    const showSamples = c.status === 'new' || accepted;
    return (
      <article
        key={c.id}
        className={c.status === 'rejected' ? 'mod-card mod-card--ended' : 'mod-card'}
      >
        <div className="admin-card__top">
          <h3 className="admin-card__email">{c.venueName}</h3>
          <span className="admin-lang">{KIND_CHIP[c.kind]}</span>
        </div>
        <a className="admin-site" href={c.url} target="_blank" rel="noreferrer">
          {c.url.replace(/^https?:\/\//, '')}
        </a>
        <p className="mod-card__meta">{meta}</p>
        {showSamples && c.sample.length > 0 && (
          <>
            <ul className="admin-samples">
              {c.sample.map((s, i) => (
                <li key={i}>
                  <time>{sampleWhen(s.start)}</time>
                  <span>{s.title}</span>
                </li>
              ))}
            </ul>
            {c.eventCount > c.sample.length && (
              <p className="admin-more">
                {t('admin.sources.more', { count: c.eventCount - c.sample.length })}
              </p>
            )}
          </>
        )}
        {accepted && (
          <p className="admin-made">
            <Icon name="check" size={15} strokeWidth={2.4} />
            {t('admin.sources.accepted')}
          </p>
        )}
        {c.status === 'paused' && (
          <p className="form-error admin-row-error">
            {t('admin.sources.paused', { count: c.failures, error: c.lastError ?? '?' })}
          </p>
        )}
        {rowError?.id === c.id && (
          <p className="form-error admin-row-error" role="alert">
            {rowError.message}
          </p>
        )}
        <div className="admin-actions">
          {c.status === 'new' && (
            <>
              {button(c, 'accept')}
              {link(c, 'reject')}
            </>
          )}
          {c.status === 'paused' && (
            <>
              {button(c, 'resume')}
              {link(c, 'stop')}
            </>
          )}
          {c.status === 'accepted' && link(c, 'stop', !accepted)}
          {c.status === 'rejected' && link(c, 'restore', false)}
        </div>
      </article>
    );
  };

  return (
    <>
      <div
        className="segmented segmented--3 admin-sublists"
        role="tablist"
        aria-label={t('admin.sources.lists')}
      >
        {SOURCE_VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? 'is-active' : ''}
            onClick={() => setView(id)}
          >
            {t(`admin.sources.${id}`)}
            {counts[id] > 0 && <span className="admin-sublists__n">{counts[id]}</span>}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {all === null && !error && <p className="muted">{t('event.loading')}</p>}
      {all !== null && shown.length === 0 && view === 'new' && (
        <div className="admin-empty">
          <Icon name="check" size={32} strokeWidth={1.6} />
          <strong>{t('admin.sources.empty')}</strong>
          <span>{t('admin.sources.emptyLead')}</span>
        </div>
      )}
      {all !== null && shown.length === 0 && view !== 'new' && (
        <p className="muted">
          {view === 'read' ? t('admin.sources.emptyRead') : t('admin.sources.emptyRejected')}
        </p>
      )}
      {shown.map(card)}
    </>
  );
}
