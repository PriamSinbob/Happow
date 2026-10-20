import type { NearbyEvent } from '@happow/core';
import { formatDistance } from '../format';
import { useI18n } from '../i18n';
import { CategoryIcon, useEventText } from './EventMeta';

interface Props {
  events: NearbyEvent[];
  now: Date;
  radiusM: number;
  nextRadiusM: number | null;
  onSelect: (id: string) => void;
  onExpand: (radius: number) => void;
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
          <span className="row__title">{ev.title}</span>
          <span className="row__when">
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
  const { t, lang } = useI18n();
  if (props.events.length === 0) {
    return (
      <div className="list list--empty">
        <p className="empty__title">
          {t('list.empty.title', { radius: formatDistance(props.radiusM, lang) })}
        </p>
        <p>{t('list.empty.body')}</p>
        {props.nextRadiusM && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => props.onExpand(props.nextRadiusM!)}
          >
            {t('list.empty.expand', { radius: formatDistance(props.nextRadiusM, lang) })}
          </button>
        )}
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
