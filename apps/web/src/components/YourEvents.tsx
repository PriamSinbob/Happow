import { useEffect, useState } from 'react';
import { region } from '../config';
import { formatDay, formatTime } from '../format';
import { useI18n } from '../i18n';
import { loadMyClaims, loadMyEvents, type Claim, type MyEvent } from '../organiser';
import { Icon } from './Icons';

/**
 * "Your events" on the account card: the events you added, organise or created privately,
 * in one list, with what's waiting (guests, reports, edits under review); and your claims. Tapping
 * one opens its card, where editing, posts and guests live.
 */
export function YourEventsSection({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);

  useEffect(() => {
    let live = true;
    loadMyEvents().then(
      (e) => live && setEvents(e),
      () => live && setEvents(null),
    );
    loadMyClaims().then(
      (c) => live && setClaims(c),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const organised = events?.filter((e) => e.role === 'owner' || e.role === 'organiser') ?? [];
  const open = claims.filter((c) => c.status === 'pending');
  if (!organised.length && !open.length) return null;
  const meta = (e: MyEvent) =>
    [
      e.visibility === 'private' && e.guests
        ? t('yours.guests', { accepted: e.guests.accepted, pending: e.guests.pending })
        : null,
      e.reports ? t('yours.reports', { count: e.reports }) : null,
      e.status !== 'scheduled' ? t(`event.${e.status}` as 'event.cancelled') : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <section className="contrib" aria-labelledby="yours-title">
      <h3 id="yours-title" className="contrib__title">
        {t('yours.title')}
      </h3>
      {organised.length > 0 && (
        <ul className="my-events">
          {organised.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="my-events__row my-events__open"
                onClick={() => onOpenEvent(e.id)}
              >
                <span className="my-events__title">
                  {e.visibility === 'private' && <Icon name="lock" size={14} />} {e.title}
                </span>
                <span className="my-events__meta">
                  {formatDay(e.startAt, region.timezone, lang)}{' '}
                  {formatTime(e.startAt, region.timezone, lang)}
                  {meta(e) && ` · ${meta(e)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open.map((c) => (
        <p key={c.id} className="contrib__line">
          {t('yours.claimPending', { title: c.title ?? c.organiser_name })}
        </p>
      ))}
    </section>
  );
}
