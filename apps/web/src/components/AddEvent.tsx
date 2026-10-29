import { useEffect, useRef, useState } from 'react';
import { entryOf, type EntryType, type Language, type LatLng } from '@happow/core';
import { useAccount, type Me } from '../account';
import { track } from '../analytics';
import { api, ApiError, deviceId } from '../api';
import { accessToken } from '../auth';
import { config, region } from '../config';
import { errorText } from '../errors';
import { formatDay, formatTime } from '../format';
import { useI18n } from '../i18n';
import { takeShare } from '../share';
import { Glyph, Icon } from './Icons';
import { PinMap } from './PinMap';
import { PremiumMark, PremiumSheet } from './Premium';
import { Screen } from './Screen';
import { SignInSheet } from './SignIn';
import { AfterAdd } from './Contributor';
import type { Reward } from '../contributions';
import { shrinkPhoto } from '../photo';
import { minutesBetween, nowInput, shiftInput } from '../formTime';

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
  /** None for a poster photo. */
  url: string | null;
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

/** A submission's form as the server stored it, read back for "add again" (M12 §4.4). */
interface SentForm {
  title: string;
  categoryIds: string[];
  venueName: string;
  address?: string | null;
  point: LatLng;
  start: string;
  end?: string | null;
  isFree: boolean;
  priceMin?: number | null;
  currency?: string | null;
  url?: string | null;
  description?: string | null;
  ageMin?: number | null;
  family?: boolean | null;
  entry?: EntryType | null;
}

/** Everything but the date and time, which the new event needs its own of. */
function copyOf(s: SentForm): Form {
  return {
    ...EMPTY,
    title: s.title,
    categoryIds: s.categoryIds.slice(0, MAX_CATEGORIES),
    venueName: s.venueName,
    address: s.address ?? '',
    point: s.point,
    isFree: s.isFree,
    amount: !s.isFree && s.priceMin != null ? String(s.priceMin) : '',
    currency: s.currency ?? region.currency,
    url: s.url ?? '',
    description: s.description ?? '',
    ageMin: s.ageMin ?? null,
    family: s.family === true,
    entry: s.entry ?? null,
  };
}

/** The photo could not be decoded on the device (an unusual format, or a broken file). */
class PhotoUnreadable extends Error {}

const MAX_CATEGORIES = 3;
/** Age choices: not stated, all ages, 12+, 16+, 18+. */
const AGE_CHOICES = [null, 0, 12, 16, 18] as const;
const ENTRY_TYPES: EntryType[] = ['fixed', 'open'];
const { submissions } = config.app;

/** Where a fill came from: a link, or a poster photo (M12 slice G). */
type FillSource = 'link' | 'photo';

type Autofill =
  | { state: 'idle' }
  | { state: 'loading'; from: FillSource }
  | { state: 'error'; message: string }
  | { state: 'found'; events: Prefill[]; from: FillSource };

type Done = {
  status: 'published' | 'pending';
  eventId: string | null;
  /** Given at once to a trusted account's event (M12 §5.3). */
  reward?: Reward;
};

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

/** The day a monthly quota comes back: "1 listopada" / "1 November". */
function resetDay(resetsAt: string, lang: Language): string {
  return new Intl.DateTimeFormat(lang === 'pl' ? 'pl-PL' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: region.timezone,
  })
    .format(new Date(resetsAt))
    .replace(/ /g, '\u00a0'); // "1 listopada" never splits across lines
}

/** One meter of the usage strip; it turns warm with the reset date once used up. */
function Meter({
  label,
  used,
  limit,
  premium,
  resets,
}: {
  label: string;
  used: number;
  limit: number;
  premium: boolean;
  resets: string;
}) {
  const out = used >= limit;
  // A sliver once anything is used, so 1 / 300 doesn't read as nothing.
  const pct = limit ? Math.min(100, Math.max(used ? 3 : 0, (used / limit) * 100)) : 100;
  return (
    <div className={`meter${out ? ' meter--out' : ''}`}>
      <div className="meter__top">
        <span className="meter__label">
          {label}
          {premium && <PremiumMark size={11} />}
        </span>
        <span className="meter__num">
          {used} / {limit}
        </span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={out ? `${used} / ${limit}, ${resets}` : `${used} / ${limit}`}
      >
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
      {out && <div className="meter__reset">{resets}</div>}
    </div>
  );
}

/** This month's events and autofills (M8 §5, `docs/design/add.html`). */
function Usage({ me }: { me: Me }) {
  const { t, lang } = useI18n();
  const resets = t('usage.resets', { date: resetDay(me.usage.resetsAt, lang) });
  const premium = me.plan === 'premium';
  return (
    <div className="usage">
      <Meter label={t('usage.events')} {...me.usage.events} premium={premium} resets={resets} />
      <Meter label={t('usage.autofill')} {...me.usage.autofill} premium={premium} resets={resets} />
    </div>
  );
}

/**
 * "Add an event": paste a link to prefill, check the fields, place the pin, submit. Signed out it
 * offers sign-in first (adding needs an account, M8 §2); signed in it shows this month's usage.
 */
export function AddEvent({
  again = null,
  here = null,
  onClose,
  onOpenEvent,
  onOpenAccount,
}: {
  /** One of the account's submissions to copy for another date (M12 §4.4). */
  again?: string | null;
  /** A precise current location: offers "happening here, now" (M12 §4.3). */
  here?: LatLng | null;
  onClose: () => void;
  onOpenEvent: (id: string) => void;
  /** The account card in About, with the contributor's impact. */
  onOpenAccount: () => void;
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
  // The events quota ran out on the server while this form was open (another device, a race).
  const [ranOut, setRanOut] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  // Opened by sharing a page into Happow.
  const [shared, setShared] = useState(false);
  // "Happening here, now": the short form, or expanded with "More details".
  const [quick, setQuick] = useState<'compact' | 'full' | null>(null);
  // The end follows the start: by the category's usual length after quick add, by the copied
  // event's own length after add again; null once the end is set by hand.
  const [follow, setFollow] = useState<'category' | number | null>(null);
  const [copied, setCopied] = useState<
    | { state: 'loading' }
    | { state: 'ready'; title: string }
    | { state: 'error'; message: string }
    | null
  >(again ? { state: 'loading' } : null);
  // The submit button turns off under the finger, so the message takes the focus.
  const ranOutAlert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (ranOut) ranOutAlert.current?.focus();
  }, [ranOut]);

  const account = useAccount();
  const { me } = account;
  const gated = account.status === 'signedOut' && submissions.account === 'required';
  const autofillOn = submissions.autofill === 'account' && account.status !== 'signedOut';
  const autofillOut = me ? me.usage.autofill.used >= me.usage.autofill.limit : false;
  // Once a submit is refused for the quota, a fill would spend an autofill on nothing (owner).
  const linkOff = autofillOut || ranOut;
  const eventsOut = me ? me.usage.events.used >= me.usage.events.limit : false;
  const resets = me ? resetDay(me.usage.resetsAt, lang) : '';
  // The one premium link, for a free account that has run out of something (pull, not push).
  const more = me && me.plan !== 'premium' && (
    <button
      type="button"
      className="inline-link inline-link--mark"
      onClick={() => setPremiumOpen(true)}
    >
      <PremiumMark size={13} />
      {t('add.more')}
    </button>
  );

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const invalid = tried ? missing(form) : new Set<keyof Form>();
  const required = (key: keyof Form) =>
    invalid.has(key) && <span className="field__error">{t('add.required')}</span>;
  const defaultEntry = entryOf(
    { categoryIds: form.categoryIds, entry: null, graceMin: null },
    config.categories,
  ).entry;
  const span =
    follow === 'category'
      ? (config.categories.find((c) => c.id === form.categoryIds[0])?.defaultDurationMin ?? null)
      : follow;
  useEffect(() => {
    if (span !== null && form.start) setForm((f) => ({ ...f, end: shiftInput(f.start, span) }));
  }, [span, form.start]);
  const compact = quick === 'compact';
  // A prefilled page may give an age the choices lack (6+); offer it too.
  const ageChoices: (number | null)[] =
    form.ageMin !== null && !(AGE_CHOICES as readonly (number | null)[]).includes(form.ageMin)
      ? [...AGE_CHOICES, form.ageMin].sort((a, b) => (a ?? -1) - (b ?? -1))
      : [...AGE_CHOICES];

  function fill(e: React.FormEvent) {
    e.preventDefault();
    if (link.trim()) void fillFrom(link.trim());
  }

  /** Fills the form from a page. `fallbackTitle`: a share's title, used when the page gives none. */
  async function fillFrom(url: string, fallbackTitle: string | null = null) {
    // Nothing usable from the page: keep the link, and the shared title if the form has none.
    const keepLink = () => setForm((f) => ({ ...f, url, title: f.title || (fallbackTitle ?? '') }));
    await runFill('link', keepLink, async () =>
      api<{ events: Prefill[] }>('autofill', {
        token: await accessToken(),
        body: { url, regionId: region.id },
      }),
    );
  }

  /** Fills the form from a poster photo, shrunk on the device first (M12 §4.2). */
  async function fillFromPhoto(file: File) {
    await runFill(
      'photo',
      () => {},
      async () => {
        let photo;
        try {
          photo = await shrinkPhoto(file);
        } catch {
          throw new PhotoUnreadable();
        }
        return api<{ events: Prefill[] }>('autofill/photo', {
          token: await accessToken(),
          body: { image: photo.data, mediaType: photo.mediaType, regionId: region.id },
        });
      },
    );
  }

  async function runFill(
    from: FillSource,
    onNothing: () => void,
    request: () => Promise<{ events: Prefill[] }>,
  ) {
    setAutofill({ state: 'loading', from });
    try {
      const res = await request();
      setAutofill({ state: 'found', events: res.events, from });
      if (res.events.length === 1) apply(res.events[0]!, 0);
      if (!res.events.length) onNothing();
      // Only a fill that found something counts (M8 §5).
      else void account.refresh();
    } catch (err) {
      onNothing();
      if (err instanceof ApiError && (err.code === 'quota_exceeded' || err.status === 401)) {
        // Used up meanwhile, or the session ended: /api/me tells the form which.
        setAutofill({ state: 'idle' });
        void account.refresh();
      } else
        setAutofill({
          state: 'error',
          message:
            err instanceof PhotoUnreadable ? t('add.photo.unreadable') : errorText(t, err, lang),
        });
    }
  }

  // A page shared into Happow (M12 §4.1): taken once the account is known, so a signed-out share
  // waits through sign-in. It fills from the link when an autofill is left; otherwise the link
  // and the shared title go straight into the form.
  const ready = !gated && account.status !== 'loading' && (!autofillOn || me !== null);
  useEffect(() => {
    if (!ready) return;
    const s = takeShare();
    if (!s) return;
    setShared(true);
    if (s.link) setLink(s.link);
    if (s.link && autofillOn && !linkOff) void fillFrom(s.link, s.title);
    else setForm((f) => ({ ...f, url: s.link ?? f.url, title: f.title || (s.title ?? '') }));
    // Once, when the form becomes ready; fillFrom reads the latest state itself.
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add again (M12 §4.4): the account's own submission, copied but for the date.
  useEffect(() => {
    if (!again || !ready) return;
    let live = true;
    void (async () => {
      try {
        const { form: sent } = await api<{ form: SentForm }>(
          `me/submissions/${encodeURIComponent(again)}`,
          { token: await accessToken() },
        );
        if (!live) return;
        setForm(copyOf(sent));
        setFollow(minutesBetween(sent.start, sent.end ?? null));
        setCopied({ state: 'ready', title: sent.title });
      } catch (err) {
        if (!live) return;
        setCopied({
          state: 'error',
          message:
            err instanceof ApiError && err.status === 404
              ? t('add.again.gone')
              : errorText(t, err, lang),
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [again, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "Happening here, now" (M12 §4.3): the pin where you are, starting now. */
  function startQuick() {
    if (!here) return;
    setQuick('compact');
    setFollow('category');
    setGeo('idle');
    setForm((f) => ({
      ...f,
      point: here,
      start: nowInput(region.timezone, submissions.quickAdd.roundMin),
    }));
  }

  /** From the thanks screen: the same event again, for another date. */
  function addAnotherDate() {
    const length = minutesBetween(form.start, form.end);
    setDone(null);
    setForm((f) => ({ ...f, start: '', end: '' }));
    setFollow(length);
    setQuick((q) => (q ? 'full' : q));
    setTried(false);
    setCopied({ state: 'ready', title: form.title });
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
      url: p.url ?? f.url,
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
        token: await accessToken(),
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
      void account.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'quota_exceeded') {
        // What was typed stays on screen; the meters catch up.
        setRanOut(true);
        void account.refresh();
      } else {
        if (err instanceof ApiError && err.status === 401) void account.refresh();
        setError(errorText(t, err, lang));
      }
    } finally {
      setSending(false);
    }
  }

  if (gated) {
    // Over an empty screen: "Not now" closes both; signing in shows the form underneath.
    return (
      <Screen title={t('add.title')} onClose={onClose}>
        <SignInSheet forAdd onClose={onClose} onSignedIn={() => {}} />
      </Screen>
    );
  }

  const premiumSheet = premiumOpen && <PremiumSheet onClose={() => setPremiumOpen(false)} />;

  if (eventsOut && !done && !ranOut) {
    return (
      <Screen title={t('add.title')} onClose={onClose}>
        <Usage me={me!} />
        <div className="notice notice--quota" role="status">
          <p>
            {t(me!.plan === 'premium' ? 'add.eventsOutPremium' : 'add.eventsOut', {
              // The real count: it can pass the limit when premium ends mid-month (owner).
              count: me!.usage.events.used,
              limit: me!.usage.events.limit,
              date: resets,
            })}
          </p>
          {more}
        </div>
        <button type="button" className="btn btn--block" onClick={onClose}>
          {t('add.close')}
        </button>
        {premiumSheet}
      </Screen>
    );
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
          <AfterAdd reward={done.reward ?? null} onOpenAccount={onOpenAccount} />
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
                setQuick(null);
                setFollow(null);
                setCopied(null);
              }}
            >
              {t('add.another')}
            </button>
          </div>
          <button type="button" className="inline-link" onClick={addAnotherDate}>
            {t('add.again')}
          </button>
        </div>
        {me && <Usage me={me} />}
      </Screen>
    );
  }

  const found = autofill.state === 'found' ? autofill.events : [];

  return (
    <Screen title={t('add.title')} onClose={onClose}>
      {me && <Usage me={me} />}
      {shared && (
        <p className="add-shared" role="status">
          <Icon name="link" size={15} />
          {t('add.shared')}
        </p>
      )}
      {here && !again && !copied && !quick && (
        <section className="quick" aria-labelledby="quick-title">
          <h3 id="quick-title" className="quick__title">
            {t('add.quick.title')}
          </h3>
          <p className="quick__text">{t('add.quick.text')}</p>
          <button type="button" className="btn btn--primary btn--block" onClick={startQuick}>
            <Icon name="locate" size={18} />
            {t('add.quick.start')}
          </button>
        </section>
      )}
      {copied?.state === 'loading' && (
        <p className="field__hint" role="status">
          {t('add.again.loading')}
        </p>
      )}
      {copied?.state === 'error' && (
        <p className="form-error" role="alert">
          {copied.message}
        </p>
      )}
      {copied?.state === 'ready' && (
        <p className="add-shared" role="status">
          <Icon name="copy" size={15} />
          {t('add.again.copied', { title: copied.title })}
        </p>
      )}
      {autofillOn && !quick && !copied && (
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
                  disabled={linkOff}
                  onChange={(e) => setLink(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn--primary btn--inline"
                  disabled={!link.trim() || autofill.state === 'loading' || linkOff}
                >
                  <Icon name="link" size={16} />
                  {autofill.state === 'loading' && autofill.from === 'link'
                    ? t('add.filling')
                    : t('add.fill')}
                </button>
              </span>
              {!autofillOut && <span className="field__hint">{t('add.linkHint')}</span>}
            </label>
            <label
              className={`btn btn--block autofill__photo${linkOff || autofill.state === 'loading' ? ' is-disabled' : ''}`}
            >
              <input
                type="file"
                accept="image/*"
                className="visually-hidden"
                disabled={linkOff || autofill.state === 'loading'}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // The same photo can be picked again after a failure.
                  e.target.value = '';
                  if (file) void fillFromPhoto(file);
                }}
              />
              <Icon name="camera" size={18} />
              {autofill.state === 'loading' && autofill.from === 'photo'
                ? t('add.photo.reading')
                : t('add.photo')}
            </label>
            {autofillOut && (
              <div className="notice notice--quota" role="status">
                <p>{t('add.autofillOut', { date: resets })}</p>
                {more}
              </div>
            )}
            {autofill.state === 'error' && (
              <p className="form-error" role="alert">
                {autofill.message}
              </p>
            )}
            {autofill.state === 'found' && (
              <div className="found" aria-live="polite">
                <p className="field__hint">
                  {found.length
                    ? t('add.found', { count: found.length })
                    : autofill.from === 'photo'
                      ? t('add.photo.notFound')
                      : t('add.notFound')}
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

        {!compact && (
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
                onChange={(e) => {
                  set('end', e.target.value);
                  setFollow(null);
                }}
                aria-invalid={invalid.has('end')}
              />
            </label>
          </div>
        )}

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
        {!compact && (
          <>
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
          </>
        )}

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

        {compact ? (
          <div className="quick-summary">
            <p className="field__hint">
              {t('add.quick.summary', { time: formatTime(`${form.start}:00Z`, 'UTC', lang) })}
            </p>
            <button type="button" className="inline-link" onClick={() => setQuick('full')}>
              {t('add.quick.more')}
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}

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
        {(error || ranOut) && (
          <p className="form-error" role="alert" ref={ranOutAlert} tabIndex={-1}>
            {ranOut ? t('add.ranOut', { date: resets }) : error}
          </p>
        )}
        <div className="add-form__foot">
          <button type="submit" className="btn btn--primary" disabled={sending || ranOut}>
            {sending ? t('add.sending') : t('add.submit')}
          </button>
        </div>
      </form>
      {premiumSheet}
    </Screen>
  );
}
