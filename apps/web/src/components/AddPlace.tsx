import { useState, type FormEvent } from 'react';
import { formatOpeningHours, openState, type LatLng } from '@happow/core';
import { api } from '../api';
import { config, region } from '../config';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import { addPlace } from '../places';
import { HoursEditor, newHoursRow, rowsToWeek, type HoursRow } from './HoursEditor';
import { Glyph, Icon } from './Icons';
import { PinMap } from './PinMap';
import { Screen } from './Screen';

const { kinds } = config.app.places;

/**
 * Add a place: what it is, where, and when it is open. It is on the map at once, while it is
 * open; a place of the same name already at that spot gets the hours instead.
 */
export function AddPlace({
  onClose,
  onShow,
}: {
  onClose: () => void;
  /** Back to the map, on the new place. */
  onShow: (id: string, point: LatLng) => void;
}) {
  const { t, lang } = useI18n();
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
  const [done, setDone] = useState<{ id: string; openNow: boolean } | null>(null);

  const week = rowsToWeek(rows);
  const missing = {
    name: name.trim().length < 2,
    kind: kind === null,
    point: point === null,
    hours: week === null,
  };
  const required = (key: keyof typeof missing) =>
    tried && missing[key] && <span className="field__error">{t('add.required')}</span>;

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (sending || Object.values(missing).some(Boolean) || !week || !point || !kind) return;
    setSending(true);
    setError(null);
    try {
      const id = await addPlace({
        name: name.trim(),
        kind,
        point,
        openingHours: formatOpeningHours(week),
        address: address.trim(),
        website: website.trim(),
      });
      setDone({ id, openNow: openState(week, new Date(), region.timezone).open });
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setSending(false);
    }
  }

  if (done)
    return (
      <Screen title={t('addPlace.title')} onClose={onClose}>
        <div className="done">
          <span className="done__icon" aria-hidden>
            <Icon name="check" size={32} />
          </span>
          <p role="status">{t(done.openNow ? 'addPlace.done' : 'addPlace.doneClosed')}</p>
          <div className="event-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => (point ? onShow(done.id, point) : onClose())}
            >
              <Icon name="map" size={16} /> {t('addPlace.show')}
            </button>
          </div>
        </div>
      </Screen>
    );

  return (
    <Screen title={t('addPlace.title')} onClose={onClose}>
      <form className="add-form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field__label">
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
            {t('addPlace.hours')} {required('hours')}
          </legend>
          <HoursEditor rows={rows} onChange={setRows} />
          <span className="field__hint">{t('addPlace.hoursHint')}</span>
        </fieldset>

        <label className="field">
          <span className="field__label">{t('add.field.address')}</span>
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
          <span className={`field__hint${geo === 'notFound' ? ' is-warn' : ''}`}>
            {geo === 'notFound' ? t('add.notOnMap') : t('add.pinHint')}
          </span>
        </div>

        <label className="field">
          <span className="field__label">{t('addPlace.website')}</span>
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
            {t('addPlace.submit')}
          </button>
        </div>
      </form>
    </Screen>
  );
}
