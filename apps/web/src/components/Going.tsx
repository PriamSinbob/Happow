import { isRunning, type NearbyEvent } from '@happow/core';
import { useEffect, useState } from 'react';
import { track } from '../analytics';
import { lookAt, setAttendance, type AttendanceView, type Signal } from '../attendance';
import { config } from '../config';
import { useI18n } from '../i18n';
import { plans } from '../plans';
import { Icon } from './Icons';

const { lookingMinutes, hereRadiusM } = config.app.attendance;

/**
 * "I'm going" on the event card: one tap, again to undo, anonymous. The count shows only
 * from the threshold up and in buckets (the server decides), never "be the first". A sharer also
 * sees how many people who came through their link are going.
 *
 * Co-presence: opening the card says "looking" for a while; "here" is offered near a live
 * event. The line under the button shows here, on the way and looking, each only from the
 * threshold up and never for sensitive categories.
 */
export function Going({
  ev,
  now,
  answer = true,
}: {
  ev: NearbyEvent;
  now: Date;
  /** Off on a private event: the invitation's answer says who is going, by name. */
  answer?: boolean;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<AttendanceView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    lookAt(ev.id, lookingMinutes)
      .then((v) => {
        if (!live) return;
        setView(v);
        // Marked going earlier, or on this device without saving: it joins your plans once.
        if (v.mine?.going) plans.adoptGoing(ev.id);
      })
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
      // "I'm going" also saves the event.
      if (kind === 'going') plans.setGoing(ev.id, on);
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

  const offersHere = nearLive || here;
  if (!answer && !offersHere && !presence.length) return null;
  return (
    <div className="going">
      <div className="going__row">
        {answer && (
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
        )}
        {offersHere && (
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
        {answer && counts?.going != null && (
          <span className="going__count">{t('going.count', { count: counts.going })}</span>
        )}
      </div>
      {presence.length > 0 && <p className="going__links">{presence.join(' · ')}</p>}
      {answer && fromLinks ? (
        <p className="going__links">{t('going.fromLinks', { count: fromLinks })}</p>
      ) : null}
    </div>
  );
}
