import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { accessToken, authAvailable, loadSession, sendMagicLink, signOut } from '../auth';
import { config, region } from '../config';
import { errorText } from '../errors';
import { formatDay, formatTime } from '../format';
import { eventHref } from '../hooks/useHashRoute';
import { useI18n } from '../i18n';
import { Screen } from './Screen';

const sourceNames = new Map(config.sources.map((s) => [s.id, s.name]));

interface QueuedSubmission {
  id: string;
  kind: 'user' | 'crawl';
  source_id: string | null;
  url: string | null;
  confidence: number | null;
  event_id: string | null;
  created_at: string;
  submitter: string | null;
  event: { title: string; startAt: string; timezone?: string; categoryIds?: string[] } | null;
  venue: { name: string; address: string | null } | null;
}

interface ReportedEvent {
  event_id: string;
  title: string;
  start_at: string;
  status: string;
  hidden: boolean;
  venue_name: string | null;
  count: number;
  reasons: Record<string, number>;
  notes: string[] | null;
}

interface Queue {
  moderator: string;
  submissions: QueuedSubmission[];
  reports: ReportedEvent[];
}

type State =
  | { name: 'loading' }
  | { name: 'signedOut'; sent?: boolean; error?: string }
  | { name: 'forbidden'; email: string | null }
  | { name: 'error'; message: string }
  | { name: 'ready'; queue: Queue };

/** Moderator queue: pending submissions (user and low-confidence crawls) and open reports. */
export function Moderation({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<State>({ name: 'loading' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await accessToken().catch(() => null);
    if (!token) return setState({ name: 'signedOut' });
    setState({ name: 'loading' });
    try {
      setState({ name: 'ready', queue: await api<Queue>('moderation', { token }) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        signOut();
        setState({ name: 'signedOut' });
      } else if (err instanceof ApiError && err.status === 403) {
        setState({ name: 'forbidden', email: loadSession()?.email ?? null });
      } else setState({ name: 'error', message: errorText(t, err, lang) });
    }
  }, [t, lang]);

  useEffect(() => {
    if (authAvailable()) void load();
    // Only on open; Refresh reloads on demand.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(path: string, action: string, key: string) {
    const token = await accessToken();
    if (!token) return setState({ name: 'signedOut' });
    setBusy(key);
    try {
      await api(`moderation/${path}`, { token, body: { action } });
      setState((s) =>
        s.name === 'ready'
          ? {
              ...s,
              queue: {
                ...s.queue,
                submissions: s.queue.submissions.filter((x) => `s:${x.id}` !== key),
                reports: s.queue.reports.filter((x) => `r:${x.event_id}` !== key),
              },
            }
          : s,
      );
    } catch (err) {
      // Someone else got there first: the item is gone either way.
      if (err instanceof ApiError && (err.code === 'already_reviewed' || err.status === 404))
        void load();
      else setState({ name: 'error', message: errorText(t, err, lang) });
    } finally {
      setBusy(null);
    }
  }

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    try {
      const ok = await sendMagicLink(email.trim());
      setState(
        ok ? { name: 'signedOut', sent: true } : { name: 'signedOut', error: t('error.generic') },
      );
    } catch {
      setState({ name: 'signedOut', error: t('error.network') });
    }
  }

  const when = (iso: string, tz = region.timezone) =>
    `${formatDay(iso, tz, lang)} · ${formatTime(iso, tz, lang)}`;

  let body: React.ReactNode;
  if (!authAvailable()) body = <p className="muted">{t('mod.notAvailable')}</p>;
  else if (state.name === 'loading') body = <p className="muted">{t('event.loading')}</p>;
  else if (state.name === 'signedOut')
    body = state.sent ? (
      <p className="notice" role="status">
        {t('mod.linkSent')}
      </p>
    ) : (
      <form className="add-form" onSubmit={requestLink}>
        <p>{t('mod.signIn')}</p>
        <label className="field">
          <span className="field__label">{t('mod.email')}</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={!email.includes('@')}>
          {t('mod.sendLink')}
        </button>
      </form>
    );
  else if (state.name === 'forbidden')
    body = (
      <>
        <p className="form-error">{t('mod.forbidden')}</p>
        {state.email && <p className="muted">{state.email}</p>}
        <SignOut onDone={() => setState({ name: 'signedOut' })} />
      </>
    );
  else if (state.name === 'error')
    body = (
      <>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" className="btn" onClick={load}>
          {t('mod.refresh')}
        </button>
      </>
    );
  else {
    const { queue } = state;
    body = (
      <>
        <div className="mod-bar">
          <span className="muted">{queue.moderator}</span>
          <button type="button" className="btn btn--inline" onClick={load}>
            {t('mod.refresh')}
          </button>
          <SignOut onDone={() => setState({ name: 'signedOut' })} />
        </div>

        <section className="mod-section">
          <h2>{t('mod.submissions', { count: queue.submissions.length })}</h2>
          {queue.submissions.length === 0 && <p className="muted">{t('mod.empty')}</p>}
          {queue.submissions.map((s) => {
            const key = `s:${s.id}`;
            return (
              <article key={s.id} className="mod-card">
                <div className="event-card__cats">
                  {s.kind === 'user'
                    ? t('mod.kind.user')
                    : t('mod.kind.crawl', { source: sourceNames.get(s.source_id ?? '') ?? '?' })}
                  {s.confidence !== null && s.confidence < 1 && (
                    <span> · {t('mod.confidence', { value: Math.round(s.confidence * 100) })}</span>
                  )}
                  {s.event_id && (
                    <span className="badge badge--unverified">{t('mod.published')}</span>
                  )}
                </div>
                <h3>
                  {s.event_id ? (
                    <a href={eventHref(s.event_id)}>{s.event?.title ?? '—'}</a>
                  ) : (
                    (s.event?.title ?? '—')
                  )}
                </h3>
                <p className="mod-card__meta">
                  {s.event && when(s.event.startAt, s.event.timezone)}
                  {s.venue && ` · ${s.venue.name}`}
                  {s.venue?.address && `, ${s.venue.address}`}
                </p>
                {s.url && (
                  <p className="mod-card__meta">
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.url}
                    </a>
                  </p>
                )}
                <div className="event-card__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy === key}
                    onClick={() => act(`submissions/${s.id}`, 'approve', key)}
                  >
                    {t('mod.approve')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === key}
                    onClick={() => act(`submissions/${s.id}`, 'reject', key)}
                  >
                    {t('mod.reject')}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <section className="mod-section">
          <h2>{t('mod.reports', { count: queue.reports.length })}</h2>
          {queue.reports.length === 0 && <p className="muted">{t('mod.empty')}</p>}
          {queue.reports.map((r) => {
            const key = `r:${r.event_id}`;
            const path = `reports/${encodeURIComponent(r.event_id)}`;
            return (
              <article key={r.event_id} className="mod-card">
                <div className="event-card__cats">
                  {t('mod.reportCount', { count: r.count })}
                  {Object.entries(r.reasons).map(([reason, n]) => (
                    <span key={reason} className="badge">
                      {t(`report.reason.${reason as 'other'}`)} ×{n}
                    </span>
                  ))}
                </div>
                <h3>
                  <a href={eventHref(r.event_id)}>{r.title}</a>
                </h3>
                <p className="mod-card__meta">
                  {when(r.start_at)}
                  {r.venue_name && ` · ${r.venue_name}`}
                </p>
                {r.notes?.map((n, i) => (
                  <blockquote key={i} className="mod-card__note">
                    {n}
                  </blockquote>
                ))}
                <div className="event-card__actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === key}
                    onClick={() => act(path, 'dismiss', key)}
                  >
                    {t('mod.dismiss')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === key}
                    onClick={() => act(path, 'cancel', key)}
                  >
                    {t('mod.markCancelled')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger"
                    disabled={busy === key}
                    onClick={() => act(path, 'hide', key)}
                  >
                    {t('mod.hide')}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </>
    );
  }

  return (
    <Screen title={t('mod.title')} onClose={onClose} wide>
      {body}
    </Screen>
  );
}

function SignOut({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="btn btn--inline"
      onClick={() => {
        signOut();
        onDone();
      }}
    >
      {t('mod.signOut')}
    </button>
  );
}
