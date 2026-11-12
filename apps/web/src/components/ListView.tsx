import { useUnread } from '../updates';
import { Fragment, useState } from 'react';
import {
  activeSeasons,
  fitsSeason,
  isRunning,
  RING_STEPS,
  ringStep,
  SOON_MIN,
  type Language,
  type NearbyEvent,
} from '@happow/core';
import { config, region } from '../config';
import type { DistrictGoal } from '../data/repository';
import {
  formatDistance,
  formatRelativeDay,
  formatTime,
  formatTimeParts,
  isSameDay,
} from '../format';
import type { Guidance } from '../hooks/useGuidance';
import { useI18n, type MessageKey } from '../i18n';
import { glyphOf } from '../pins';
import { useEventText } from './EventMeta';
import { GuidanceCard } from './Guidance';
import { Glyph, Icon } from './Icons';

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
  /** 14 days and the future: rows by day, each day under a header. */
  byDay?: boolean;
  /** Events that started earlier are listed from this day on (now, or the picked day). */
  dayFrom?: Date;
  /** The district goal for an empty reach. */
  goal?: DistrictGoal | null;
  onAdd?: () => void;
}

/** Live: the ring of time left, as on the pin (dotted: no fixed end). */
function LiveRing({ ev, now }: { ev: NearbyEvent; now: Date }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const dash = ev.endEstimated ? '1.5 3' : `${(ringStep(ev, now) / RING_STEPS) * c} ${c}`;
  return (
    <svg className="live-ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r={r} className="live-ring__track" />
      <circle
        cx="11"
        cy="11"
        r={r}
        className="live-ring__arc"
        strokeDasharray={dash}
        transform="rotate(-90 11 11)"
      />
      <circle cx="11" cy="11" r="3.5" className="live-ring__dot" />
    </svg>
  );
}

/** The time column: the start time, "in 26 min" when close; on now, the ring and the end. */
function TimeCell({ ev, now }: { ev: NearbyEvent; now: Date }) {
  const { t, lang } = useI18n();
  if (isRunning(ev, now))
    return (
      <span className="tt-time tt-time--live">
        <LiveRing ev={ev} now={now} />
        {!ev.endEstimated && isSameDay(ev.endAt, now, ev.timezone) && (
          <small>–{formatTime(ev.endAt, ev.timezone, lang)}</small>
        )}
      </span>
    );
  const { time, period } = formatTimeParts(ev.startAt, ev.timezone, lang);
  const minutes = Math.round((Date.parse(ev.startAt) - now.getTime()) / 60_000);
  return (
    <span className="tt-time">
      <strong>
        {time}
        {period && <span className="tt-time__period">{period}</span>}
      </strong>
      {minutes > 0 && minutes <= 90 && <small>{t('event.startsIn', { minutes })}</small>}
    </span>
  );
}

/** An update not seen yet: the red "!" before the title, so a long title never hides it. */
function NewsMark({ ev }: { ev: NearbyEvent }) {
  const { t } = useI18n();
  if (!useUnread().has(ev.id)) return null;
  return (
    <span className="badge badge--news" role="img" aria-label={t('updates.unread')}>
      !
    </span>
  );
}

/** Unverified, reported and cancelled marks after a title. */
function Marks({ ev }: { ev: NearbyEvent }) {
  const { t } = useI18n();
  return (
    <>
      {ev.verified === false && (
        <span className="badge badge--unverified">{t('event.unverified')}</span>
      )}
      {ev.flag && <span className="badge badge--flag">⚠ {t(`flag.short.${ev.flag.reason}`)}</span>}
      {ev.status === 'cancelled' && (
        <span className="badge badge--flag">{t('event.cancelled')}</span>
      )}
    </>
  );
}

/**
 * The date words ("until 12 Nov", "tomorrow, 10:00–18:00") when the time column alone would
 * mislead: on now past today, or starting on another day than its section.
 */
function useOtherDay(ev: NearbyEvent, now: Date, anchor: Date): string | null {
  const { running, when } = useEventText(ev, now);
  const other = running
    ? !isSameDay(ev.endAt, now, ev.timezone)
    : !isSameDay(ev.startAt, anchor, ev.timezone);
  return other ? when : null;
}

interface LineProps {
  ev: NearbyEvent;
  now: Date;
  /** The section's day: a start on another day is spelled out. */
  anchor: Date;
  onSelect: (id: string) => void;
}

/**
 * An event alone at its venue: time, title, then the glyph, venue and walk. The agenda adds its
 * tag ("Going") and the bookmark to unsave.
 */
export function TimeRow({
  ev,
  now,
  anchor,
  onSelect,
  tag,
  onUnsave,
}: LineProps & { tag?: string; onUnsave?: () => void }) {
  const { t } = useI18n();
  const { price, walk } = useEventText(ev, now);
  const otherDay = useOtherDay(ev, now, anchor);
  return (
    <li className={onUnsave ? 'row-wrap' : undefined}>
      <button type="button" className="tt-row" onClick={() => onSelect(ev.id)}>
        <TimeCell ev={ev} now={now} />
        <span className="tt-row__body">
          <span className="tt-row__title">
            <NewsMark ev={ev} />
            {ev.title}
            <Marks ev={ev} />
          </span>
          <span className="tt-row__meta">
            <Glyph id={glyphOf(ev)} size={13} />
            <span>{[otherDay, ev.venue?.name, walk].filter(Boolean).join(' · ')}</span>
            {tag && <span className="badge badge--going">{tag}</span>}
          </span>
        </span>
        {price && <span className="row__price">{price}</span>}
      </button>
      {onUnsave && (
        <button
          type="button"
          className="icon-btn row__unsave"
          aria-label={t('agenda.unsave', { title: ev.title })}
          onClick={onUnsave}
        >
          <Icon name="bookmark" filled />
        </button>
      )}
    </li>
  );
}

/** One event under its venue's header; its glyph shows only when the venue's kinds differ. */
function VenueLine({ ev, now, anchor, onSelect, mixed }: LineProps & { mixed: boolean }) {
  const { price } = useEventText(ev, now);
  const otherDay = useOtherDay(ev, now, anchor);
  return (
    <li>
      <button type="button" className="tt-row tt-row--line" onClick={() => onSelect(ev.id)}>
        <TimeCell ev={ev} now={now} />
        <span className="tt-row__body">
          <span className="tt-row__title">
            <NewsMark ev={ev} />
            {mixed && <Glyph id={glyphOf(ev)} size={13} />}
            {ev.title}
            <Marks ev={ev} />
          </span>
          {otherDay && <span className="tt-row__meta">{otherDay}</span>}
        </span>
        {price && <span className="row__price">{price}</span>}
      </button>
    </li>
  );
}

/** Lines a venue shows before the rest fold into one line of times. */
const VENUE_LINES = 3;

/** The lines of one place's events: the venue block's body, and the card a place's pin opens. */
export function VenueLines({
  events,
  now,
  anchor,
  onSelect,
  mixed = new Set(events.map(glyphOf)).size > 1,
}: Omit<LineProps, 'ev'> & {
  events: NearbyEvent[];
  /** The venue's kinds differ: each line shows its glyph. */
  mixed?: boolean;
}) {
  return (
    <ul className="tt-venue__lines">
      {events.map((ev) => (
        <VenueLine
          key={ev.id}
          ev={ev}
          now={now}
          anchor={anchor}
          onSelect={onSelect}
          mixed={mixed}
        />
      ))}
    </ul>
  );
}

/**
 * Several events at one venue: its name and walk once, then a line per event in its section.
 * Past three, and for its events in later sections, one line of times; a tap unfolds them here.
 */
function VenueBlock({
  group,
  now,
  anchor,
  onSelect,
}: Omit<LineProps, 'ev'> & { group: VenueGroup }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const all = [...group.events, ...group.later];
  const first = all[0]!;
  const { distance, walk } = useEventText(first, now);
  const shown = open ? all : group.events.slice(0, VENUE_LINES);
  const rest = all.slice(shown.length);
  const overflow = group.events.length > VENUE_LINES;
  const mixed = new Set(all.map(glyphOf)).size > 1;
  return (
    <li className="tt-venue">
      <div className="tt-venue__head">
        {!mixed && <Glyph id={glyphOf(first)} size={14} />}
        <span className="tt-venue__name">{first.venue?.name}</span>
        <span className="tt-venue__dist">
          {distance} · {walk}
        </span>
      </div>
      <VenueLines events={shown} now={now} anchor={anchor} onSelect={onSelect} mixed={mixed} />
      {rest.length > 0 && (
        <button type="button" className="tt-venue__more" onClick={() => setOpen(true)}>
          <span>
            {overflow ? t('list.venueMore', { count: rest.length }) : t('list.venueLater')}
          </span>
          <span className="tt-venue__times">
            {rest.map((e) => formatTime(e.startAt, e.timezone, lang)).join('  ')}
          </span>
        </button>
      )}
    </li>
  );
}

interface Section {
  key: string;
  title: string | null;
  /** The day it is about: a start on another day is spelled out. */
  anchor: Date;
  events: NearbyEvent[];
}

const byStart = (a: NearbyEvent, b: NearbyEvent) =>
  Date.parse(a.startAt) - Date.parse(b.startAt) || a.distanceM - b.distanceM;

/** Today: on now (nearest first), within the hour, later (soonest first). */
function todaySections(
  events: NearbyEvent[],
  now: Date,
  t: (key: MessageKey) => string,
): Section[] {
  const live: NearbyEvent[] = [];
  const soon: NearbyEvent[] = [];
  const later: NearbyEvent[] = [];
  for (const e of events) {
    if (isRunning(e, now)) live.push(e);
    else if (Date.parse(e.startAt) - now.getTime() <= SOON_MIN * 60_000) soon.push(e);
    else later.push(e);
  }
  const parts: [string, NearbyEvent[]][] = [
    ['now', live.sort((a, b) => a.distanceM - b.distanceM)],
    ['soon', soon.sort(byStart)],
    ['later', later.sort(byStart)],
  ];
  return parts
    .filter(([, evs]) => evs.length > 0)
    .map(([key, evs]) => ({
      key,
      title: t(`list.section.${key}` as MessageKey),
      anchor: now,
      events: evs,
    }));
}

/** Events by the day they are on from now (a running festival counts today), soonest first. */
function daySections(events: NearbyEvent[], dayFrom: Date, now: Date, lang: Language): Section[] {
  const from = (e: NearbyEvent) => Math.max(Date.parse(e.startAt), dayFrom.getTime());
  const groups = new Map<string, Section>();
  for (const e of [...events].sort((a, b) => from(a) - from(b) || a.distanceM - b.distanceM)) {
    const at = new Date(from(e));
    const day = formatRelativeDay(at.toISOString(), now, region.timezone, lang);
    const s = groups.get(day) ?? { key: day, title: day, anchor: at, events: [] };
    s.events.push(e);
    groups.set(day, s);
  }
  return [...groups.values()];
}

/** One venue's events in a section, plus (today) its events from later sections. */
interface VenueGroup {
  key: string;
  events: NearbyEvent[];
  later: NearbyEvent[];
}

/**
 * Each section's events, one group per venue, in the order each venue first comes up. With
 * `once`, a venue shows only in the section of its next event; its later events go with it.
 */
function venueGroups(sections: Section[], once: boolean) {
  const placed = new Map<string, VenueGroup>();
  return sections
    .map((section) => {
      const local = new Map<string, VenueGroup>();
      for (const e of section.events) {
        const key = e.venue?.id ?? `event:${e.id}`;
        const earlier = placed.get(key);
        if (earlier && !local.has(key)) {
          earlier.later.push(e);
          continue;
        }
        const g = local.get(key) ?? { key, events: [], later: [] };
        g.events.push(e);
        local.set(key, g);
        if (once) placed.set(key, g);
      }
      return { section, groups: [...local.values()] };
    })
    .filter((s) => s.groups.length > 0);
}

/** The list as a timetable: time first, events at one venue under one header. */
function Timetable({
  sections,
  now,
  onSelect,
  venueOnce = false,
}: {
  sections: Section[];
  now: Date;
  onSelect: (id: string) => void;
  /** Today's sections: a venue shows once, with its later events. */
  venueOnce?: boolean;
}) {
  return (
    <ul className="list tt">
      {venueGroups(sections, venueOnce).map(({ section: s, groups }) => (
        <Fragment key={s.key}>
          {s.title && (
            <li className="list__day" role="presentation">
              {s.title}
            </li>
          )}
          {groups.map((g) =>
            g.events.length === 1 && g.later.length === 0 ? (
              <TimeRow
                key={g.key}
                ev={g.events[0]!}
                now={now}
                anchor={s.anchor}
                onSelect={onSelect}
              />
            ) : (
              <VenueBlock key={g.key} group={g} now={now} anchor={s.anchor} onSelect={onSelect} />
            ),
          )}
        </Fragment>
      ))}
    </ul>
  );
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
  // A season collection: the loaded events that fit a running season, by time and
  // distance only.
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const pool = [...props.events, ...props.around];
  const seasons = activeSeasons(config.seasons, props.now, region.timezone)
    .map((s) => ({ season: s, events: pool.filter((e) => fitsSeason(e, s, region.timezone)) }))
    .filter((s) => s.events.length > 0);
  const open = seasons.find((s) => s.season.id === seasonId) ?? null;
  const around = props.around.slice(0, shown);
  const chips = seasons.length > 0 && (
    <div className="seasons" role="group" aria-label={t('season.title')}>
      {seasons.map(({ season, events }) => (
        <button
          key={season.id}
          type="button"
          className={`season-chip${open?.season.id === season.id ? ' is-on' : ''}`}
          aria-pressed={open?.season.id === season.id}
          onClick={() => setSeasonId(open?.season.id === season.id ? null : season.id)}
        >
          {season.labels[lang]} · {events.length}
        </button>
      ))}
    </div>
  );
  if (open) {
    const sorted = [...open.events].sort(byStart);
    return (
      <>
        {chips}
        <section className="list-season" aria-labelledby="list-season-title">
          <h2 id="list-season-title" className="list-around__title">
            {t('season.list', { season: open.season.labels[lang], count: sorted.length })}
          </h2>
          <Timetable
            sections={[{ key: 'season', title: null, anchor: props.now, events: sorted }]}
            now={props.now}
            onSelect={props.onSelect}
          />
          <button type="button" className="btn list-around__more" onClick={() => setSeasonId(null)}>
            {t('season.all')}
          </button>
        </section>
      </>
    );
  }
  return (
    <>
      {chips}
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
            goal={props.goal}
            onAdd={props.onAdd}
          />
        </div>
      ) : (
        <Timetable
          sections={
            props.byDay
              ? daySections(props.events, props.dayFrom ?? props.now, props.now, lang)
              : todaySections(props.events, props.now, t)
          }
          now={props.now}
          onSelect={props.onSelect}
          venueOnce={!props.byDay}
        />
      )}
      {around.length > 0 && (
        <section className="list-around" aria-labelledby="list-around-title">
          <h2 id="list-around-title" className="list-around__title">
            {t('list.around', { radius: formatDistance(props.radiusM, lang) })}
          </h2>
          <Timetable
            sections={[{ key: 'around', title: null, anchor: props.now, events: around }]}
            now={props.now}
            onSelect={props.onSelect}
          />
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
