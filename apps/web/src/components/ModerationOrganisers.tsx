import { useState } from 'react';
import { api } from '../api';
import { accessToken } from '../auth';
import { region } from '../config';
import { errorText } from '../errors';
import { formatDay, formatTime } from '../format';
import { eventHref } from '../hooks/useHashRoute';
import { useI18n } from '../i18n';

/** What the moderation queue adds for M11 (§6–§8): claims, contributors' edits, reported posts. */
export interface OrganiserQueue {
  claims?: {
    id: string;
    kind: 'event' | 'venue';
    eventId: string | null;
    title: string | null;
    organiserName: string;
    method: 'site' | 'moderator';
    pageUrl: string | null;
    evidence: string | null;
    status: 'pending' | 'approved';
    email: string | null;
    competing: number;
    checkedAt: string | null;
  }[];
  edits?: {
    id: number;
    eventId: string;
    title: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[];
  posts?: {
    id: string;
    eventId: string;
    title: string;
    kind: string;
    body: string;
    count: number;
    reasons: Record<string, number> | null;
  }[];
  disagreements?: {
    eventId: string;
    title: string;
    organiser: string | null;
    source: Record<string, unknown>;
    organiserFields: Record<string, unknown>;
  }[];
}

const show = (v: unknown, lang: 'pl' | 'en') =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)
    ? `${formatDay(v, region.timezone, lang)} ${formatTime(v, region.timezone, lang)}`
    : v === null || v === undefined || v === ''
      ? '—'
      : String(v);

/**
 * The moderators' part of M11: approve or reject claims (and revoke approved ones), review
 * contributors' edits, hide or keep reported posts, and see where a source disagrees with an
 * organiser (the organiser's values stay; owner 2026-11-04).
 */
export function OrganiserModeration({ queue }: { queue: OrganiserQueue }) {
  const { t, lang } = useI18n();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(path: string, action: string, key: string) {
    setBusy(key);
    setError(null);
    try {
      await api(`moderation/${path}`, { token: await accessToken(), body: { action } });
      setDone((s) => new Set(s).add(key));
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setBusy(null);
    }
  }
  const claims = (queue.claims ?? []).filter((c) => !done.has(`c:${c.id}`));
  const edits = (queue.edits ?? []).filter((e) => !done.has(`e:${e.id}`));
  const posts = (queue.posts ?? []).filter((p) => !done.has(`p:${p.id}`));
  const disagreements = queue.disagreements ?? [];
  const button = (label: string, path: string, action: string, key: string, danger = false) => (
    <button
      type="button"
      className={`btn${danger ? ' btn--danger' : ''}`}
      disabled={busy === key}
      onClick={() => void act(path, action, key)}
    >
      {label}
    </button>
  );

  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="mod-section">
        <h2>{t('mod.claims', { count: claims.filter((c) => c.status === 'pending').length })}</h2>
        {claims.length === 0 && <p className="muted">{t('mod.empty')}</p>}
        {claims.map((c) => {
          const key = `c:${c.id}`;
          return (
            <article key={c.id} className="mod-card">
              <div className="event-card__cats">
                {t(c.kind === 'venue' ? 'mod.claim.venue' : 'mod.claim.event')}
                <span className="badge">{t(`mod.claim.${c.method}`)}</span>
                {c.status === 'approved' && (
                  <span className="badge">{t('mod.claim.approved')}</span>
                )}
                {c.competing > 0 && (
                  <span className="badge badge--unverified">{t('mod.claim.competing')}</span>
                )}
              </div>
              <h3>
                {c.eventId ? <a href={eventHref(c.eventId)}>{c.title ?? '—'}</a> : (c.title ?? '—')}
              </h3>
              <p className="mod-card__meta">
                {c.organiserName}
                {c.email && ` · ${c.email}`}
                {c.pageUrl && (
                  <>
                    {' · '}
                    <a href={c.pageUrl} target="_blank" rel="noreferrer">
                      {c.pageUrl}
                    </a>
                  </>
                )}
              </p>
              {c.evidence && <blockquote className="mod-card__note">{c.evidence}</blockquote>}
              <div className="event-card__actions">
                {c.status === 'pending' ? (
                  <>
                    {button(t('mod.approve'), `claims/${c.id}`, 'approve', key)}
                    {button(t('mod.reject'), `claims/${c.id}`, 'reject', key)}
                  </>
                ) : (
                  button(t('mod.claim.revoke'), `claims/${c.id}`, 'revoke', key, true)
                )}
              </div>
            </article>
          );
        })}
      </section>

      {edits.length > 0 && (
        <section className="mod-section">
          <h2>{t('mod.edits', { count: edits.length })}</h2>
          {edits.map((e) => {
            const key = `e:${e.id}`;
            return (
              <article key={e.id} className="mod-card">
                <h3>
                  <a href={eventHref(e.eventId)}>{e.title}</a>
                </h3>
                <ul className="mod-card__diff">
                  {Object.keys(e.after).map((k) => (
                    <li key={k}>
                      <strong>{k}</strong>: {show(e.before[k], lang)} → {show(e.after[k], lang)}
                    </li>
                  ))}
                </ul>
                <div className="event-card__actions">
                  {button(t('mod.approve'), `edits/${e.id}`, 'approve', key)}
                  {button(t('mod.reject'), `edits/${e.id}`, 'reject', key)}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {posts.length > 0 && (
        <section className="mod-section">
          <h2>{t('mod.posts', { count: posts.length })}</h2>
          {posts.map((p) => {
            const key = `p:${p.id}`;
            return (
              <article key={p.id} className="mod-card">
                <div className="event-card__cats">
                  {t(`organiser.kind.${p.kind as 'info'}`)}
                  {Object.entries(p.reasons ?? {}).map(([r, n]) => (
                    <span key={r} className="badge">
                      {t(`report.reason.${r as 'other'}`)} ×{n}
                    </span>
                  ))}
                </div>
                <h3>
                  <a href={eventHref(p.eventId)}>{p.title}</a>
                </h3>
                <blockquote className="mod-card__note">{p.body}</blockquote>
                <div className="event-card__actions">
                  {button(t('mod.dismiss'), `posts/${p.id}`, 'dismiss', key)}
                  {button(t('mod.hide'), `posts/${p.id}`, 'hide', key, true)}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {disagreements.length > 0 && (
        <section className="mod-section">
          <h2>{t('mod.disagreements', { count: disagreements.length })}</h2>
          {disagreements.map((d) => (
            <article key={d.eventId} className="mod-card">
              <h3>
                <a href={eventHref(d.eventId)}>{d.title}</a>
              </h3>
              <p className="mod-card__meta">{d.organiser}</p>
              <ul className="mod-card__diff">
                {Object.keys(d.source).map((k) => (
                  <li key={k}>
                    <strong>{k}</strong>: {t('mod.disagree.organiser')}{' '}
                    {show(d.organiserFields[k], lang)} · {t('mod.disagree.source')}{' '}
                    {show(d.source[k], lang)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

/** A private event reported as abuse: hide every private event of its owner and stop new ones. */
export function BlockPrivateButton({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn--danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`moderation/private/${encodeURIComponent(eventId)}`, {
              token: await accessToken(),
              body: { action: 'block' },
            });
            onDone();
          } catch (err) {
            setError(errorText(t, err, lang));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('mod.blockPrivate')}
      </button>
      {error && <span className="form-error">{error}</span>}
    </>
  );
}
