import { useState } from 'react';
import { activeSeasons, fitsSeason } from '@happow/core';
import { useAccount } from '../account';
import {
  levelKey,
  nextLevel,
  saveCredit,
  useContributions,
  type Contributions,
  type MyEvent,
  type Reward,
} from '../contributions';
import { config, region } from '../config';
import { errorText } from '../errors';
import { formatDay } from '../format';
import { useI18n } from '../i18n';

/**
 * The contributor's side of the account (M12 §5, slice F): impact, level, trust, this month's
 * premium days, the credit opt-in and the account's own events. Information only: no streaks,
 * targets or countdowns, and nothing that can be lost.
 */

/** Verified events, opens, routes and arrivals: totals of the account's events. */
export function ImpactStats({ c }: { c: Contributions }) {
  const { t } = useI18n();
  const stats = [
    ['verified', c.verified],
    ['opens', c.opens],
    ['routes', c.routes],
    ['arrivals', c.arrivals],
    ['thanks', c.thanks],
  ] as const;
  return (
    <dl className="impact">
      {stats.map(([key, n]) => (
        <div key={key} className="impact__stat">
          <dt>{t(`contrib.stat.${key}`)}</dt>
          <dd>{n}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Local · next: Guide at 20 verified events and 200 opens". */
export function LevelLine({ c }: { c: Contributions }) {
  const { t } = useI18n();
  const next = nextLevel(c.level);
  return (
    <p className="contrib__level">
      {c.level && <strong>{t(levelKey(c.level))}</strong>}
      {next && (
        <span className="contrib__next">
          {next.opens > 0
            ? t('contrib.next', {
                level: t(levelKey(next.id)),
                events: next.events,
                opens: next.opens,
              })
            : t('contrib.nextEvents', { level: t(levelKey(next.id)), events: next.events })}
        </span>
      )}
    </p>
  );
}

/** The section under the account card's plan line; hidden until the account has added an event. */
export function ContributorSection({
  onOpenEvent,
  onAddAgain,
}: {
  onOpenEvent: (id: string) => void;
  onAddAgain: (submissionId: string) => void;
}) {
  const { t } = useI18n();
  const account = useAccount();
  const { data: c } = useContributions(account.status === 'signedIn');
  if (!c || c.events.length === 0) return null;

  return (
    <section className="contrib" aria-labelledby="contrib-title">
      <h3 id="contrib-title" className="contrib__title">
        {t('contrib.title')}
      </h3>
      <LevelLine c={c} />
      <ImpactStats c={c} />
      <p className="contrib__line">
        {c.trusted ? (
          <span className="badge badge--trusted">{t('contrib.trusted')}</span>
        ) : (
          t('contrib.trustAfter', { count: c.trustedAfter })
        )}
      </p>
      <p className="contrib__line">
        {t('contrib.monthDays', { days: c.monthDays, cap: c.premiumDaysPerMonth })}
      </p>
      <SeasonLines events={c.events} />
      <CreditSetting />
      <MyEvents events={c.events} onOpen={onOpenEvent} onAgain={onAddAgain} />
    </section>
  );
}

/** "Halloween: 2 of your events" for each running season the adder's live events fit (M12 §6.3). */
function SeasonLines({ events }: { events: MyEvent[] }) {
  const { t, lang } = useI18n();
  const live = events.filter((e) => e.status !== 'rejected' && !e.hidden && e.startAt && e.endAt);
  return (
    <>
      {activeSeasons(config.seasons, new Date(), region.timezone).map((s) => {
        const count = live.filter((e) =>
          fitsSeason(
            {
              title: e.title,
              categoryIds: e.categoryIds ?? [],
              startAt: e.startAt!,
              endAt: e.endAt!,
            },
            s,
            region.timezone,
          ),
        ).length;
        return count > 0 ? (
          <p key={s.id} className="contrib__line">
            {t('contrib.season', { season: s.labels[lang], count })}
          </p>
        ) : null;
      })}
    </>
  );
}

/** "Show my name on events I add": off by default; turning it on first asks for a name. */
export function CreditSetting() {
  const { t, lang } = useI18n();
  const account = useAccount();
  const me = account.me;
  const on = me?.showName ?? false;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  const save = async (showName: boolean, displayName?: string) => {
    setBusy(true);
    setError(null);
    try {
      await saveCredit(showName, displayName);
      await account.refresh();
      setEditing(false);
    } catch (err) {
      setError(errorText(t, err, lang));
    } finally {
      setBusy(false);
    }
  };
  const trimmed = name.trim();

  return (
    <div className="contrib__credit">
      <label className="check">
        <input
          type="checkbox"
          checked={on || editing}
          disabled={busy}
          onChange={(e) => {
            if (!e.target.checked) {
              setEditing(false);
              if (on) void save(false);
            } else if (me.displayName) void save(true);
            else setEditing(true);
          }}
        />
        <span>
          {t('contrib.showName')}
          <span className="field__hint">{t('contrib.showNameHint')}</span>
        </span>
      </label>
      {on && !editing && me.displayName && (
        <p className="contrib__line">
          {t('contrib.shownAs', { name: me.displayName })}{' '}
          <button
            type="button"
            className="inline-link"
            onClick={() => {
              setName(me.displayName ?? '');
              setEditing(true);
            }}
          >
            {t('contrib.changeName')}
          </button>
        </p>
      )}
      {editing && (
        <form
          className="contrib__name"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) void save(true, trimmed);
          }}
        >
          <label className="field__label" htmlFor="credit-name">
            {t('contrib.name')}
          </label>
          <div className="contrib__name-row">
            <input
              id="credit-name"
              value={name}
              maxLength={60}
              autoComplete="nickname"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn--primary" disabled={!trimmed || busy}>
              {t('contrib.saveName')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type EventState = 'rejected' | 'hidden' | 'pending' | 'duplicate' | 'live';

function eventState(e: MyEvent): EventState {
  if (e.status === 'rejected') return 'rejected';
  if (e.hidden || e.reward === 'revoked') return 'hidden';
  if (e.status === 'pending') return 'pending';
  if (e.reward === 'duplicate') return 'duplicate';
  return 'live';
}

/** One row of the list: an event, or a weekly repeat shown by its next date (M12 §4.5). */
interface Row {
  e: MyEvent;
  /** Dates in the series; 1 for a single event. */
  count: number;
  /** The series' next date still ahead, if any. */
  next: string | null;
  opens: number;
  days: number;
}

function rows(events: MyEvent[], now = Date.now()): Row[] {
  const out: Row[] = [];
  const series = new Map<string, MyEvent[]>();
  for (const e of events) {
    const g = e.seriesId ? series.get(e.seriesId) : undefined;
    if (g) g.push(e);
    else if (e.seriesId) series.set(e.seriesId, [e]);
    if (!g) out.push({ e, count: 1, next: null, opens: e.opens, days: e.days });
  }
  return out.map((row) => {
    const g = row.e.seriesId ? series.get(row.e.seriesId)! : null;
    if (!g || g.length < 2) return row;
    const sorted = [...g].sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''));
    const next = sorted.find((x) => x.startAt && Date.parse(x.startAt) >= now) ?? null;
    return {
      e: next ?? sorted.at(-1)!,
      count: g.length,
      next: next?.startAt ?? null,
      opens: g.reduce((n, x) => n + x.opens, 0),
      days: g.reduce((n, x) => n + x.days, 0),
    };
  });
}

/**
 * The account's own events, newest first, with their opens and the days each earned. Any but a
 * rejected or hidden one can be added again for another date (M12 §4.4); a weekly repeat is one
 * row with its count and next date.
 */
function MyEvents({
  events,
  onOpen,
  onAgain,
}: {
  events: MyEvent[];
  onOpen: (id: string) => void;
  onAgain: (submissionId: string) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="contrib__events">
      <h4 className="contrib__subtitle">{t('contrib.events')}</h4>
      <ul className="my-events">
        {rows(events).map(({ e, count, next, opens, days }) => {
          const state = eventState(e);
          const openable = e.eventId && (state === 'live' || state === 'pending');
          const body = (
            <>
              <span className="my-events__title">{e.title}</span>
              <span className="my-events__meta">
                {count > 1
                  ? `${
                      next
                        ? t('contrib.seriesNext', {
                            count,
                            date: formatDay(next, region.timezone, lang),
                          })
                        : t('contrib.series', { count })
                    } · `
                  : e.startAt && `${formatDay(e.startAt, region.timezone, lang)} · `}
                <span className={`my-events__state my-events__state--${state}`}>
                  {t(`contrib.state.${state}`)}
                </span>
                {state === 'live' && ` · ${t('contrib.opens', { count: opens })}`}
                {days > 0 && state === 'live' && ` · ${t('contrib.days', { count: days })}`}
                {e.firstPlace && (state === 'live' || state === 'pending') && (
                  <span className="my-events__first"> · {t('contrib.firstPlace')}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={e.submissionId}>
              {openable ? (
                <button type="button" className="my-events__row" onClick={() => onOpen(e.eventId!)}>
                  {body}
                </button>
              ) : (
                <div className="my-events__row">{body}</div>
              )}
              {state !== 'rejected' && state !== 'hidden' && (
                <button
                  type="button"
                  className="inline-link my-events__again"
                  aria-label={t('contrib.againFor', { title: e.title })}
                  onClick={() => onAgain(e.submissionId)}
                >
                  {t('contrib.again')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Under "Thanks!" after adding (M12 §5.7): what the event earns, and the impact so far. A trusted
 * account's event is rewarded at once; any other earns its days when a moderator approves it.
 */
export function AfterAdd({
  reward,
  onOpenAccount,
}: {
  reward: Reward | null;
  onOpenAccount: () => void;
}) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const signedIn = account.status === 'signedIn';
  const { data: c } = useContributions(signedIn);
  if (!signedIn) return null;
  const cfg = config.plans.contributions;
  const capped = c !== null && c.monthDays >= c.premiumDaysPerMonth;

  let note: string;
  if (reward?.kind === 'duplicate') note = t('add.done.duplicate');
  else if (reward && reward.days > 0)
    note =
      reward.startsAt && Date.parse(reward.startsAt) > Date.now()
        ? t('add.done.earnedFrom', {
            count: reward.days,
            date: formatDay(reward.startsAt, region.timezone, lang),
          })
        : t('add.done.earned', { count: reward.days });
  else if (reward || capped) note = t('add.done.capReached', { cap: cfg.premiumDaysPerMonth });
  else note = t('add.done.toEarn', { count: cfg.premiumDaysPerEvent });

  return (
    <div className="after-add">
      <p className="after-add__reward">{note}</p>
      {c && c.verified > 0 && (
        <>
          <ImpactStats c={c} />
          <button type="button" className="inline-link" onClick={onOpenAccount}>
            {t('add.done.impact')}
          </button>
        </>
      )}
    </div>
  );
}
