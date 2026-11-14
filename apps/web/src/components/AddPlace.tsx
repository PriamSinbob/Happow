import { useState, type FormEvent } from 'react';
import {
  formatOpeningHours,
  openState,
  parseOpeningHours,
  PLACE_PHOTO_FIELDS,
  type LatLng,
  type PhotoMark,
  type PlacePhotoField,
} from '@happow/core';
import { useAccount } from '../account';
import { api } from '../api';
import { config, region } from '../config';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import { photoPoint, shrinkPhoto } from '../photo';
import { addPlace, changePlace, listedNear, readPlacePhoto, usePlaces } from '../places';
import { HoursEditor, newHoursRow, rowsToWeek, weekToRows, type HoursRow } from './HoursEditor';
import { Glyph, Icon } from './Icons';
import { PinMap } from './PinMap';
import { Screen } from './Screen';

const { kinds } = config.app.places;

/** The photo the form was filled from: shown with numbered marks where each field was read. */
interface Photo {
  /** The shrunk copy, as a data URL: the photo is never stored anywhere. */
  src: string;
  marks: Partial<Record<PlacePhotoField, PhotoMark>>;
  /** Where the pin came from. */
  from: 'photo' | 'phone' | null;
}

/**
 * Add a place: what it is, where, and when it is open. It is on the map at once, while it is
 * open; a place of the same name already at that spot gets the hours instead.
 * One photo of the door fills the form (name, kind, hours, address), with numbered marks tying
 * each field to where it was read. Without an account the photo is the only way in: its read
 * gives the pass that stands in for the account. A place already listed at the spot turns
 * "add" into "update hours".
 */
export function AddPlace({
  onClose,
  onShow,
  here = null,
}: {
  onClose: () => void;
  /** Back to the map, on the new place. */
  onShow: (id: string, point: LatLng) => void;
  /** The phone's precise position, for a photo that carries none. */
  here?: LatLng | null;
}) {
  const { t, lang } = useI18n();
  const signedIn = useAccount().status === 'signedIn';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [geo, setGeo] = useState<'idle' | 'loading' | 'notFound'>('idle');
  const [rows, setRows] = useState<HoursRow[]>([newHoursRow()]);
  const [website, setWebsite] = useState('');
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    id: string;
    at: LatLng;
    openNow: boolean;
    updated: boolean;
  } | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [reading, setReading] = useState<
    { state: 'idle' | 'loading' | 'none' } | { state: 'error'; message: string }
  >({ state: 'idle' });
  /** "This is another place": add it even though one is listed at the spot. */
  const [another, setAnother] = useState(false);

  const around = usePlaces(point ?? region.center, point !== null);
  const listed =
    point && !another && (name.trim() || kind) ? listedNear(around, point, name, kind) : null;

  const week = rowsToWeek(rows);
  const missing = {
    name: !listed && name.trim().length < 2,
    kind: !listed && kind === null,
    point: point === null,
    hours: week === null,
  };
  const required = (key: keyof typeof missing) =>
    tried && missing[key] && <span className="field__error">{t('add.required')}</span>;
  // Marks are numbered in the form's order, only for the fields the photo filled.
  const numbers = new Map(
    PLACE_PHOTO_FIELDS.filter((f) => photo?.marks[f]).map((f, i) => [f, i + 1] as const),
  );
  const num = (field: PlacePhotoField) => {
    const n = numbers.get(field);
    return n ? (
      <span className="photo-mark" aria-hidden>
        {n}
      </span>
    ) : null;
  };

  async function locate() {
    const q = (address || name).trim();
    if (q.length < 3) return;
    setGeo('loading');
    try {
      const res = await api<{ result: { point: LatLng } | null }>('geocode', {
        body: { q, regionId: region.id },
      });
      if (res.result) setPoint(res.result.point);
      setGeo(res.result ? 'idle' : 'notFound');
    } catch {
      setGeo('notFound');
    }
  }

  /** Reads the photo into the form; the spot from the photo, else the phone, else a pin. */
  async function fromPhoto(file: File) {
    setReading({ state: 'loading' });
    setError(null);
    const [at, shrunk] = await Promise.all([photoPoint(file), shrinkPhoto(file).catch(() => null)]);
    if (!shrunk) {
      setReading({ state: 'error', message: t('add.photo.unreadable') });
      return;
    }
    try {
      const res = await readPlacePhoto(shrunk);
      if (!res.place) {
        setReading({ state: 'none' });
        return;
      }
      const p = res.place;
      setPass(res.pass);
      if (p.name) setName(p.name);
      if (p.kind && kinds.some((k) => k.tag === p.kind)) setKind(p.kind);
      const read = parseOpeningHours(p.openingHours);
      if (read) setRows(weekToRows(read));
      if (p.address) setAddress(p.address);
      if (p.website) setWebsite(p.website);
      const spot = at ?? here;
      if (spot) setPoint(spot);
      setGeo('idle');
      setAnother(false);
      setPhoto({
        src: `data:${shrunk.mediaType};base64,${shrunk.data}`,
        marks: p.marks,
        from: at ? 'photo' : here ? 'phone' : null,
      });
      setReading({ state: 'idle' });
    } catch (err) {
      setReading({ state: 'error', message: errorText(t, err, lang) });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (sending || Object.values(missing).some(Boolean) || !week || !point) return;
    setSending(true);
    setError(null);
    const openingHours = formatOpeningHours(week);
    try {
      let id: string;
      let at = point;
      if (listed) {
        await changePlace(listed.id, { openingHours }, pass);
        id = listed.id;
        at = listed.point;
      } else {
        if (!kind) return;
        id = await addPlace(
          {
            name: name.trim(),
            kind,
            point,
            openingHours,
            address: address.trim(),
            website: website.trim(),
          },
          pass,
        );
      }
      // The pass is good for one place.
      setPass(null);
      setDone({
        id,
        at,
        openNow: openState(week, new Date(), region.timezone).open,
        updated: listed !== null,
      });
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setSending(false);
    }
  }

  const photoButton = (
    <label
      className={`btn btn--block autofill__photo${reading.state === 'loading' ? ' is-disabled' : ''}${!signedIn && !photo ? ' btn--primary' : ''}`}
    >
      <input
        type="file"
        accept="image/*"
        className="visually-hidden"
        disabled={reading.state === 'loading'}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // The same photo can be picked again after a failure.
          e.target.value = '';
          if (file) void fromPhoto(file);
        }}
      />
      <Icon name="camera" size={18} />
      {reading.state === 'loading'
        ? t('addPlace.photo.reading')
        : photo
          ? t('addPlace.photo.again')
          : t('addPlace.photo')}
    </label>
  );
  const readingNote =
    reading.state === 'none' ? (
      <p className="field__hint is-warn" role="status">
        {t('addPlace.photo.notFound')}
      </p>
    ) : reading.state === 'error' ? (
      <p className="form-error" role="alert">
        {reading.message}
      </p>
    ) : null;

  if (done)
    return (
      <Screen title={t('addPlace.title')} onClose={onClose}>
        <div className="done">
          <span className="done__icon" aria-hidden>
            <Icon name="check" size={32} />
          </span>
          <p role="status">
            {t(
              done.updated
                ? 'addPlace.doneUpdated'
                : done.openNow
                  ? 'addPlace.done'
                  : 'addPlace.doneClosed',
            )}
          </p>
          <div className="event-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onShow(done.id, done.at)}
            >
              <Icon name="map" size={16} /> {t('addPlace.show')}
            </button>
          </div>
        </div>
      </Screen>
    );

  // Without an account a place comes only from a photo of its door.
  if (!signedIn && !pass)
    return (
      <Screen title={t('addPlace.title')} onClose={onClose}>
        <div className="add-form">
          <p className="field__hint">{t('addPlace.photo.lead')}</p>
          {photoButton}
          {readingNote}
        </div>
      </Screen>
    );

  return (
    <Screen title={t('addPlace.title')} onClose={onClose}>
      <form className="add-form" onSubmit={submit} noValidate>
        {photo && (
          <figure className="place-photo">
            <span className="place-photo__frame">
              <img src={photo.src} alt={t('addPlace.photo.alt')} />
              {[...numbers].map(([field, n]) => {
                const m = photo.marks[field]!;
                return (
                  <span
                    key={field}
                    className="place-photo__box"
                    style={{
                      left: `${m.x * 100}%`,
                      top: `${m.y * 100}%`,
                      width: `${m.w * 100}%`,
                      height: `${m.h * 100}%`,
                    }}
                  >
                    <span className="photo-mark" aria-hidden>
                      {n}
                    </span>
                  </span>
                );
              })}
              {photo.from && (
                <span className="place-photo__from">
                  <Icon name="locate" size={13} />
                  {t(photo.from === 'photo' ? 'addPlace.fromPhoto' : 'addPlace.fromPhone')}
                </span>
              )}
            </span>
          </figure>
        )}
        {photoButton}
        {readingNote}

        {listed && (
          <div className="notice" role="status">
            <p>{t('addPlace.listed', { name: listed.name })}</p>
            <button type="button" className="inline-link" onClick={() => setAnother(true)}>
              {t('addPlace.another')}
            </button>
          </div>
        )}

        <label className="field">
          <span className="field__label">
            {num('name')}
            {t('addPlace.name')} {required('name')}
          </span>
          <input
            value={name}
            maxLength={140}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={tried && missing.name}
          />
        </label>

        <fieldset className="field">
          <legend className="field__label">
            {num('kind')}
            {t('addPlace.kind')} {required('kind')}
          </legend>
          <div className="cat-grid" role="radiogroup">
            {kinds.map((k) => (
              <button
                key={k.tag}
                type="button"
                role="radio"
                aria-checked={kind === k.tag}
                className={`cat-chip${kind === k.tag ? ' is-on' : ''}`}
                onClick={() => setKind(k.tag)}
              >
                <span className="cat-chip__icon" aria-hidden>
                  <Glyph id={k.glyph} size={18} />
                </span>
                {k.labels[lang]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">
            {num('hours')}
            {t('addPlace.hours')} {required('hours')}
          </legend>
          <HoursEditor rows={rows} onChange={setRows} />
          <span className="field__hint">{t('addPlace.hoursHint')}</span>
        </fieldset>

        <label className="field">
          <span className="field__label">
            {num('address')}
            {t('add.field.address')}
          </span>
          <span className="field__row">
            <input
              value={address}
              maxLength={200}
              autoComplete="street-address"
              onChange={(e) => setAddress(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--inline"
              disabled={geo === 'loading' || (address || name).trim().length < 3}
              onClick={locate}
            >
              <Icon name="search" size={16} />
              {t('add.findOnMap')}
            </button>
          </span>
        </label>
        <div className="field">
          <span className="field__label">{required('point')}</span>
          <PinMap
            point={point}
            onChange={(p) => {
              setPoint(p);
              setGeo('idle');
            }}
            label={t('add.pinHint')}
          />
          <span
            className={`field__hint${geo === 'notFound' || (photo && !point) ? ' is-warn' : ''}`}
          >
            {geo === 'notFound'
              ? t('add.notOnMap')
              : photo && !point
                ? t('addPlace.dropPin')
                : t('add.pinHint')}
          </span>
        </div>

        <label className="field">
          <span className="field__label">
            {num('website')}
            {t('addPlace.website')}
          </span>
          <input
            value={website}
            maxLength={500}
            inputMode="url"
            autoCapitalize="none"
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="add-form__foot">
          <button type="submit" className="btn btn--primary btn--block" disabled={sending}>
            {t(listed ? 'addPlace.update' : 'addPlace.submit')}
          </button>
        </div>
      </form>
    </Screen>
  );
}
