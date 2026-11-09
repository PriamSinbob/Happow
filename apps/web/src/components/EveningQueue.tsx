import { useState } from 'react';
import { eveningQueue, stepLeave, type LegVerdict, type NearbyEvent } from '@happow/core';
import { config, region } from '../config';
import { formatTime, navigationUrl } from '../format';
import { useI18n } from '../i18n';
import { storage } from '../storage';
import { CategoryIcon } from './EventMeta';
import { Icon } from './Icons';
import { Screen } from './Screen';

const { agenda } = config.app;
const KEY = 'leaveAt';

/** "Leave at" times chosen on this device, by event id. */
function loadLeave(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(storage.get(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * The evening queue: one day's events in start order, the walk between each pair
 * (rounded) and how it works out. Each event can be left earlier; nothing is
 * moved or dropped for you.
 */
export function EveningQueue({
  day,
  events,
  onOpen,
  onClose,
}: {
  /** The day's label ("Today", "Sat 7.11"). */
  day: string;
  events: NearbyEvent[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [leave, setLeave] = useState(loadLeave);
  const { stops, legs } = eveningQueue(events, leave, config.categories, config.app);
  const time = (iso: string) => formatTime(iso, region.timezone, lang);

  const choose = (id: string, at: string | null) => {
    // Times more than a month old are dropped as new ones are chosen.
    const after = Date.now() - agenda.keepPastDays * 86_400_000;
    const next = Object.fromEntries(
      Object.entries(leave).filter(([k, v]) => k !== id && Date.parse(v) > after),
    );
    if (at) next[id] = at;
    setLeave(next);
    storage.set(KEY, JSON.stringify(next));
  };

  const verdict = (v: LegVerdict) => {
    switch (v.kind) {
      case 'fine':
        return v.spareMin > 0 ? t('queue.fine', { minutes: v.spareMin }) : t('queue.justInTime');
      case 'openUntil':
        return t('queue.openUntil', { time: time(v.until) });
      case 'overlap':
        return t('queue.overlap', { minutes: v.min });
      case 'late':
        return t('queue.late', { minutes: v.min });
      case 'leaveEarly':
        return t('queue.leaveEarly', { time: time(v.by) });
      case 'closed':
        return t('queue.closed');
    }
  };
  const warn = (v: LegVerdict) => v.kind === 'overlap' || v.kind === 'late' || v.kind === 'closed';

  return (
    <Screen title={t('queue.title', { day })} onClose={onClose}>
      <p className="queue__note">{t('queue.note')}</p>
      <ol className="queue">
        {stops.map((s, i) => {
          const leg = legs[i];
          const end = s.event.endAt;
          const earlier = stepLeave(s.event, s.leaveAt, -1, agenda.leaveStepMin);
          const later = stepLeave(s.event, s.leaveAt, 1, agenda.leaveStepMin);
          const next = stops[i + 1]?.event;
          return (
            <li key={s.event.id} className="queue__item">
              <button type="button" className="queue__event" onClick={() => onOpen(s.event.id)}>
                <CategoryIcon ev={s.event} />
                <span className="queue__body">
                  <span className="row__title">{s.event.title}</span>
                  <span className="row__meta">
                    {time(s.event.startAt)}–{time(end)} · {s.event.venue?.name}
                  </span>
                </span>
              </button>
              {leg && (
                <div className="queue__leave">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('queue.earlier', { minutes: agenda.leaveStepMin })}
                    disabled={earlier === s.leaveAt}
                    onClick={() => choose(s.event.id, earlier)}
                  >
                    −
                  </button>
                  <span className={s.early ? 'queue__time is-early' : 'queue__time'}>
                    {t('queue.leave', { time: time(s.leaveAt) })}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('queue.later', { minutes: agenda.leaveStepMin })}
                    disabled={later === s.leaveAt}
                    onClick={() => choose(s.event.id, later === end ? null : later)}
                  >
                    +
                  </button>
                </div>
              )}
              {leg && next && (
                <div className={`queue__leg${warn(leg.verdict) ? ' is-warning' : ''}`}>
                  <Icon name="walk" size={16} />
                  <span>
                    {leg.walkMin === 0
                      ? t('queue.samePlace')
                      : t('queue.walk', { minutes: leg.walkMin })}
                    {leg.long && ` · ${t('queue.long')}`}
                  </span>
                  <strong role={warn(leg.verdict) ? 'alert' : undefined}>
                    {warn(leg.verdict) && '⚠ '}
                    {verdict(leg.verdict)}
                  </strong>
                  {leg.long && (
                    <a
                      className="queue__transit"
                      href={navigationUrl(next.point.lat, next.point.lng).replace(
                        'travelmode=walking',
                        'travelmode=transit',
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('queue.transit')}
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Screen>
  );
}
