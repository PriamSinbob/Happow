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
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  filled = false,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
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
