import { walkingMinutes } from '@happow/core';
import { config } from '../config';
import { formatDistance, formatTime, navigationUrl } from '../format';
import { useI18n } from '../i18n';
import type { OpenPlace } from '../places';
import { track } from '../analytics';
import { Glyph, Icon } from './Icons';

const { walkingSpeedMPerMin, places } = config.app;

/** "2 h 10 min" / "45 min": numerals and units, the same in every language. */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/**
 * A place that is open now, with no event on: what it is, until when it is open and how long
 * that leaves, and the way there; or that a private party is on. An event at the place shows the
 * event's card instead.
 */
export function OpenPlaceCard({
  place,
  now,
  timeZone,
  onClose,
  onEdit,
}: {
  place: OpenPlace;
  /** The time looked at: now, or the time picked on the line. */
  now: Date;
  timeZone: string;
  onClose: () => void;
  /** Correct the place: hours, a private party, closed for good. */
  onEdit: () => void;
}) {
  const { t, lang } = useI18n();
  const left = place.closesAt
    ? Math.max(0, Math.round((place.closesAt.getTime() - now.getTime()) / 60_000))
    : null;
  const walk = walkingMinutes(place.distanceM, walkingSpeedMPerMin);
  return (
    <article className="event-card open-place" aria-labelledby={`place-${place.id}`}>
      <header className="event-card__head">
        <span className="cat-icon" style={{ width: 44, height: 44 }} aria-hidden>
          <Glyph id={place.kind.glyph} size={24} />
        </span>
        <div className="event-card__titles">
          <div className="event-card__cats">{place.kind.labels[lang]}</div>
          <h2 id={`place-${place.id}`}>{place.name}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('event.close')}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className="event-card__when">
        <span className={`open-pill${place.privateParty ? ' is-private' : ''}`}>
          {t(place.privateParty ? 'place.private' : 'place.open')}
        </span>
        {place.privateParty && place.closesAt ? (
          t('place.until', { time: formatTime(place.closesAt.toISOString(), timeZone, lang) })
        ) : place.closesAt === null || left === null ? (
          t('place.allDay')
        ) : (
          <>
            {t('place.until', { time: formatTime(place.closesAt.toISOString(), timeZone, lang) })}
            <span className={`open-place__left${left <= places.closingSoonMin ? ' is-soon' : ''}`}>
              {t('place.left', { time: duration(left) })}
            </span>
          </>
        )}
      </p>
      {place.address && <p className="event-card__venue">{place.address}</p>}
      <p className="event-card__distance">
        {formatDistance(place.distanceM, lang)} · {t('event.walk', { minutes: walk })}
      </p>
      <div className="event-card__actions">
        <a
          className="btn btn--primary"
          href={navigationUrl(place.point.lat, place.point.lng)}
          target="_blank"
          rel="noreferrer"
          onClick={() => track('Directions', { via: 'google' })}
        >
          <Icon name="navigate" size={16} /> {t('nav.googleMaps')}
        </a>
        {place.website && (
          <a className="btn" href={place.website} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={16} /> {t('place.website')}
          </a>
        )}
        <button type="button" className="btn" onClick={onEdit}>
          <Icon name="pencil" size={16} /> {t('place.edit')}
        </button>
      </div>
    </article>
  );
}
