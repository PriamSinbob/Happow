import type { NearbyEvent } from '@happow/core';
import { useEffect, useState } from 'react';
import { track } from '../analytics';
import { getAttendance, setAttendance, type AttendanceView } from '../attendance';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

/**
 * "I'm going" on the event card (M9 §5): one tap, again to undo, anonymous. The count shows only
 * from the threshold up and in buckets (the server decides), never "be the first". A sharer also
 * sees how many people who came through their link are going.
 */
export function Going({ ev }: { ev: NearbyEvent }) {
  const { t } = useI18n();
  const [view, setView] = useState<AttendanceView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getAttendance(ev.id)
      .then((v) => live && setView(v))
      .catch(() => {
        /* offline or not configured: the button still works when the server is back */
      });
    return () => {
      live = false;
    };
  }, [ev.id]);

  // A reply without the expected fields (an old Worker, a proxy) must not break the card.
  const going = view?.mine?.going ?? false;
  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await setAttendance(ev.id, 'going', !going);
      setView(next);
      track('Going', { on: String(!going) });
    } catch {
      /* stays as it was; the button shows the real state */
    } finally {
      setBusy(false);
    }
  }

  const count = view?.counts?.going;
  const fromLinks = view?.fromMyLinks;
  return (
    <div className="going">
      <div className="going__row">
        <button
          type="button"
          className="btn going__btn"
          aria-pressed={going}
          onClick={toggle}
          disabled={busy}
        >
          <Icon name={going ? 'check' : 'plus'} size={16} />
          {going ? t('going.on') : t('going.off')}
        </button>
        {count != null && <span className="going__count">{t('going.count', { count })}</span>}
      </div>
      {fromLinks ? (
        <p className="going__links">{t('going.fromLinks', { count: fromLinks })}</p>
      ) : null}
    </div>
  );
}
