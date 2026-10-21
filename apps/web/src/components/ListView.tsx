import type { NearbyEvent } from '@happow/core';
import type { Guidance } from '../hooks/useGuidance';
import { useI18n } from '../i18n';
import { CategoryIcon, useEventText } from './EventMeta';
import { GuidanceCard } from './Guidance';

interface Props {
  events: NearbyEvent[];
  now: Date;
  radiusM: number;
  nextRadiusM: number | null;
  guidance: Guidance;
  /** Category or price filters are narrowing the results. */
  filtered: boolean;
  onSelect: (id: string) => void;
  onExpand: (radius: number) => void;
  onClearFilters: () => void;
}

function Row({
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

export function ListView(props: Props) {
  if (props.events.length === 0) {
    return (
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
    );
  }
  return (
    <ul className="list">
      {props.events.map((ev) => (
        <Row key={ev.id} ev={ev} now={props.now} onSelect={props.onSelect} />
      ))}
    </ul>
  );
}
