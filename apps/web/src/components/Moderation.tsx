import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../account';
import { listCodeRequests, listSources, sourceLists } from '../admin';
import { api, ApiError } from '../api';
import { accessToken, authAvailable, loadSession, signOut } from '../auth';
import { config, region } from '../config';
import { errorText } from '../errors';
import { formatDay, formatTime } from '../format';
import { eventHref } from '../hooks/useHashRoute';
import { useI18n } from '../i18n';
import { CodeRequests, Grants, Sources } from './Admin';
import { Coverage } from './Coverage';
import { feedHost } from './Feeds';
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
  /** The dates of one weekly repeat share it (M12 §4.5). */
  series_id?: string | null;
  /** Imported from an account's calendar feed (M12 §4.6). */
  feed_id?: number | null;
  feed_url?: string | null;
  feed_status?: 'active' | 'stopped' | null;
  submitter: string | null;
  event: { title: string; startAt: string; timezone?: string; categoryIds?: string[] } | null;
  venue: { name: string; address: string | null } | null;
}

/** The queue with each weekly repeat as one group, its dates earliest first. */
function grouped(list: QueuedSubmission[]): QueuedSubmission[][] {
  const groups: QueuedSubmission[][] = [];
  const series = new Map<string, QueuedSubmission[]>();
  for (const s of list) {
    const g = s.series_id ? series.get(s.series_id) : undefined;
    if (g) g.push(s);
    else {
      groups.push([s]);
      if (s.series_id) series.set(s.series_id, groups.at(-1)!);
    }
  }
  for (const g of series.values())
    g.sort((a, b) => (a.event?.startAt ?? '').localeCompare(b.event?.startAt ?? ''));
  return groups;
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
  /** Published by trusted accounts in the last 7 days, for spot checks (M12 §5.3). */
  trusted?: QueuedSubmission[];
}

type State =
  | { name: 'loading' }
  | { name: 'signedOut' }
  | { name: 'forbidden'; email: string | null }
  | { name: 'error'; message: string }
  | { name: 'ready'; queue: Queue };

type Tab = 'queue' | 'codes' | 'grants' | 'sources' | 'coverage';
const TABS: Tab[] = ['queue', 'codes', 'grants', 'sources', 'coverage'];

/**
 * The staff screen. Moderators: the queue of pending submissions (user and low-confidence crawls)
 * and open reports. The admin also gets tabs for sign-in code requests and grants (M8 slice F)
 * and the website check's candidates (M12 slice C2).
 */
export function Moderation({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const { me } = useAccount();
  const admin = me?.role === 'admin';
  const [state, setState] = useState<State>({ name: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  // Feeds an admin stopped from this queue (M12 §4.6).
  const [stopped, setStopped] = useState<Set<number>>(new Set());
  const isAdmin = me?.role === 'admin';
  async function stopFeed(id: number) {
    try {
      await api(`admin/feeds/${id}`, { token: await accessToken(), body: { action: 'stop' } });
      setStopped((s) => new Set(s).add(id));
    } catch (err) {
      setState({ name: 'error', message: errorText(t, err, lang) });
    }
  }
  const [tab, setTab] = useState<Tab>('queue');
  // Bumped by Refresh on the admin tabs, which load by themselves.
  const [reload, setReload] = useState(0);
  const [codeCount, setCodeCount] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);

  // The Codes and Sources tabs show their counts before they are opened.
  useEffect(() => {
    if (!admin) return;
    listCodeRequests().then(
      (r) => setCodeCount(r.length),
      () => {},
    );
    listSources().then(
      (r) => setSourceCount(sourceLists(r).fresh.length),
      () => {},
    );
  }, [admin]);

  const signedOut = () => {
    setTab('queue');
    setState({ name: 'signedOut' });
  };

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
                submissions: s.queue.submissions.filter(
                  (x) => `s:${x.id}` !== key && `g:${x.series_id}` !== key,
                ),
                reports: s.queue.reports.filter((x) => `r:${x.event_id}` !== key),
                trusted: s.queue.trusted?.filter((x) => `t:${x.id}` !== key),
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

  const when = (iso: string, tz = region.timezone) =>
    `${formatDay(iso, tz, lang)} · ${formatTime(iso, tz, lang)}`;

  let body: React.ReactNode;
  if (!authAvailable()) body = <p className="muted">{t('mod.notAvailable')}</p>;
  else if (state.name === 'loading') body = <p className="muted">{t('event.loading')}</p>;
  else if (state.name === 'signedOut') body = <p className="muted">{t('mod.signInFirst')}</p>;
  else if (state.name === 'forbidden')
    body = (
      <>
        <p className="form-error">{t('mod.forbidden')}</p>
        {state.email && <p className="muted">{state.email}</p>}
        <SignOut onDone={signedOut} />
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
    const groups = grouped(queue.submissions);
    body = (
      <>
        <StaffBar who={queue.moderator} onRefresh={load} onSignedOut={signedOut} />

        <section className="mod-section">
          <h2>{t('mod.submissions', { count: groups.length })}</h2>
          {groups.length === 0 && <p className="muted">{t('mod.empty')}</p>}
          {groups.map((group) => {
            const s = group[0]!;
            // A weekly repeat is decided once, for all its dates.
            const series = group.length > 1 && s.series_id;
            const key = series ? `g:${series}` : `s:${s.id}`;
            const path = series ? `series/${series}` : `submissions/${s.id}`;
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
                {s.feed_id && (
                  <p className="mod-card__meta">
                    {t('mod.feed', { host: feedHost(s.feed_url ?? '') })}
                    {isAdmin &&
                      (s.feed_status === 'stopped' || stopped.has(s.feed_id) ? (
                        ` · ${t('mod.feedStopped')}`
                      ) : (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="inline-link"
                            onClick={() => void stopFeed(s.feed_id!)}
                          >
                            {t('mod.feedStop')}
                          </button>
                        </>
                      ))}
                  </p>
                )}
                {series && (
                  <p className="mod-card__meta">
                    {t('mod.series', {
                      count: group.length,
                      dates: group
                        .map((x) => x.event && formatDay(x.event.startAt, region.timezone, lang))
                        .join(', '),
                    })}
                  </p>
                )}
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
                    onClick={() => act(path, 'approve', key)}
                  >
                    {t('mod.approve')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === key}
                    onClick={() => act(path, 'reject', key)}
                  >
                    {t('mod.reject')}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        {(queue.trusted?.length ?? 0) > 0 && (
          <section className="mod-section">
            <h2>{t('mod.trusted', { count: queue.trusted!.length })}</h2>
            {queue.trusted!.map((s) => {
              const key = `t:${s.id}`;
              return (
                <article key={s.id} className="mod-card">
                  <div className="event-card__cats">{t('mod.kind.trusted')}</div>
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
                  </p>
                  <div className="event-card__actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy === key}
                      onClick={() => act(`trusted/${s.id}`, 'reject', key)}
                    >
                      {t('mod.reject')}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}

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

  if (admin && me && tab !== 'queue')
    body = (
      <>
        <StaffBar
          who={me.email}
          onRefresh={() => setReload((n) => n + 1)}
          onSignedOut={signedOut}
        />
        {tab === 'codes' ? (
          <CodeRequests reload={reload} onCount={setCodeCount} />
        ) : tab === 'sources' ? (
          <Sources reload={reload} onCount={setSourceCount} />
        ) : tab === 'coverage' ? (
          <Coverage reload={reload} />
        ) : (
          <Grants reload={reload} />
        )}
      </>
    );

  return (
    <Screen title={admin ? t('admin.title') : t('mod.title')} onClose={onClose} wide>
      {admin ? (
        <>
          <div
            className="segmented segmented--5 admin-tabs"
            role="tablist"
            aria-label={t('admin.tabs')}
            onKeyDown={(e) => {
              // Arrow keys move between tabs (WAI-ARIA tabs pattern); Tab leaves the list.
              const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
              if (!step) return;
              e.preventDefault();
              const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
              setTab(next);
              document.getElementById(`staff-tab-${next}`)?.focus();
            }}
          >
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`staff-tab-${id}`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                aria-controls="staff-panel"
                className={tab === id ? 'is-active' : ''}
                onClick={() => setTab(id)}
              >
                {t(`admin.tab.${id}`)}
                {id === 'codes' && codeCount > 0 && (
                  <>
                    {' '}
                    <span className="count-pill">{codeCount}</span>
                  </>
                )}
                {id === 'sources' && sourceCount > 0 && (
                  <>
                    {' '}
                    <span className="count-pill">{sourceCount}</span>
                  </>
                )}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="staff-panel" aria-labelledby={`staff-tab-${tab}`}>
            {body}
          </div>
        </>
      ) : (
        body
      )}
    </Screen>
  );
}

/** Who is signed in, Refresh (the open tab) and Sign out, above every staff tab. */
function StaffBar({
  who,
  onRefresh,
  onSignedOut,
}: {
  who: string;
  onRefresh: () => void;
  onSignedOut: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mod-bar">
      <span className="muted">{who}</span>
      <button type="button" className="btn btn--inline" onClick={onRefresh}>
        {t('mod.refresh')}
      </button>
      <SignOut onDone={onSignedOut} />
    </div>
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
