import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  dayBins,
  dayStarts,
  snapTime,
  timeBins,
  windowRange,
  type HappowEvent,
  type TimeWindow,
} from '@happow/core';
import { config } from '../config';
import { useI18n } from '../i18n';
import { RangeIcon } from './Icons';
import { windowLabel, windowRows } from '../windows';

type Span = Pick<HappowEvent, 'startAt' | 'endAt'>;

interface Props {
  window: TimeWindow;
  onWindow: (id: string) => void;
  now: Date;
  timeZone: string;
  /** Today: the time looked at; null = now. */
  at: Date | null;
  onAt: (at: Date | null) => void;
  /** 7 / 14 days: the selected day (0 = today); null = the whole range. */
  day: number | null;
  onDay: (day: number | null) => void;
  /** Events in reach, for the histogram. */
  events: Span[];
}

const { snapNowMin, stepMin, binMin, carryOverMin } = config.app.timeline;
const PAD = 12;
const TRACK_Y = 46;
const BAR_MAX = 24;

/**
 * The time line under the map (§5, §13.2, §13.3): range icons at its left end, then a track from
 * now to the end of the range with a histogram. Today moves in minutes, 7 / 14 days by day.
 */
export function TimeLine(p: Props) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(220);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const days = 'days' in p.window ? p.window.days : 0;
  const end = windowRange(p.window, p.now, p.timeZone).to;
  const starts = useMemo(
    () => (days ? dayStarts(p.now, p.timeZone, days) : []),
    [days, p.now, p.timeZone],
  );
  const span = Math.max(1, end.getTime() - p.now.getTime());
  const xw = Math.max(40, width - 2 * PAD);
  const xOfTime = (d: Date) => PAD + ((d.getTime() - p.now.getTime()) / span) * xw;
  const dayW = days ? xw / days : 0;

  const bins = useMemo(
    () =>
      days
        ? dayBins(p.events, starts, p.now, carryOverMin)
        : timeBins(p.events, p.now, end, binMin),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.events, days, starts, p.now.getTime(), end.getTime()],
  );
  const peak = Math.max(1, ...bins);

  const hourFmt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: p.timeZone }),
    [p.timeZone],
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(lang, { day: 'numeric', timeZone: p.timeZone }),
    [lang, p.timeZone],
  );
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: p.timeZone }),
    [lang, p.timeZone],
  );
  const dayMonthFmt = useMemo(
    () => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric', timeZone: p.timeZone }),
    [lang, p.timeZone],
  );
  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, {
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
        timeZone: p.timeZone,
      }),
    [lang, p.timeZone],
  );

  // Full local hours after now; labels thin out when the day is long and the screen narrow.
  const hours: Date[] = [];
  if (!days) {
    const h = 3_600_000;
    for (let at = Math.ceil(p.now.getTime() / h) * h; at <= end.getTime() + 1; at += h)
      hours.push(new Date(at));
  }
  const hourEvery = Math.max(1, Math.ceil(22 / (xw / Math.max(1, span / 3_600_000))));

  const thumbX = days
    ? p.day === null
      ? PAD
      : PAD + (p.day + 0.5) * dayW
    : xOfTime(p.at ?? p.now);
  const atNow = days ? p.day === null : p.at === null;
  const label = days
    ? p.day === null
      ? `${dateFmt.format(starts[0]!)}–${dayMonthFmt.format(new Date(starts[days]!.getTime() - 1))}`
      : p.day === 0
        ? t('window.today')
        : dayFmt.format(starts[p.day]!)
    : timeFmt.format(p.at ?? p.now);

  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const x = clientX - r.left - PAD;
    if (days) {
      p.onDay(Math.max(0, Math.min(days - 1, Math.floor(x / dayW))));
      return;
    }
    const at = new Date(p.now.getTime() + (x / xw) * span);
    const snapped = snapTime(at, p.now, end, { snapNowMin, stepMin });
    p.onAt(snapped.getTime() === p.now.getTime() ? null : snapped);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (e.key === 'Home') {
      e.preventDefault();
      if (days) p.onDay(null);
      else p.onAt(null);
    } else if (dir) {
      e.preventDefault();
      if (days) p.onDay(Math.max(0, Math.min(days - 1, (p.day ?? -1) + dir)));
      else {
        const next = snapTime(
          new Date((p.at ?? p.now).getTime() + dir * binMin * 60_000),
          p.now,
          end,
          { snapNowMin, stepMin },
        );
        p.onAt(next.getTime() === p.now.getTime() ? null : next);
      }
    }
  };

  return (
    <div className="timeline">
      <div className="timeline__ranges" role="radiogroup" aria-label={t('window.label')}>
        {config.app.timeWindows.map((w) => {
          const rows = windowRows(w);
          const active = w.id === p.window.id;
          return (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={windowLabel(t, w)}
              className={`range-btn${active ? ' is-active' : ''}`}
              // Tapping the active range again shows all of it, from now.
              onClick={() => {
                if (!active) p.onWindow(w.id);
                p.onAt(null);
                p.onDay(null);
              }}
            >
              {rows !== null && <RangeIcon rows={rows} />}
            </button>
          );
        })}
      </div>
      <div
        ref={box}
        className="timeline__track"
        role="slider"
        tabIndex={0}
        aria-label={t('timeline.label')}
        aria-valuetext={atNow && !days ? t('timeline.now') : label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <svg width={width} height={78} aria-hidden>
          <line className="timeline__line" x1={PAD} x2={PAD + xw} y1={TRACK_Y} y2={TRACK_Y} />
          {bins.map((n, i) => {
            const w = days ? dayW : (binMin * 60_000 * xw) / span;
            const h = (n / peak) * BAR_MAX;
            const active = days && p.day === i;
            return (
              <rect
                key={i}
                className={`timeline__bar${active ? ' is-active' : ''}`}
                x={PAD + i * w + 1}
                y={TRACK_Y - 3 - h}
                width={Math.max(2, w - 2)}
                height={h}
                rx={1.5}
              />
            );
          })}
          {days
            ? starts.slice(0, -1).map((s, i) => (
                <g key={i} className={p.day === i ? 'is-active' : undefined}>
                  <line
                    className="timeline__tick"
                    x1={PAD + i * dayW}
                    x2={PAD + i * dayW}
                    y1={TRACK_Y + 3}
                    y2={TRACK_Y + 7}
                  />
                  {(days <= 7 || i % 2 === 0) && (
                    <text className="timeline__num" x={PAD + (i + 0.5) * dayW} y={TRACK_Y + 21}>
                      {dateFmt.format(s)}
                    </text>
                  )}
                </g>
              ))
            : hours.map((h, i) => (
                <g key={h.getTime()}>
                  <line
                    className="timeline__tick"
                    x1={xOfTime(h)}
                    x2={xOfTime(h)}
                    y1={TRACK_Y + 3}
                    y2={TRACK_Y + 7}
                  />
                  {i % hourEvery === 0 && (
                    <text className="timeline__num" x={xOfTime(h)} y={TRACK_Y + 21}>
                      {Number(hourFmt.format(h))}
                    </text>
                  )}
                </g>
              ))}
          <circle className="timeline__thumb" cx={thumbX} cy={TRACK_Y} r={11} />
          <circle
            className={`timeline__knob${atNow ? ' is-now' : ''}`}
            cx={thumbX}
            cy={TRACK_Y}
            r={4}
          />
        </svg>
        <div
          className="timeline__pill"
          style={{ left: Math.max(36, Math.min(width - 36, thumbX)) }}
          aria-hidden
        >
          {atNow && !days && <span className="timeline__live" />}
          {label}
        </div>
      </div>
    </div>
  );
}
