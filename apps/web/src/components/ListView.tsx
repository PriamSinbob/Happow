import { useState, type ReactNode } from 'react';
import type { Language, NearbyEvent } from '@happow/core';
import { region } from '../config';
import { formatDistance, formatRelativeDay } from '../format';
import type { Guidance } from '../hooks/useGuidance';
import { useI18n } from '../i18n';
import { CategoryIcon, useEventText } from './EventMeta';
import { GuidanceCard } from './Guidance';

interface Props {
  events: NearbyEvent[];
  now: Date;
  radiusM: number;
  nextRadiusM: number | null;
  /** Matching events beyond the circle, within the search area, nearest first. */
  around: NearbyEvent[];
  guidance: Guidance;
  /** Category or price filters are narrowing the results. */
  filtered: boolean;
  onSelect: (id: string) => void;
  onExpand: (radius: number) => void;
  onClearFilters: () => void;
  /** 7 / 14 days: rows by day, each day under a header (§13.5). */
  byDay?: boolean;
  /** Events that started earlier are listed from this day on (now, or the picked day). */
  dayFrom?: Date;
}

export function Row({
  ev,
  now,
  onSelect,
}: {
  ev: NearbyEvent;
  now: Date;
  onSelect: (id: string) => void;
}) {
  const { running, when, price, distance, walk } = useEventText(ev, now);
  const { t } = useI18n();
  return (
    <li>
      <button type="button" className="row" onClick={() => onSelect(ev.id)}>
        <CategoryIcon ev={ev} />
        <span className="row__body">
          <span className="row__title">
            {ev.title}
            {ev.verified === false && (
              <span className="badge badge--unverified">{t('event.unverified')}</span>
            )}
          </span>
          <span className="row__when">
            {ev.flag && (
              <span className="badge badge--flag">⚠ {t(`flag.short.${ev.flag.reason}`)}</span>
            )}
            {running && <span className="now-pill">{t('event.now')}</span>}
            {when}
          </span>
          <span className="row__meta">
            {ev.venue?.name} · {distance} · {walk}
          </span>
        </span>
        {price && <span className="row__price">{price}</span>}
      </button>
    </li>
  );
}

function DayGroup({ day, children }: { day: string | null; children: ReactNode }) {
  return (
    <>
      {day && (
        <li className="list__day" role="presentation">
          {day}
        </li>
      )}
      {children}
    </>
  );
}

/** Events by the day they are on from now (a running festival counts today), soonest first. */
function byDay(events: NearbyEvent[], dayFrom: Date, now: Date, lang: Language) {
  const from = (e: NearbyEvent) => Math.max(Date.parse(e.startAt), dayFrom.getTime());
  const groups = new Map<string, NearbyEvent[]>();
  for (const e of [...events].sort((a, b) => from(a) - from(b) || a.distanceM - b.distanceM)) {
    const day = formatRelativeDay(new Date(from(e)).toISOString(), now, region.timezone, lang);
    groups.set(day, [...(groups.get(day) ?? []), e]);
  }
  return [...groups].map(([day, evs]) => ({ day, events: evs }));
}

/** Rows of the "more around" section shown at first and added per "show more". */
const AROUND_PAGE = 30;

/**
 * The circle's events first; after a divider, the rest of the search area nearest first, like a
 * booking site's "more results nearby". An empty circle shows its guidance, then the same section.
 */
export function ListView(props: Props) {
  const { t, lang } = useI18n();
  const [shown, setShown] = useState(AROUND_PAGE);
  const around = props.around.slice(0, shown);
  return (
    <>
      {props.events.length === 0 ? (
        <div className="list list--empty">
          <GuidanceCard
            guidance={props.guidance}
            radiusM={props.radiusM}
            mode="empty"
            filtered={props.filtered}
            fallbackRadiusM={props.nextRadiusM}
            onExpand={props.onExpand}
            onClearFilters={props.onClearFilters}
          />
        </div>
      ) : (
        <ul className="list">
          {(props.byDay
            ? byDay(props.events, props.dayFrom ?? props.now, props.now, lang)
            : [{ day: null, events: props.events }]
          ).map((g) => (
            <DayGroup key={g.day ?? ''} day={g.day}>
              {g.events.map((ev) => (
                <Row key={ev.id} ev={ev} now={props.now} onSelect={props.onSelect} />
              ))}
            </DayGroup>
          ))}
        </ul>
      )}
      {around.length > 0 && (
        <section className="list-around" aria-labelledby="list-around-title">
          <h2 id="list-around-title" className="list-around__title">
            {t('list.around', { radius: formatDistance(props.radiusM, lang) })}
          </h2>
          <ul className="list">
            {around.map((ev) => (
              <Row key={ev.id} ev={ev} now={props.now} onSelect={props.onSelect} />
            ))}
          </ul>
          {props.around.length > shown && (
            <button
              type="button"
              className="btn list-around__more"
              onClick={() => setShown((n) => n + AROUND_PAGE)}
            >
              {t('list.showMore', { count: props.around.length - shown })}
            </button>
          )}
        </section>
      )}
    </>
  );
}
