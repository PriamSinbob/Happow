import { useState } from 'react';
import { entryOf, type EntryType, type Language, type LatLng } from '@happow/core';
import { track } from '../analytics';
import { api, deviceId } from '../api';
import { config, region } from '../config';
import { errorText } from '../errors';
import { formatDay, formatTime } from '../format';
import { useI18n } from '../i18n';
import { Glyph, Icon } from './Icons';
import { PinMap } from './PinMap';
import { Screen } from './Screen';

/** What /api/autofill returns per event found on the page (mirrors packages/api `Prefill`). */
interface Prefill {
  title: string;
  categoryIds: string[];
  start: string | null;
  end: string | null;
  venueName: string | null;
  address: string | null;
  point: LatLng | null;
  isFree: boolean | null;
  priceMin: number | null;
  currency: string | null;
  url: string;
  ticketUrl: string | null;
  ageMin: number | null;
  family: boolean | null;
  entry: EntryType | null;
}

interface Form {
  title: string;
  categoryIds: string[];
  start: string;
  end: string;
  venueName: string;
  address: string;
  point: LatLng | null;
  isFree: boolean | null;
  amount: string;
  currency: string;
  url: string;
  description: string;
  /** Youngest age let in; null = not stated. */
  ageMin: number | null;
  family: boolean;
  /** Null until the user picks one: the category default applies. */
  entry: EntryType | null;
  terms: boolean;
}

const EMPTY: Form = {
  title: '',
  categoryIds: [],
  start: '',
  end: '',
  venueName: '',
  address: '',
  point: null,
  isFree: null,
  amount: '',
  currency: region.currency,
  url: '',
  description: '',
  ageMin: null,
  family: false,
  entry: null,
  terms: false,
};

const MAX_CATEGORIES = 3;
/** Age choices: not stated, all ages, 12+, 16+, 18+. */
const AGE_CHOICES = [null, 0, 12, 16, 18] as const;
const ENTRY_TYPES: EntryType[] = ['fixed', 'open'];
const { submissions } = config.app;

type Autofill =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'found'; events: Prefill[] };

type Done = { status: 'published' | 'pending'; eventId: string | null };

function missing(f: Form): Set<keyof Form> {
  const m = new Set<keyof Form>();
  if (f.title.trim().length < 3) m.add('title');
  if (!f.categoryIds.length) m.add('categoryIds');
  if (!f.start) m.add('start');
  if (f.end && f.start && f.end <= f.start) m.add('end');
  if (f.venueName.trim().length < 2) m.add('venueName');
  if (!f.point) m.add('point');
  if (f.isFree === null) m.add('isFree');
  if (f.isFree === false && f.amount && !(Number(f.amount.replace(',', '.')) >= 0)) m.add('amount');
  if (!f.terms) m.add('terms');
  return m;
}

/** A form's wall-clock value ("2026-10-20T19:30") as "Tue 20 Oct · 19:30", whatever the device zone. */
function localLabel(value: string, lang: Language): string {
  const iso = `${value}:00Z`;
  return `${formatDay(iso, 'UTC', lang)} · ${formatTime(iso, 'UTC', lang)}`;
}

/** "Add an event": paste a link to prefill, check the fields, place the pin, submit. */
export function AddEvent({
  onClose,
  onOpenEvent,
}: {
  onClose: () => void;
  onOpenEvent: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const [link, setLink] = useState('');
  const [autofill, setAutofill] = useState<Autofill>({ state: 'idle' });
  const [form, setForm] = useState<Form>(EMPTY);
  const [chosen, setChosen] = useState<number | null>(null);
  const [geo, setGeo] = useState<'idle' | 'loading' | 'notFound'>('idle');
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const invalid = tried ? missing(form) : new Set<keyof Form>();
  const required = (key: keyof Form) =>
    invalid.has(key) && <span className="field__error">{t('add.required')}</span>;
  const defaultEntry = entryOf(
    { categoryIds: form.categoryIds, entry: null, graceMin: null },
    config.categories,
  ).entry;
  // A prefilled page may give an age the choices lack (6+); offer it too.
  const ageChoices: (number | null)[] =
    form.ageMin !== null && !(AGE_CHOICES as readonly (number | null)[]).includes(form.ageMin)
      ? [...AGE_CHOICES, form.ageMin].sort((a, b) => (a ?? -1) - (b ?? -1))
      : [...AGE_CHOICES];

  async function fill(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setAutofill({ state: 'loading' });
    try {
      const res = await api<{ events: Prefill[] }>('autofill', {
        body: { url: link.trim(), regionId: region.id },
      });
      setAutofill({ state: 'found', events: res.events });
      if (res.events.length === 1) apply(res.events[0]!, 0);
      if (!res.events.length) set('url', link.trim());
    } catch (err) {
      setAutofill({ state: 'error', message: errorText(t, err, lang) });
    }
  }

  function apply(p: Prefill, index: number) {
    setChosen(index);
    setGeo('idle');
    setForm((f) => ({
      ...f,
      title: p.title,
      categoryIds: p.categoryIds.slice(0, MAX_CATEGORIES),
      start: p.start ?? '',
      end: p.end ?? '',
      venueName: p.venueName ?? '',
      address: p.address ?? '',
      point: p.point,
      isFree: p.isFree,
      amount: p.priceMin !== null && !p.isFree ? String(p.priceMin) : '',
      currency: p.currency ?? region.currency,
      url: p.url,
      ageMin: p.ageMin,
      family: p.family === true,
      entry: p.entry,
    }));
    if (!p.point && (p.address || p.venueName)) void locate(p.address || p.venueName!);
  }

  async function locate(q: string) {
    if (q.trim().length < 3) return;
    setGeo('loading');
    try {
      const res = await api<{ result: { point: LatLng } | null }>('geocode', {
        body: { q: q.trim(), regionId: region.id },
      });
      if (res.result) {
        set('point', res.result.point);
        setGeo('idle');
      } else setGeo('notFound');
    } catch {
      setGeo('notFound');
    }
  }

  function toggleCategory(id: string) {
    setForm((f) => {
      const on = f.categoryIds.includes(id);
      if (!on && f.categoryIds.length >= MAX_CATEGORIES) return f;
      return {
        ...f,
        categoryIds: on ? f.categoryIds.filter((c) => c !== id) : [...f.categoryIds, id],
      };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (missing(form).size || sending) return;
    setSending(true);
    setError(null);
    const amount = form.amount ? Number(form.amount.replace(',', '.')) : null;
    // Only a choice that differs from the category default is stored on the event.
    const entry = form.entry && form.entry !== defaultEntry ? form.entry : null;
    try {
      const res = await api<Done>('submissions', {
        body: {
          deviceId: deviceId(),
          regionId: region.id,
          event: {
            title: form.title.trim(),
            categoryIds: form.categoryIds,
            venueName: form.venueName.trim(),
            address: form.address.trim(),
            point: form.point,
            start: form.start,
            end: form.end || null,
            isFree: form.isFree,
            priceMin: form.isFree ? null : amount,
            currency: form.isFree ? null : form.currency,
            url: form.url.trim() || null,
            description: form.description.trim() || null,
            ageMin: form.ageMin,
            family: form.family || null,
            entry,
          },
        },
      });
      setDone(res);
      track('Event added');
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <Screen title={t('add.title')} onClose={onClose}>
        <div className="done">
          <span className="done__icon" aria-hidden>
            <Icon name="check" size={32} />
          </span>
          <p role="status">
            {done.status === 'published' ? t('add.done.published') : t('add.done.pending')}
          </p>
          <div className="event-card__actions">
            {done.eventId && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onOpenEvent(done.eventId!)}
              >
                {t('add.view')}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDone(null);
                setForm(EMPTY);
                setLink('');
                setAutofill({ state: 'idle' });
                setChosen(null);
                setTried(false);
              }}
            >
              {t('add.another')}
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  const found = autofill.state === 'found' ? autofill.events : [];

  return (
    <Screen title={t('add.title')} onClose={onClose}>
      {submissions.autofill && (
        <>
          <form className="autofill" onSubmit={fill}>
            <label className="field">
              <span className="field__label">{t('add.linkLabel')}</span>
              <span className="field__row">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn--primary btn--inline"
                  disabled={!link.trim() || autofill.state === 'loading'}
                >
                  <Icon name="link" size={16} />
                  {autofill.state === 'loading' ? t('add.filling') : t('add.fill')}
                </button>
              </span>
              <span className="field__hint">{t('add.linkHint')}</span>
            </label>
            {autofill.state === 'error' && (
              <p className="form-error" role="alert">
                {autofill.message}
              </p>
            )}
            {autofill.state === 'found' && (
              <div className="found" aria-live="polite">
                <p className="field__hint">
                  {found.length ? t('add.found', { count: found.length }) : t('add.notFound')}
                </p>
                {found.length > 1 && (
                  <ul className="found__list">
                    {found.map((p, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className={`choice${chosen === i ? ' is-on' : ''}`}
                          onClick={() => apply(p, i)}
                        >
                          <strong>{p.title}</strong>
                          <span>
                            {p.start && localLabel(p.start, lang)}
                            {p.venueName && ` · ${p.venueName}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </form>

          <div className="divider">
            <span>{t('add.manual')}</span>
          </div>
        </>
      )}

      <form className="add-form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field__label">
            {t('add.field.title')} {required('title')}
          </span>
          <input
            value={form.title}
            maxLength={140}
            onChange={(e) => set('title', e.target.value)}
            aria-invalid={invalid.has('title')}
          />
        </label>

        <fieldset className="field">
          <legend className="field__label">
            {t('add.field.categories')} {required('categoryIds')}
          </legend>
          <div className="cat-grid">
            {config.categories.map((c) => {
              const on = form.categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`cat-chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  disabled={!on && form.categoryIds.length >= MAX_CATEGORIES}
                  onClick={() => toggleCategory(c.id)}
                >
                  <span className="cat-chip__icon" aria-hidden>
                    <Glyph id={c.glyph} size={18} />
                  </span>
                  {c.labels[lang]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="field-pair">
          <label className="field">
            <span className="field__label">
              {t('add.field.start')} {required('start')}
            </span>
            <input
              type="datetime-local"
              value={form.start}
              onChange={(e) => set('start', e.target.value)}
              aria-invalid={invalid.has('start')}
            />
          </label>
          <label className="field">
            <span className="field__label">
              {t('add.field.end')} {required('end')}
            </span>
            <input
              type="datetime-local"
              value={form.end}
              min={form.start || undefined}
              onChange={(e) => set('end', e.target.value)}
              aria-invalid={invalid.has('end')}
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">
            {t('add.field.venue')} {required('venueName')}
          </span>
          <input
            value={form.venueName}
            maxLength={140}
            onChange={(e) => set('venueName', e.target.value)}
            aria-invalid={invalid.has('venueName')}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('add.field.address')}</span>
          <span className="field__row">
            <input
              value={form.address}
              maxLength={200}
              autoComplete="street-address"
              onChange={(e) => set('address', e.target.value)}
            />
            <button
              type="button"
              className="btn btn--inline"
              disabled={geo === 'loading' || (form.address || form.venueName).trim().length < 3}
              onClick={() => locate(form.address || form.venueName)}
            >
              <Icon name="search" size={16} />
              {t('add.findOnMap')}
            </button>
          </span>
        </label>
        <div className="field">
          <span className="field__label">{required('point')}</span>
          <PinMap
            point={form.point}
            onChange={(p) => {
              set('point', p);
              setGeo('idle');
            }}
            label={t('add.pinHint')}
          />
          <span className={`field__hint${geo === 'notFound' ? ' is-warn' : ''}`}>
            {geo === 'notFound' ? t('add.notOnMap') : t('add.pinHint')}
          </span>
        </div>

        <fieldset className="field">
          <legend className="field__label">
            {t('add.field.price')} {required('isFree')}
          </legend>
          <div className="segmented segmented--2" role="radiogroup">
            {([true, false] as const).map((free) => (
              <button
                key={String(free)}
                type="button"
                role="radio"
                aria-checked={form.isFree === free}
                className={form.isFree === free ? 'is-active' : ''}
                onClick={() => set('isFree', free)}
              >
                {t(free ? 'filters.price.free' : 'filters.price.paid')}
              </button>
            ))}
          </div>
        </fieldset>
        {form.isFree === false && (
          <label className="field">
            <span className="field__label">
              {t('add.field.amount', { currency: form.currency })} {required('amount')}
            </span>
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              aria-invalid={invalid.has('amount')}
            />
          </label>
        )}

        <fieldset className="field">
          <legend className="field__label">{t('add.field.entry')}</legend>
          <div className="segmented segmented--2" role="radiogroup">
            {ENTRY_TYPES.map((type) => {
              const on = (form.entry ?? defaultEntry) === type;
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={on ? 'is-active' : ''}
                  onClick={() => set('entry', type)}
                >
                  {t(`add.entry.${type}`)}
                </button>
              );
            })}
          </div>
          <span className="field__hint">{t('add.entry.hint')}</span>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">{t('add.field.age')}</legend>
          <div className="segmented segmented--age" role="radiogroup">
            {ageChoices.map((age) => (
              <button
                key={String(age)}
                type="button"
                role="radio"
                aria-checked={form.ageMin === age}
                className={form.ageMin === age ? 'is-active' : ''}
                onClick={() => set('ageMin', age)}
              >
                {age === null ? t('add.age.none') : `${age}+`}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={form.family}
            onChange={(e) => set('family', e.target.checked)}
          />
          <span>{t('add.field.family')}</span>
        </label>

        <label className="field">
          <span className="field__label">{t('add.field.url')}</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://"
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('add.field.description')}</span>
          <textarea
            rows={3}
            maxLength={submissions.maxDescriptionChars}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>

        <p className="notice">
          {submissions.publishBeforeModeration ? t('add.notice') : t('add.noticePending')}
        </p>
        <label className={`check${invalid.has('terms') ? ' is-invalid' : ''}`}>
          <input
            type="checkbox"
            checked={form.terms}
            onChange={(e) => set('terms', e.target.checked)}
          />
          <span>
            {t('add.termsBefore')}{' '}
            <button
              type="button"
              className="inline-link"
              aria-expanded={termsOpen}
              onClick={() => setTermsOpen((o) => !o)}
            >
              {t('add.termsLink')}
            </button>
          </span>
        </label>
        {termsOpen && (
          <ul className="terms">
            {(['1', '2', '3', '4'] as const).map((n) => (
              <li key={n}>{t(`about.terms.${n}`)}</li>
            ))}
          </ul>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="add-form__foot">
          <button type="submit" className="btn btn--primary" disabled={sending}>
            {sending ? t('add.sending') : t('add.submit')}
          </button>
        </div>
      </form>
    </Screen>
  );
}
