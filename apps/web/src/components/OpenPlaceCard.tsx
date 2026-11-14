import { walkingMinutes } from '@happow/core';
import { config } from '../config';
import { formatDistance, formatTime, navigationUrl } from '../format';
import { useI18n } from '../i18n';
import type { OpenPlace } from '../places';
import type { UnknownSpot } from './MapView';
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
 * "Private party · until 23:00": said wherever the place shows (its own card, and the card of an
 * event held there), so nobody walks to a closed door. `named` adds the place's name.
 */
export function PartyNotice({
  place,
  timeZone,
  named = false,
}: {
  place: Pick<OpenPlace, 'name' | 'closesAt'>;
  timeZone: string;
  named?: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <p className="party-notice" role="status">
      <Icon name="lock" size={18} />
      <span>
        <strong>{t('place.private')}</strong>
        {place.closesAt &&
          ` · ${t('place.until', { time: formatTime(place.closesAt.toISOString(), timeZone, lang) })}`}
        <span className="party-notice__hint">
          {named ? t('place.privateAt', { name: place.name }) : t('place.privateHint')}
        </span>
      </span>
    </p>
  );
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
  onPrivateEvent,
}: {
  place: OpenPlace;
  /** A private event of your own at this place: the add form, filled in with it. */
  onPrivateEvent?: () => void;
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
      {place.privateParty ? (
        <PartyNotice place={place} timeZone={timeZone} />
      ) : (
        <p className="event-card__when">
          <span className="open-pill">{t('place.open')}</span>
          {place.closesAt === null || left === null ? (
            t('place.allDay')
          ) : (
            <>
              {t('place.until', { time: formatTime(place.closesAt.toISOString(), timeZone, lang) })}
              <span
                className={`open-place__left${left <= places.closingSoonMin ? ' is-soon' : ''}`}
              >
                {t('place.left', { time: duration(left) })}
              </span>
            </>
          )}
        </p>
      )}
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
        {onPrivateEvent && (
          <button type="button" className="btn" onClick={onPrivateEvent}>
            <Icon name="lock" size={16} /> {t('place.privateEvent')}
          </button>
        )}
        <button type="button" className="btn" onClick={onEdit}>
          <Icon name="pencil" size={16} /> {t('place.edit')}
        </button>
      </div>
    </article>
  );
}

/**
 * A place whose opening hours are unknown (a hollow pin, close in): what it is, that its hours
 * are unknown, the way there, and adding the hours (from a photo of the door without an account).
 */
export function UnknownPlaceCard({
  place,
  onClose,
  onAddHours,
}: {
  place: UnknownSpot;
  onClose: () => void;
  onAddHours: () => void;
}) {
  const { t, lang } = useI18n();
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
      <p className="event-card__when">{t('place.hoursUnknown')}</p>
      {place.address && <p className="event-card__venue">{place.address}</p>}
      <p className="event-card__distance">
        {formatDistance(place.distanceM, lang)} · {t('event.walk', { minutes: walk })}
      </p>
      <div className="event-card__actions">
        <button type="button" className="btn btn--primary" onClick={onAddHours}>
          <Icon name="camera" size={16} /> {t('place.addHours')}
        </button>
        <a
          className="btn"
          href={navigationUrl(place.point.lat, place.point.lng)}
          target="_blank"
          rel="noreferrer"
          onClick={() => track('Directions', { via: 'google' })}
        >
          <Icon name="navigate" size={16} /> {t('nav.googleMaps')}
        </a>
      </div>
    </article>
  );
}
