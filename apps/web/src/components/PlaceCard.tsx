import type { NearbyEvent } from '@happow/core';
import { useI18n } from '../i18n';
import { Icon } from './Icons';
import { Row } from './ListView';

/**
 * One place with several events (cinema screenings, a festival's stages): the pin opens this list
 * instead of drawing a pin per event, sorted by start time.
 */
export function PlaceCard({
  events,
  now,
  onSelect,
  onClose,
}: {
  events: NearbyEvent[];
  now: Date;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const venue = sorted[0]?.venue?.name;
  return (
    <article className="event-card place-card" aria-labelledby="place-title">
      <header className="event-card__head">
        <div className="event-card__titles">
          <div className="event-card__cats">{t('place.title', { count: sorted.length })}</div>
          {venue && <h2 id="place-title">{venue}</h2>}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('event.close')}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <ul className="list">
        {sorted.map((ev) => (
          <Row key={ev.id} ev={ev} now={now} onSelect={onSelect} />
        ))}
      </ul>
    </article>
  );
}
