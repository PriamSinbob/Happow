import { useEffect, useState } from 'react';
import type { NearbyEvent } from '@happow/core';
import { useAccount } from '../account';
import { errorText } from '../errors';
import { formatAgo, formatDay, formatTime } from '../format';
import { fromInput, toInput } from '../formTime';
import { useI18n } from '../i18n';
import {
  addPost,
  answerReport,
  checkClaim,
  deletePost,
  editEvent,
  loadMine,
  loadPosts,
  openClaim,
  reportPost,
  type Claim,
  type EditFields,
  type EventPosts,
  type Mine,
  type Post,
  type PostKind,
} from '../organiser';
import { isPrivate, privateEvents } from '../private';
import { Icon } from './Icons';
import { Sheet } from './Sheet';

/**
 * The organiser's part of an event card (M11 §6–§8). For everyone: "Organiser: X ✓" and the
 * posts, important ones pinned on top; loaded with the card, never with the map. For the
 * organiser (or a private event's owner): posting, editing, and the reports people sent. For a
 * signed-in person with no role yet: "I organise this".
 */
export function OrganiserPanel({
  ev,
  now,
  onToast,
  onChanged,
}: {
  ev: NearbyEvent;
  now: Date;
  onToast: (text: string) => void;
  /** An edit or a schedule change was applied: read the event again. */
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const signedIn = account.status === 'signedIn';
  const [data, setData] = useState<EventPosts | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [sheet, setSheet] = useState<'post' | 'edit' | 'claim' | null>(null);
  const [reportingPost, setReportingPost] = useState<Post | null>(null);
  const [tick, setTick] = useState(0);
  const ended = Date.parse(ev.endAt) < now.getTime();

  useEffect(() => {
    let live = true;
    loadPosts(ev.id).then(
      (d) => live && setData(d),
      () => live && setData(null),
    );
    return () => {
      live = false;
    };
  }, [ev.id, tick]);
  useEffect(() => {
    if (!signedIn) {
      setMine(null);
      return;
    }
    let live = true;
    loadMine(ev.id).then(
      (m) => live && setMine(m),
      () => live && setMine(null),
    );
    return () => {
      live = false;
    };
  }, [ev.id, signedIn, tick]);

  const runs = mine?.role === 'owner' || mine?.role === 'organiser';
  const canEdit = !!mine?.role;
  const refresh = () => setTick((n) => n + 1);
  const posts = data?.posts ?? [];

  return (
    <section className="organiser" aria-label={t('organiser.section')}>
      {data?.organiser && data.organiser.kind !== 'private' && (
        <p className="organiser__name">
          {t('organiser.by', { name: data.organiser.name })} <Icon name="check" size={14} />
        </p>
      )}
      {posts.length > 0 && (
        <ul className="posts">
          {posts.map((p) => (
            <li key={p.id} className={`post post--${p.kind}`}>
              <span className="post__kind">{t(`organiser.kind.${p.kind}`)}</span>
              <p className="post__body">{p.body}</p>
              {p.change?.start_at && (
                <p className="post__change">
                  {t('organiser.newStart', {
                    time: `${formatDay(p.change.start_at, ev.timezone, lang)} ${formatTime(p.change.start_at, ev.timezone, lang)}`,
                  })}
                </p>
              )}
              <span className="post__meta">
                {formatAgo(p.createdAt, now, lang, t('time.justNow'))}
                {runs && p.kind !== 'schedule' ? (
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => void deletePost(p.id).then(refresh)}
                  >
                    {t('organiser.deletePost')}
                  </button>
                ) : (
                  <button type="button" className="inline-link" onClick={() => setReportingPost(p)}>
                    {t('organiser.reportPost')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {signedIn && mine && (
        <div className="organiser__tools">
          {runs && !ended && (
            <button type="button" className="btn" onClick={() => setSheet('post')}>
              <Icon name="message" size={18} />
              {t('organiser.post')}
            </button>
          )}
          {canEdit && !ended && (
            <button type="button" className="btn" onClick={() => setSheet('edit')}>
              <Icon name="pencil" size={18} />
              {t('organiser.edit')}
            </button>
          )}
          {!mine.role && !isPrivate(ev) && !ended && (
            <button type="button" className="inline-link" onClick={() => setSheet('claim')}>
              {mine.claim?.status === 'pending' ? t('claim.pendingLink') : t('claim.start')}
            </button>
          )}
        </div>
      )}

      {runs && mine && mine.reports.length > 0 && (
        <Reports eventId={ev.id} reports={mine.reports} onAnswered={refresh} />
      )}

      {sheet === 'post' && mine && (
        <PostSheet
          ev={ev}
          infoPosts={mine.infoPosts}
          onClose={() => setSheet(null)}
          onDone={(notified, changed) => {
            setSheet(null);
            refresh();
            onToast(
              notified ? t('organiser.postedNotified', { count: notified }) : t('organiser.posted'),
            );
            if (changed) onChanged();
          }}
        />
      )}
      {sheet === 'edit' && mine?.role && (
        <EditSheet
          ev={ev}
          role={mine.role}
          onClose={() => setSheet(null)}
          onDone={(status) => {
            setSheet(null);
            onToast(status === 'pending' ? t('edit.pending') : t('edit.saved'));
            if (status === 'applied') onChanged();
          }}
        />
      )}
      {sheet === 'claim' && (
        <ClaimSheet
          ev={ev}
          existing={mine?.claim ?? null}
          onClose={() => {
            setSheet(null);
            refresh();
          }}
        />
      )}
      {reportingPost && (
        <ReportPostSheet
          post={reportingPost}
          onClose={() => setReportingPost(null)}
          onSent={() => {
            setReportingPost(null);
            onToast(t('report.thanks'));
          }}
        />
      )}
    </section>
  );
}

function Reports({
  eventId,
  reports,
  onAnswered,
}: {
  eventId: string;
  reports: Mine['reports'];
  onAnswered: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <div className="organiser__reports">
      <h3 className="contrib__title">{t('organiser.reports', { count: reports.length })}</h3>
      <ul className="my-events">
        {reports.map((r) => (
          <li key={r.id}>
            <div className="my-events__row">
              <span className="my-events__title">
                {t(`report.reason.${r.reason}` as 'report.reason.other')}
              </span>
              <span className="my-events__meta">
                {r.audience === 'moderators' ? t('organiser.alsoModerators') : ''}
              </span>
            </div>
            {r.note && <p className="contrib__line">{r.note}</p>}
            {r.answer && <p className="muted">{t('organiser.yourAnswer', { text: r.answer })}</p>}
            {open === r.id ? (
              <form
                className="field__row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void answerReport(eventId, r.id, note).then(() => {
                    setOpen(null);
                    setNote('');
                    onAnswered();
                  });
                }}
              >
                <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                <button type="submit" className="btn btn--inline">
                  {t('organiser.answer')}
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="inline-link my-events__again"
                onClick={() => setOpen(r.id)}
              >
                {r.audience === 'organiser' ? t('organiser.handle') : t('organiser.answer')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A post: schedule change (moves the event), important (pinned) or info (§7). */
function PostSheet({
  ev,
  infoPosts,
  onClose,
  onDone,
}: {
  ev: NearbyEvent;
  infoPosts: boolean;
  onClose: () => void;
  onDone: (notified: number, changed: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<PostKind>(infoPosts ? 'info' : 'important');
  const [body, setBody] = useState('');
  const [start, setStart] = useState(toInput(ev.startAt, ev.timezone));
  const [end, setEnd] = useState(toInput(ev.endAt, ev.timezone));
  const [status, setStatus] = useState<'scheduled' | 'cancelled' | 'postponed'>('scheduled');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kinds: PostKind[] = ['schedule', 'important', ...(infoPosts ? (['info'] as const) : [])];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let change: { startAt?: string; endAt?: string; status?: string } | undefined;
      if (kind === 'schedule') {
        change = {};
        if (status !== 'scheduled') change.status = status;
        else {
          const s = fromInput(start, ev.timezone);
          const e = fromInput(end, ev.timezone);
          if (s && s !== new Date(ev.startAt).toISOString()) change.startAt = s;
          if (e && e !== new Date(ev.endAt).toISOString()) change.endAt = e;
        }
        if (!Object.keys(change).length) {
          setError(t('organiser.noChange'));
          setBusy(false);
          return;
        }
      }
      const r = await addPost(ev.id, { kind, body: body.trim(), ...(change && { change }) });
      if (kind === 'schedule' && isPrivate(ev))
        privateEvents.patch(ev.id, {
          ...(change?.startAt && { startAt: change.startAt }),
          ...(change?.endAt && { endAt: change.endAt }),
          ...(change?.status && { status: change.status as NearbyEvent['status'] }),
        });
      onDone(r.notified, kind === 'schedule');
    } catch (err) {
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  };

  return (
    <Sheet title={t('organiser.post')} onClose={onClose}>
      <div
        className="segmented segmented--3"
        role="radiogroup"
        aria-label={t('organiser.kindLabel')}
      >
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'is-active' : ''}
            onClick={() => setKind(k)}
          >
            {t(`organiser.kind.${k}`)}
          </button>
        ))}
      </div>
      <p className="field__hint">{t(`organiser.kindHint.${kind}`)}</p>
      {kind === 'schedule' && (
        <>
          <label className="field">
            <span className="field__label">{t('edit.status')}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="scheduled">{t('edit.status.scheduled')}</option>
              <option value="postponed">{t('edit.status.postponed')}</option>
              <option value="cancelled">{t('edit.status.cancelled')}</option>
            </select>
          </label>
          {status === 'scheduled' && (
            <>
              <label className="field">
                <span className="field__label">{t('edit.start')}</span>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">{t('edit.end')}</span>
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </>
          )}
        </>
      )}
      <label className="field">
        <span className="field__label">{t('organiser.text')}</span>
        <textarea value={body} maxLength={280} rows={3} onChange={(e) => setBody(e.target.value)} />
        <span className="field__hint">{t('organiser.textHint', { left: 280 - body.length })}</span>
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
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !body.trim()}
          onClick={() => void submit()}
        >
          {t('organiser.publish')}
        </button>
      </div>
    </Sheet>
  );
}

/** Edit your event (§8): owner and organiser at once; a contributor's edit may wait for review. */
export function EditSheet({
  ev,
  role,
  onClose,
  onDone,
}: {
  ev: NearbyEvent;
  role: NonNullable<Mine['role']>;
  onClose: () => void;
  onDone: (status: 'applied' | 'pending') => void;
}) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState(ev.title);
  const [description, setDescription] = useState(ev.description ?? '');
  const [start, setStart] = useState(toInput(ev.startAt, ev.timezone));
  const [end, setEnd] = useState(toInput(ev.endAt, ev.timezone));
  const [status, setStatus] = useState(ev.status);
  const [isFree, setIsFree] = useState(ev.isFree);
  const [price, setPrice] = useState(ev.priceMin === null ? '' : String(ev.priceMin));
  const [officialUrl, setOfficialUrl] = useState(ev.officialUrl ?? '');
  const [ticketUrl, setTicketUrl] = useState(ev.ticketUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const fields: EditFields = {};
    if (title.trim() !== ev.title) fields.title = title.trim();
    if ((description.trim() || null) !== (ev.description ?? null))
      fields.description = description.trim() || null;
    const s = fromInput(start, ev.timezone);
    const e = fromInput(end, ev.timezone);
    if (s && s !== new Date(ev.startAt).toISOString()) fields.startAt = s;
    if (e && e !== new Date(ev.endAt).toISOString()) fields.endAt = e;
    if (status !== ev.status) fields.status = status;
    if (isFree !== ev.isFree) fields.isFree = isFree;
    const p = isFree ? 0 : price.trim() === '' ? null : Number(price.replace(',', '.'));
    if (p !== ev.priceMin && (p === null || Number.isFinite(p))) {
      fields.priceMin = p;
      fields.priceMax = p;
    }
    if ((officialUrl.trim() || null) !== ev.officialUrl)
      fields.officialUrl = officialUrl.trim() || null;
    if ((ticketUrl.trim() || null) !== ev.ticketUrl) fields.ticketUrl = ticketUrl.trim() || null;
    if (!Object.keys(fields).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await editEvent(ev.id, fields);
      if (r.status === 'applied' && isPrivate(ev))
        privateEvents.patch(ev.id, {
          ...(fields.title && { title: fields.title }),
          ...(fields.startAt && { startAt: fields.startAt }),
          ...(fields.endAt && { endAt: fields.endAt }),
          ...(fields.status && { status: fields.status }),
        });
      onDone(r.status);
    } catch (err) {
      setError(errorText(t, err, lang));
      setBusy(false);
    }
  };

  return (
    <Sheet title={t('organiser.edit')} onClose={onClose}>
      {role === 'contributor' && <p className="field__hint">{t('edit.reviewHint')}</p>}
      <label className="field">
        <span className="field__label">{t('edit.title')}</span>
        <input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{t('edit.start')}</span>
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{t('edit.end')}</span>
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{t('edit.status')}</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="scheduled">{t('edit.status.scheduled')}</option>
          <option value="postponed">{t('edit.status.postponed')}</option>
          <option value="cancelled">{t('edit.status.cancelled')}</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
        <span>{t('event.free')}</span>
      </label>
      {!isFree && (
        <label className="field">
          <span className="field__label">{t('edit.price')}</span>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span className="field__label">{t('edit.description')}</span>
        <textarea
          value={description}
          rows={4}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('event.website')}</span>
        <input type="url" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{t('event.tickets')}</span>
        <input type="url" value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} />
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
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {t('edit.save')}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * "I organise this" (§6): the organiser's public name, then a code to put on the event's or
 * venue's own page ("Check"), or a note for a moderator.
 */
function ClaimSheet({
  ev,
  existing,
  onClose,
}: {
  ev: NearbyEvent;
  existing: Claim | null;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<'event' | 'venue'>(existing?.kind ?? 'event');
  const [name, setName] = useState(existing?.organiser_name ?? ev.venue?.name ?? '');
  const [method, setMethod] = useState<'site' | 'moderator'>(existing?.method ?? 'site');
  const [evidence, setEvidence] = useState('');
  const [claim, setClaim] = useState<Claim | null>(existing);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
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
  const approved = claim?.status === 'approved';

  return (
    <Sheet title={t('claim.title')} onClose={onClose}>
      {!claim || claim.status === 'rejected' ? (
        <>
          <p className="account-sheet__lead">{t('claim.lead')}</p>
          {ev.venue && (
            <div className="segmented segmented--2" role="radiogroup" aria-label={t('claim.what')}>
              <button
                type="button"
                role="radio"
                aria-checked={kind === 'event'}
                className={kind === 'event' ? 'is-active' : ''}
                onClick={() => setKind('event')}
              >
                {t('claim.thisEvent')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === 'venue'}
                className={kind === 'venue' ? 'is-active' : ''}
                onClick={() => setKind('venue')}
              >
                {t('claim.thisVenue', { venue: ev.venue.name })}
              </button>
            </div>
          )}
          <label className="field">
            <span className="field__label">{t('claim.name')}</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <span className="field__hint">{t('claim.nameHint')}</span>
          </label>
          <div className="segmented segmented--2" role="radiogroup" aria-label={t('claim.how')}>
            <button
              type="button"
              role="radio"
              aria-checked={method === 'site'}
              className={method === 'site' ? 'is-active' : ''}
              onClick={() => setMethod('site')}
            >
              {t('claim.bySite')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={method === 'moderator'}
              className={method === 'moderator' ? 'is-active' : ''}
              onClick={() => setMethod('moderator')}
            >
              {t('claim.byModerator')}
            </button>
          </div>
          {method === 'moderator' && (
            <label className="field">
              <span className="field__label">{t('claim.evidence')}</span>
              <textarea
                rows={3}
                maxLength={1000}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
              <span className="field__hint">{t('claim.evidenceHint')}</span>
            </label>
          )}
        </>
      ) : approved ? (
        <p className="account-sheet__lead">{t('claim.approved')}</p>
      ) : claim.method === 'site' ? (
        <>
          <p className="account-sheet__lead">
            {claim.page_url ? t('claim.putCode', { page: claim.page_url }) : t('claim.noPage')}
          </p>
          <p className="claim-code">
            <code>{claim.code}</code>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('claim.copy')}
              onClick={() => void navigator.clipboard?.writeText(claim.code)}
            >
              <Icon name="copy" size={18} />
            </button>
          </p>
          {result && result !== 'approved' && (
            <p className="form-error" role="status">
              {t(`claim.result.${result}` as 'claim.result.missing')}
            </p>
          )}
        </>
      ) : (
        <p className="account-sheet__lead">{t('claim.waiting')}</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-sheet__foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
        {(!claim || claim.status === 'rejected') && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={
              busy || name.trim().length < 2 || (method === 'moderator' && !evidence.trim())
            }
            onClick={() =>
              void run(async () => {
                setClaim(
                  await openClaim({
                    kind,
                    target: kind === 'venue' && ev.venue ? ev.venue.id : ev.id,
                    organiserName: name.trim(),
                    method,
                    evidence: method === 'moderator' ? evidence.trim() : null,
                  }),
                );
              })
            }
          >
            {t('claim.send')}
          </button>
        )}
        {claim && claim.status === 'pending' && claim.method === 'site' && claim.page_url && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await checkClaim(claim.id);
                setResult(r.result);
                setClaim(r.claim);
              })
            }
          >
            {t('claim.check')}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function ReportPostSheet({
  post,
  onClose,
  onSent,
}: {
  post: Post;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t, lang } = useI18n();
  const [reason, setReason] = useState<'inappropriate' | 'unlawful' | 'wrong_info' | 'other'>(
    'wrong_info',
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={t('organiser.reportPost')} onClose={onClose}>
      <div className="choices">
        {(['wrong_info', 'inappropriate', 'unlawful', 'other'] as const).map((r) => (
          <label key={r} className="choice">
            <input
              type="radio"
              name="post-reason"
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            <span>{t(`report.reason.${r}`)}</span>
          </label>
        ))}
      </div>
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
          className="btn btn--primary"
          onClick={() =>
            void reportPost(post.id, reason, null).then(onSent, (err) =>
              setError(errorText(t, err, lang)),
            )
          }
        >
          {t('report.send')}
        </button>
      </div>
    </Sheet>
  );
}
