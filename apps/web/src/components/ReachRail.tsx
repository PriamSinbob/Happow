import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { nearestDetent, radiusToRail, railToRadius, reachLabel } from '@happow/core';
import { config } from '../config';
import { useI18n } from '../i18n';
import { WalkIcon } from './Icons';

const { detentsM, maxM } = config.app.radius;
const RAIL_H = 196;
const THUMB = 28;

interface Props {
  radiusM: number;
  /** A detent was reached (while dragging too): the events follow. */
  onChange: (radiusM: number) => void;
  /** While a finger is down: the radius under it, for the map's zoom; null on release. */
  onPreview: (radiusM: number | null) => void;
}

/**
 * Reach rail on the right edge (§5): log scale between the detents, walking minutes up to 2 km,
 * a tick of haptics per detent on Android. City mode (past the last detent) comes from a pinch.
 */
export function ReachRail({ radiusM, onChange, onPreview }: Props) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lastDetent = useRef(radiusM);
  const shown = drag ?? radiusM;
  const city = drag === null && radiusM > detentsM[detentsM.length - 1]!;
  const y = (1 - radiusToRail(shown, detentsM)) * RAIL_H;

  const at = (clientY: number) => {
    const r = track.current!.getBoundingClientRect();
    const p = 1 - (clientY - r.top - THUMB / 2) / RAIL_H;
    return railToRadius(p, detentsM);
  };
  const move = (r: number) => {
    setDrag(r);
    onPreview(r);
    const d = nearestDetent(r, detentsM);
    if (d !== lastDetent.current && Math.abs(Math.log(r / d)) < 0.07) {
      lastDetent.current = d;
      navigator.vibrate?.(6);
      onChange(d);
    }
  };
  const end = () => {
    if (drag === null) return;
    const d = nearestDetent(drag, detentsM);
    lastDetent.current = d;
    setDrag(null);
    onPreview(null);
    onChange(d);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastDetent.current = radiusM;
    move(at(e.clientY));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) move(at(e.clientY));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = detentsM.indexOf(nearestDetent(Math.min(radiusM, detentsM.at(-1)!), detentsM));
    const next =
      e.key === 'ArrowUp' || e.key === 'ArrowRight'
        ? detentsM[Math.min(detentsM.length - 1, i + 1)]
        : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
          ? detentsM[Math.max(0, i - 1)]
          : null;
    if (next === null || next === undefined) return;
    e.preventDefault();
    onChange(next);
  };

  const label = reachLabel(shown, config.app.walkingSpeedMPerMin);
  const text = city
    ? t('reach.city')
    : label.kind === 'min'
      ? t('reach.min', { min: label.value })
      : t('reach.km', { km: label.value });

  return (
    <div className="rail">
      <div
        ref={track}
        className="rail__track"
        role="slider"
        tabIndex={0}
        aria-label={t('radius.label')}
        aria-valuemin={detentsM[0]}
        aria-valuemax={city ? maxM : detentsM.at(-1)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={text}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
      >
        <span className="rail__line" aria-hidden />
        {detentsM.map((d) => (
          <span
            key={d}
            className="rail__stop"
            style={{ top: THUMB / 2 + (1 - radiusToRail(d, detentsM)) * RAIL_H }}
            aria-hidden
          />
        ))}
        <span className="rail__thumb" style={{ top: y }} aria-hidden />
      </div>
      <div className="rail__pill" style={{ top: y }} aria-hidden>
        {label.kind === 'min' && !city && <WalkIcon />}
        {text}
      </div>
    </div>
  );
}
