import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventPost, NearbyEvent } from '@happow/core';
import { config } from '../config';
import { formatAgo, formatDay, formatTime } from '../format';
import { useI18n } from '../i18n';
import { loadPosts } from '../organiser';
import { updates, useUpdatesVersion } from '../updates';
import { Linkify } from './Linkify';

const { cardPosts } = config.app.organiser;

/** Newest first: the order updates are read in. */
export const newestFirst = (posts: readonly EventPost[]): EventPost[] =>
  [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

/**
 * An organiser's updates as a list: the kind, the text with its links tappable, a schedule
 * change's new time, and how long ago. `compact` is the map card's version (short texts).
 */
export function PostList({
  posts,
  ev,
  now,
  compact = false,
  actions,
}: {
  posts: readonly EventPost[];
  ev: Pick<NearbyEvent, 'timezone'>;
  now: Date;
  compact?: boolean;
  /** What stands after the time: delete for the organiser, report for everyone else. */
  actions?: (post: EventPost) => ReactNode;
}) {
  const { t, lang } = useI18n();
  if (!posts.length) return null;
  return (
    <ul className={`posts${compact ? ' posts--compact' : ''}`}>
      {posts.map((p) => (
        <li key={p.id} className={`post post--${p.kind}`}>
          <span className="post__kind">{t(`organiser.kind.${p.kind}`)}</span>
          <p className="post__body">
            <Linkify text={p.body} />
          </p>
          {p.change?.start_at && (
            <p className="post__change">
              {t('organiser.newStart', {
                time: `${formatDay(p.change.start_at, ev.timezone, lang)} ${formatTime(p.change.start_at, ev.timezone, lang)}`,
              })}
            </p>
          )}
          <span className="post__meta">
            {formatAgo(p.createdAt, now, lang, t('time.justNow'))}
            {actions?.(p)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * On the map's card, right after the pin is tapped: the newest few updates, and how many more
 * wait in Details. What the last look at the news brought shows at once; the card then reads the
 * event's posts itself. Showing them takes the red "!" off the pin.
 */
export function CardUpdates({
  ev,
  now,
  onDetails,
}: {
  ev: NearbyEvent;
  now: Date;
  onDetails: () => void;
}) {
  const { t } = useI18n();
  useUpdatesVersion();
  const [loaded, setLoaded] = useState<{ id: string; posts: EventPost[] } | null>(null);
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || cardPosts <= 0) return;
    let live = true;
    loadPosts(ev.id).then(
      (d) => live && setLoaded({ id: ev.id, posts: d.posts }),
      () => {
        /* offline: what the last look brought stays */
      },
    );
    return () => {
      live = false;
    };
  }, [ev.id]);

  const news = updates.newsOf(ev.id);
  const posts = newestFirst(loaded?.id === ev.id ? loaded.posts : (news?.posts ?? []));
  // Unread when this card opened: marking it seen must not take the line away under the eye.
  const opened = useRef<{ id: string; unread: boolean } | null>(null);
  if (opened.current?.id !== ev.id) opened.current = { id: ev.id, unread: updates.isUnread(ev.id) };
  const changedOnly = posts.length === 0 && opened.current.unread;
  // Seen once the updates are on screen (or the change they stand for is: the card's new time).
  const shown = loaded?.id === ev.id || posts.length > 0 || changedOnly;
  useEffect(() => {
    if (shown) updates.markSeen(ev.id);
  }, [ev.id, shown, news?.at]);

  if (cardPosts <= 0 || (!posts.length && !changedOnly)) return null;
  const rest = posts.length - cardPosts;
  return (
    <section className="card-updates" aria-label={t('updates.title')}>
      {changedOnly ? (
        <p className="card-updates__changed">{t('updates.changed')}</p>
      ) : (
        <PostList posts={posts.slice(0, cardPosts)} ev={ev} now={now} compact />
      )}
      {rest > 0 && (
        <button type="button" className="inline-link" onClick={onDetails}>
          {t('updates.more', { count: rest })}
        </button>
      )}
    </section>
  );
}
