import { useEffect, useState } from 'react';
import { api } from '../api';
import { accessToken } from '../auth';
import { region } from '../config';
import { errorText } from '../errors';
import { formatDay } from '../format';
import { useI18n } from '../i18n';

/** One calendar feed the account imports from (GET /api/me/feeds, M12 §4.6). */
export interface Feed {
  id: number;
  url: string;
  status: 'active' | 'stopped';
  /** A moderator approved one of its events: later ones follow the account's trust. */
  approved: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastEvents: number | null;
  imported: number;
}

interface Feeds {
  feeds: Feed[];
  max: number;
}

/** "kalendarz.example" from the feed's address: enough to tell feeds apart, never the secret part. */
export function feedHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Calendar feeds on the account card (slice L): paste an iCal link once; its upcoming events come
 * in as the account's own, counting against the month. Removing a feed keeps what it brought.
 */
export function FeedsSection() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Feeds | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (path: string, init: { body?: unknown; method?: 'DELETE' } = {}) => {
    setBusy(true);
    setError(null);
    try {
      setData(await api<Feeds>(path, { token: await accessToken(), ...init }));
      return true;
    } catch (err) {
      setError(errorText(t, err, lang));
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void call('me/feeds');
    // Once, when the card opens.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status = (f: Feed): string => {
    if (f.status === 'stopped') return t('feeds.stopped');
    if (f.lastError === 'quota') return t('feeds.quota');
    if (f.lastError) return t('feeds.failed');
    if (!f.lastRunAt) return t('feeds.waiting');
    const read = t('feeds.read', {
      count: f.imported,
      date: formatDay(f.lastRunAt, region.timezone, lang),
    });
    return f.approved ? read : `${read} · ${t('feeds.firstReview')}`;
  };

  // Not loaded (signed out meanwhile, or the server lacks feeds yet): nothing to show.
  if (!data) return null;
  return (
    <section className="contrib feeds" aria-labelledby="feeds-title">
      <h3 id="feeds-title" className="contrib__title">
        {t('feeds.title')}
      </h3>
      <p className="contrib__line">{t('feeds.intro')}</p>
      {data && data.feeds.length > 0 && (
        <ul className="my-events">
          {data.feeds.map((f) => (
            <li key={f.id}>
              <div className="my-events__row">
                <span className="my-events__title">{feedHost(f.url)}</span>
                <span
                  className={`my-events__meta${f.status === 'stopped' || (f.lastError && f.lastError !== 'quota') ? ' is-warn' : ''}`}
                >
                  {status(f)}
                </span>
              </div>
              {f.status === 'active' && (
                <button
                  type="button"
                  className="inline-link my-events__again"
                  disabled={busy}
                  aria-label={t('feeds.removeFor', { host: feedHost(f.url) })}
                  onClick={() => void call(`me/feeds/${f.id}`, { method: 'DELETE' })}
                >
                  {t('feeds.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.feeds.length < data.max && (
        <form
          className="feeds__add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              url.trim() &&
              (await call('me/feeds', { body: { url: url.trim(), regionId: region.id } }))
            )
              setUrl('');
          }}
        >
          <label className="field">
            <span className="field__label">{t('feeds.label')}</span>
            <span className="field__row">
              <input
                type="url"
                inputMode="url"
                placeholder="https://… .ics"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button type="submit" className="btn btn--inline" disabled={busy || !url.trim()}>
                {t('feeds.add')}
              </button>
            </span>
            <span className="field__hint">{t('feeds.hint', { max: data.max })}</span>
          </label>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
