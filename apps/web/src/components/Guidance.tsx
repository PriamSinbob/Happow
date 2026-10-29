import { snapRadiusUp } from '@happow/core';
import { config } from '../config';
import { formatDistance, navigationUrl } from '../format';
import type { DistrictGoal } from '../data/repository';
import type { Guidance as GuidanceData } from '../hooks/useGuidance';
import { useI18n } from '../i18n';
import { Icon } from './Icons';

const { minM, maxM } = config.app.radius;

interface Props {
  guidance: GuidanceData;
  radiusM: number;
  /** "empty": the circle has nothing; "hotspot": the user tapped the hotspot marker. */
  mode: 'empty' | 'hotspot';
  /** Category or price filters are narrowing the results. */
  filtered: boolean;
  /** Radius to offer when nothing is found within the search area (plain "try larger"). */
  fallbackRadiusM: number | null;
  onExpand: (radius: number) => void;
  onClearFilters: () => void;
  onClose?: () => void;
  /** The district the reach is in, with its events this weekend (M12 §6.2): empty mode only. */
  goal?: DistrictGoal | null;
  onAdd?: () => void;
}

/**
 * Never a dead end: when the circle is empty, say where the nearest and the busiest events are and
 * offer one tap to widen the radius or walk there.
 */
export function GuidanceCard(props: Props) {
  const { t, lang } = useI18n();
  const { guidance, mode } = props;
  const { hotspot, nearest } = guidance;
  const dir = (d: string) => t(`dir.${d}` as 'dir.n');
  const dist = (m: number) => formatDistance(m, lang);

  const busiestLine = hotspot
    ? t('guide.busiest', {
        place: hotspot.topVenue ?? t('guide.place'),
        distance: dist(hotspot.distanceM),
        count: hotspot.count,
      })
    : null;
  const nearestLine = nearest
    ? t('guide.nearest', { distance: dist(nearest.distanceM), direction: dir(nearest.direction) })
    : null;

  // Expand to the nearest event (empty) or to take in the hotspot (hotspot card).
  const expandTo =
    mode === 'hotspot' && hotspot
      ? snapRadiusUp(hotspot.distanceM + 150, minM, maxM)
      : (guidance.expandTo ?? (nearest ? null : props.fallbackRadiusM));
  const target = mode === 'hotspot' ? hotspot : (hotspot ?? nearest);
  const nothingAround = mode === 'empty' && !hotspot && !nearest;

  return (
    <div className={`guide guide--${mode}`} role={mode === 'empty' ? 'status' : 'dialog'}>
      <div className="guide__head">
        <p className="guide__title">
          {mode === 'empty'
            ? t('list.empty.title', { radius: dist(props.radiusM) })
            : t('guide.busiestTitle')}
        </p>
        {props.onClose && (
          <button
            type="button"
            className="icon-btn"
            onClick={props.onClose}
            aria-label={t('event.close')}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {mode === 'empty' && nearestLine && (
        <p className="guide__line">
          <span className="guide__arrow" aria-hidden>
            <Icon name="navigate" size={14} />
          </span>
          {nearestLine}
        </p>
      )}
      {busiestLine && (
        <p className="guide__line">
          <span className="guide__dot" aria-hidden />
          {busiestLine}
        </p>
      )}
      {mode === 'empty' && props.goal && props.onAdd && (
        <p className="guide__line guide__goal">
          {t('goal.line', { district: props.goal.name, count: props.goal.count })}{' '}
          <button type="button" className="inline-link" onClick={props.onAdd}>
            {t('goal.add')}
          </button>
        </p>
      )}
      {nothingAround && (
        <p className="guide__line muted">
          {t('guide.nothingAround', { distance: dist(config.app.density.searchRadiusM) })}
        </p>
      )}
      <div className="guide__actions">
        {expandTo !== null && expandTo > props.radiusM && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => props.onExpand(expandTo)}
          >
            {t('list.empty.expand', { radius: dist(expandTo) })}
          </button>
        )}
        {target && (
          <a
            className="btn"
            href={navigationUrl(target.point.lat, target.point.lng)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="navigate" size={16} /> {t('guide.takeMeThere')}
          </a>
        )}
        {mode === 'empty' && props.filtered && (
          <button type="button" className="btn" onClick={props.onClearFilters}>
            {t('list.empty.clear')}
          </button>
        )}
      </div>
    </div>
  );
}
