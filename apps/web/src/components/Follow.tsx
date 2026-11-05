import { useEffect, useState, type ReactNode } from 'react';
import { can, normName, type LatLng, type NearbyEvent, type Performer } from '@happow/core';
import { useAccount } from '../account';
import { api, ApiError } from '../api';
import { accessToken } from '../auth';
import { region } from '../config';
import { formatDistance, formatRelativeDay, formatTime } from '../format';
import {
  follows,
  parseNames,
  useFollows,
  type FollowMatch,
  type Matches,
  type NationwideDate,
} from '../follows';
import { useI18n } from '../i18n';
import { ensurePush } from '../reminders';
import { useSearch, type SearchHit } from '../search';
import { CategoryIcon } from './EventMeta';
import { Icon } from './Icons';

/** What a list row needs of an event: search hits and follow matches are not full events. */
interface Lite {
  id: string;
  title: string;
  categoryIds: string[];
  startAt: string;
  venueName: string | null;
  point: LatLng;
  distanceM: number | null;
}

const iconEvent = (e: Lite) =>
  ({
    categoryIds: e.categoryIds,
    title: e.title,
    venue: e.venueName ? { id: '', name: e.venueName, address: null } : null,
  }) as unknown as NearbyEvent;

/**
 * Performer chips with ♡ (M7 §4): on the card and the event page. Tapping ♡ follows or unfollows
 * on this device; the name itself is not a link.
 */
export function PerformerChips({ performers }: { performers?: Performer[] }) {
  const { t } = useI18n();
  useFollows();
  if (!performers?.length) return null;
  return (
    <ul className="performers" aria-label={t('follow.performers')}>
      {performers.map((p) => {
        const on = follows.isFollowed(p.name);
        return (
          <li key={normName(p.name)}>
            <button
              type="button"
              className={`performer-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={t(on ? 'follow.unfollowName' : 'follow.followName', { name: p.name })}
              onClick={() => follows.toggle(p.name, p.externalId ?? null)}
            >
              <span className="performer-chip__name">{p.name}</span>
              <Icon name="heart" size={16} filled={on} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** ★ beside a followed artist's event (pins carry a sprite of the same star). */
export function FollowStar() {
  const { t } = useI18n();
  return (
    <span className="follow-star" role="img" aria-label={t('follow.starred')}>
      <Icon name="star" size={14} filled />
    </span>
  );
}

function LiteRow({
  ev,
  now,
  onOpen,
  note,
  extra,
}: {
  ev: Lite;
  now: Date;
  onOpen: () => void;
  note?: ReactNode;
  extra?: ReactNode;
}) {
  const { lang } = useI18n();
  const day = formatRelativeDay(ev.startAt, now, region.timezone, lang);
  const time = formatTime(ev.startAt, region.timezone, lang);
  return (
    <li className="row-wrap">
      <button type="button" className="row" onClick={onOpen}>
        <CategoryIcon ev={iconEvent(ev)} />
        <span className="row__body">
          <span className="row__title">{ev.title}</span>
          <span className="row__when">
            {day}, {time}
            {note}
          </span>
          <span className="row__meta">
            {[
              ev.venueName,
              ev.distanceM !== null ? formatDistance(ev.distanceM, lang) : null,
              region.name[lang],
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </button>
      {extra}
    </li>
  );
}

/** Rows under day headers, soonest first. */
function byDay<T extends { startAt: string }>(items: T[], now: Date, lang: 'pl' | 'en') {
  const groups = new Map<string, T[]>();
  for (const e of [...items].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const day = formatRelativeDay(e.startAt, now, region.timezone, lang);
    groups.set(day, [...(groups.get(day) ?? []), e]);
  }
  return [...groups];
}

/**
 * The search field at the top of the list (§2). With 2+ characters it shows the results of the
 * whole region up to the horizon, by day, instead of the list below it.
 */
export function SearchPanel({
  center,
  now,
  autoFocus,
  onOpen,
  onFollowed,
  children,
}: {
  center: LatLng | null;
  now: Date;
  autoFocus: boolean;
  onOpen: (hit: SearchHit) => void;
  /** Opens the Followed screen. */
  onFollowed: () => void;
  /** The usual list, shown while the field is empty. */
  children: ReactNode;
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const s = useSearch(q, center);
  const list = useFollows();
  const active = q.trim().length >= 2;
  return (
    <>
      <div className="search">
        <label className="search__field">
          <Icon name="search" size={18} />
          <input
            type="search"
            enterKeyHint="search"
            autoFocus={autoFocus}
            maxLength={80}
            placeholder={t('search.placeholder')}
            aria-label={t('search.label')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="icon-btn search__clear"
              aria-label={t('search.clear')}
              onClick={() => setQ('')}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <button
          type="button"
          className="map-btn search__followed"
          aria-label={t('follow.screen', { count: list.length })}
          onClick={onFollowed}
        >
          <Icon name="heart" filled={list.length > 0} />
        </button>
      </div>
      {!active ? (
        children
      ) : s.state === 'loading' || s.state === 'idle' ? (
        <p className="search__status" role="status">
          {t('search.loading')}
        </p>
      ) : s.state === 'error' ? (
        <p className="search__status" role="alert">
          {t(s.code === 'rate_limited' ? 'search.rateLimited' : 'search.error')}
        </p>
      ) : s.results.length === 0 ? (
        <p className="search__status" role="status">
          {t('search.none', { q: q.trim() })}
        </p>
      ) : (
        <ul className="list" aria-label={t('search.results', { count: s.results.length })}>
          {byDay(s.results, now, lang).map(([day, hits]) => (
            <SearchDay key={day} day={day}>
              {hits.map((h) => (
                <LiteRow
                  key={h.id}
                  ev={h}
                  now={now}
                  onOpen={() => onOpen(h)}
                  note={
                    h.matchedPerformer && h.matchedPerformer !== h.title ? (
                      <span className="badge">{h.matchedPerformer}</span>
                    ) : null
                  }
                  extra={
                    h.matchedPerformer && (
                      <FollowButton
                        name={h.matchedPerformer}
                        tmAttractionId={h.matchedExternalId ?? null}
                      />
                    )
                  }
                />
              ))}
            </SearchDay>
          ))}
        </ul>
      )}
    </>
  );
}

function SearchDay({ day, children }: { day: string; children: ReactNode }) {
  return (
    <>
      <li className="list__day" role="presentation">
        {day}
      </li>
      {children}
    </>
  );
}

function FollowButton({ name, tmAttractionId }: { name: string; tmAttractionId: string | null }) {
  const { t } = useI18n();
  useFollows();
  const on = follows.isFollowed(name);
  return (
    <button
      type="button"
      className={`icon-btn follow-btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={t(on ? 'follow.unfollowName' : 'follow.followName', { name })}
      onClick={() => follows.toggle(name, tmAttractionId)}
    >
      <Icon name="heart" filled={on} />
    </button>
  );
}

/**
 * "Followed" at the top of the list whenever a followed artist has an upcoming date (§4): the
 * region's events, then other Polish cities from Ticketmaster (with the city, a link out, never
 * on the map).
 */
export function FollowedGroup({
  matches,
  now,
  onOpen,
}: {
  matches: Matches;
  now: Date;
  onOpen: (m: FollowMatch) => void;
}) {
  const { t, lang } = useI18n();
  if (!matches.matches.length && !matches.nationwide.length) return null;
  return (
    <section className="followed" aria-labelledby="followed-title">
      <h2 id="followed-title" className="list-around__title">
        {t('follow.group')}
      </h2>
      <ul className="list">
        {matches.matches.map((m) => (
          <LiteRow
            key={m.id}
            ev={m}
            now={now}
            onOpen={() => onOpen(m)}
            note={
              <>
                <FollowStar />
                {m.matchedPerformer && m.matchedPerformer !== m.title && (
                  <span className="badge">{m.matchedPerformer}</span>
                )}
              </>
            }
          />
        ))}
        {matches.nationwide.map((d) => (
          <NationwideRow key={d.id} d={d} now={now} lang={lang} />
        ))}
      </ul>
    </section>
  );
}

function NationwideRow({ d, now, lang }: { d: NationwideDate; now: Date; lang: 'pl' | 'en' }) {
  const { t } = useI18n();
  const when = d.startAt
    ? `${formatRelativeDay(d.startAt, now, region.timezone, lang)}, ${formatTime(d.startAt, region.timezone, lang)}`
    : (d.localDate ?? '');
  const body = (
    <>
      <span className="cat-icon" aria-hidden style={{ width: 40, height: 40 }}>
        <Icon name="star" size={20} />
      </span>
      <span className="row__body">
        <span className="row__title">{d.title}</span>
        <span className="row__when">
          {when}
          {d.city && <span className="badge">{d.city}</span>}
        </span>
        <span className="row__meta">
          {[d.venueName, t('follow.elsewhere')].filter(Boolean).join(' · ')}
        </span>
      </span>
      {d.url && <Icon name="link" size={16} />}
    </>
  );
  return (
    <li>
      {d.url ? (
        <a className="row" href={d.url} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        <div className="row">{body}</div>
      )}
    </li>
  );
}

/**
 * The Followed screen (§4), reached from the list: type a name or paste a list (one per line),
 * remove, and on an account the alerts switch (§5, premium).
 */
export function FollowedScreen({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const list = useFollows();
  const [text, setText] = useState('');
  const [added, setAdded] = useState<number | null>(null);
  const names = parseNames(text);
  const add = () => {
    setAdded(follows.add(names.map((name) => ({ name }))));
    setText('');
  };
  return (
    <section className="followed-screen" aria-labelledby="followed-screen-title">
      <header className="followed-screen__head">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={onClose}>
          <Icon name="back" />
        </button>
        <h2 id="followed-screen-title">{t('follow.title')}</h2>
      </header>
      <p className="muted">{t('follow.intro')}</p>
      <label className="field">
        <span className="field__label">{t('follow.addLabel')}</span>
        <textarea
          rows={3}
          maxLength={6000}
          placeholder={t('follow.addHint')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAdded(null);
          }}
        />
      </label>
      <button type="button" className="btn btn--primary" disabled={!names.length} onClick={add}>
        {names.length > 1 ? t('follow.addMany', { count: names.length }) : t('follow.add')}
      </button>
      {added !== null && (
        <p className="muted" role="status">
          {t('follow.added', { count: added })}
        </p>
      )}
      <AlertsRow />
      {list.length === 0 ? (
        <p className="muted">{t('follow.empty')}</p>
      ) : (
        <ul className="followed-list" aria-label={t('follow.title')}>
          {list.map((f) => (
            <li key={f.norm}>
              <span>{f.name}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('follow.unfollowName', { name: f.name })}
                onClick={() => follows.remove(f.name)}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="footnote">{t('follow.privacy')}</p>
    </section>
  );
}

/** New-date alerts (§5): premium, signed in, by web push to the account's devices. */
function AlertsRow() {
  const { t, lang } = useI18n();
  const { status, entitlements } = useAccount();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = status === 'signedIn' && can(entitlements, 'alerts.newDates');
  useEffect(() => {
    if (!allowed) return;
    let stop = false;
    void (async () => {
      try {
        const r = await api<{ alerts: boolean }>('me/follows/alerts', {
          token: await accessToken(),
        });
        if (!stop) setOn(r.alerts);
      } catch {
        if (!stop) setOn(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [allowed]);
  if (status !== 'signedIn') return <p className="muted">{t('follow.alertsSignIn')}</p>;
  if (!can(entitlements, 'alerts.newDates'))
    return <p className="muted">{t('follow.alertsPremium')}</p>;
  const toggle = async () => {
    setError(null);
    setBusy(true);
    try {
      const next = !on;
      // Push first: alerts reach the account's devices that allowed notifications.
      if (next) await ensurePush(lang);
      await api('me/follows/alerts', {
        token: await accessToken(),
        method: 'PUT',
        body: { on: next },
      });
      setOn(next);
    } catch (err) {
      setError(err instanceof ApiError ? t('follow.alertsError') : t('follow.alertsPush'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="followed-alerts">
      <label className="check">
        <input type="checkbox" checked={!!on} disabled={busy || on === null} onChange={toggle} />
        <span>{t('follow.alerts')}</span>
      </label>
      <p className="footnote">{t('follow.alertsNote')}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
