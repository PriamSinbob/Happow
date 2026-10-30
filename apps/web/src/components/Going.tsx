import { isRunning, type NearbyEvent } from '@happow/core';
import { useEffect, useState } from 'react';
import { track } from '../analytics';
import { lookAt, setAttendance, type AttendanceView, type Signal } from '../attendance';
import { config } from '../config';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

const { lookingMinutes, hereRadiusM } = config.app.attendance;

/**
 * "I'm going" on the event card (M9 §5): one tap, again to undo, anonymous. The count shows only
 * from the threshold up and in buckets (the server decides), never "be the first". A sharer also
 * sees how many people who came through their link are going.
 *
 * Co-presence (§6): opening the card says "looking" for a while; "here" is offered near a live
 * event. The line under the button shows here, on the way and looking, each only from the
 * threshold up and never for sensitive categories.
 */
export function Going({ ev, now }: { ev: NearbyEvent; now: Date }) {
  const { t } = useI18n();
  const [view, setView] = useState<AttendanceView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    lookAt(ev.id, lookingMinutes)
      .then((v) => live && setView(v))
      .catch(() => {
        /* offline or not configured: the buttons still work when the server is back */
      });
    return () => {
      live = false;
    };
  }, [ev.id]);

  async function toggle(kind: Signal) {
    if (busy) return;
    const on = !(view?.mine?.[kind] ?? false);
    setBusy(true);
    try {
      setView(await setAttendance(ev.id, kind, on));
      track(kind === 'going' ? 'Going' : 'Here', { on: String(on) });
    } catch {
      /* stays as it was; the buttons show the real state */
    } finally {
      setBusy(false);
    }
  }

  // A reply without the expected fields (an old Worker, a proxy) must not break the card.
  const going = view?.mine?.going ?? false;
  const here = view?.mine?.here ?? false;
  const counts = view?.counts;
  const presence = (['here', 'onway', 'looking'] as const)
    .filter((k) => counts?.[k] != null)
    .map((k) => t(`presence.${k}`, { count: counts![k]! }));
  const nearLive = isRunning(ev, now) && ev.distanceM <= hereRadiusM;
  const fromLinks = view?.fromMyLinks;

  return (
    <div className="going">
      <div className="going__row">
        <button
          type="button"
          className="btn going__btn"
          aria-pressed={going}
          onClick={() => toggle('going')}
          disabled={busy}
        >
          <Icon name={going ? 'check' : 'plus'} size={16} />
          {going ? t('going.on') : t('going.off')}
        </button>
        {(nearLive || here) && (
          <button
            type="button"
            className="btn going__btn"
            aria-pressed={here}
            onClick={() => toggle('here')}
            disabled={busy}
          >
            <Icon name={here ? 'check' : 'pin'} size={16} />
            {here ? t('presence.imHereOn') : t('presence.imHere')}
          </button>
        )}
        {counts?.going != null && (
          <span className="going__count">{t('going.count', { count: counts.going })}</span>
        )}
      </div>
      {presence.length > 0 && <p className="going__links">{presence.join(' · ')}</p>}
      {fromLinks ? (
        <p className="going__links">{t('going.fromLinks', { count: fromLinks })}</p>
      ) : null}
    </div>
  );
}
