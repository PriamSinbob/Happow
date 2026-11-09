import { useI18n } from '../i18n';
import { Glyph, Icon } from './Icons';

/** The add motif's category glyphs either side of the plus, nearest the plus first. */
const ADD_LEFT = ['note', 'mask'];
const ADD_RIGHT = ['basket', 'beer'];

/**
 * Add an event, on the map's top row before settings: the plus with its fanned glyphs, one each
 * side at 380 px and two on wider screens, so the row still fits.
 */
export function MapAddButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="map-btn map-add"
      aria-label={t('header.add')}
      onClick={onClick}
    >
      <span className="map-add__motif map-add__far" style={{ opacity: 0.35 }}>
        <Glyph id={ADD_LEFT[1]!} size={10} />
      </span>
      <span className="map-add__motif" style={{ opacity: 0.7 }}>
        <Glyph id={ADD_LEFT[0]!} size={13} />
      </span>
      <Icon name="plusCircle" size={24} strokeWidth={1.8} />
      <span className="map-add__motif" style={{ opacity: 0.7 }}>
        <Glyph id={ADD_RIGHT[0]!} size={13} />
      </span>
      <span className="map-add__motif map-add__far" style={{ opacity: 0.35 }}>
        <Glyph id={ADD_RIGHT[1]!} size={10} />
      </span>
    </button>
  );
}
