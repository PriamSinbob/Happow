import { GLYPHS, isGlyphId, type Glyph as GlyphDef } from '../glyphs';
/** Small inline icon set (24×24, currentColor). Decorative: callers provide the accessible name. */
const paths = {
  filter: 'M4 6h16M7 12h10M10 18h4',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  share: 'M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  bookmark: 'M6 4h12v17l-6-4.5L6 21z',
  calendar:
    'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M9 3v4M15 3v4',
  navigate: 'M3 11l18-8-8 18-2-8z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  ticket:
    'M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM10 6v12',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  wallet: 'M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l11-3v3M16 13h1',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  check: 'M5 12l5 5L20 7',
  mail: 'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM3 7l9 6l9 -6',
  // Map-screen controls (§5): settings sliders, list, map, locate, walking person.
  sliders: 'M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4',
  list: 'M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01',
  map: 'M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13',
  locate:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 2v2M12 20v2M2 12h2M20 12h2',
  walk: 'M13 4.5h.01M7 21l3-4M16 21l-2-4-3-3 1-6M6 12l2-3 4-1 3 3 3 1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  language:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  // Settings sheet (§15, docs/design/settings-rows.html): Tabler ticket, ticket-off, world,
  // circle-plus, gear, shield-check, dice, filter-off; the circled "i" is drawn for Happow.
  ticketPaid:
    'M15 5l0 2M15 11l0 2M15 17l0 2M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-3a2 2 0 0 0 0 -4v-3a2 2 0 0 1 2 -2',
  ticketFree:
    'M15 5v2M15 17v2M9 5h10a2 2 0 0 1 2 2v3a2 2 0 1 0 0 4v3m-2 2h-14a2 2 0 0 1 -2 -2v-3a2 2 0 1 0 0 -4v-3a2 2 0 0 1 2 -2M3 3l18 18',
  world:
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18',
  plusCircle: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 8v8M8 12h8',
  infoCircle: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 8h.01M12 11v5.5',
  gear: 'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  shield:
    'M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06M15 19l2 2l4 -4',
  dice: 'M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  // Nothing to roll (owner, 2026-10-23): a crossed O.
  none: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM5 19L19 5',
  // The atlas row (§6, docs/design/atlas.html): Tabler download, upload, trash; the folded map
  // with a lit spot is drawn for Happow (AtlasGlyph in AtlasRow).
  download: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2M7 11l5 5l5 -5M12 4l0 12',
  upload: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2M7 9l5 -5l5 5M12 4l0 12',
  trash:
    'M4 7l16 0M10 11l0 6M14 11l0 6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
  filterOff:
    'M8 4h12v2.172a2 2 0 0 1 -.586 1.414l-3.914 3.914m-.5 3.5v4l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227M3 3l18 18',
  // The admin's ready email (M8 slice F, docs/design/admin.html): Tabler copy, both paths as is.
  copy: 'M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  filled = false,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Walking minutes next to a number ("6 min" on the reach pill). */
export function WalkIcon() {
  return <Icon name="walk" size={14} />;
}

/**
 * Time-range icons, exactly as `docs/design/icons/range-*.svg`: a calendar with one filled day
 * (Today), one filled row (7 days) or two filled rows (14 days). Decorative: callers provide the
 * accessible name.
 */
export function RangeIcon({ rows, size = 22 }: { rows: 0 | 1 | 2; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v3.5M16 3v3.5M3.5 9.5h17" />
      {rows === 0 && (
        <rect
          x="6.6"
          y="12.4"
          width="3.8"
          height="3.8"
          rx="0.9"
          fill="currentColor"
          stroke="none"
        />
      )}
      {rows === 1 && <path d="M7 14h10" strokeWidth={3} />}
      {rows === 2 && <path d="M7 13h10M7 17h10" strokeWidth={3} />}
    </svg>
  );
}

/** A category glyph from the shared set (glyphs.ts). Decorative: callers provide the name. */
export function Glyph({
  id,
  size = 20,
  strokeWidth = 2,
}: {
  id: string;
  size?: number;
  /** In 24-grid units: 2 suits icon sizes; large glyphs need less to keep the line weight. */
  strokeWidth?: number;
}) {
  const g: GlyphDef = GLYPHS[isGlyphId(id) ? id : 'dot'];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill={g.fill ? 'currentColor' : 'none'}
      stroke={g.fill ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {g.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The same glyph as an SVG string, for elements built outside React (map markers). */
export function glyphSvg(id: string, size: number): string {
  const g: GlyphDef = GLYPHS[isGlyphId(id) ? id : 'dot'];
  const paint = g.fill
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${paint}>${g.paths
    .map((d) => `<path d="${d}"/>`)
    .join('')}</svg>`;
}
