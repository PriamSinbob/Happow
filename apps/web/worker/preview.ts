import { eventGlyph, type ThemeConfig } from '@happow/core';
import type { Outline, PreviewData } from '@happow/api';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { GLYPHS, isGlyphId, type Glyph } from '../src/glyphs';

/**
 * The shared-link preview image (M9 §2): our own 1200×630 card, never the source's picture. A
 * map drawn from the district outlines around the event (owner's answer to §9.1, so no tile
 * service), the pin with the category glyph, the category, title, day and time, and venue. No
 * prices and no counts. Built as SVG and turned into a PNG by resvg (WebAssembly).
 */
export const PREVIEW_W = 1200;
export const PREVIEW_H = 630;

/** The map panel on the right, and how many metres its half-width shows. */
const MAP_X = 720;
const MAP_HALF_M = 1100;
const PAD = 64;
const TEXT_W = MAP_X - PAD * 2;
const TITLE_PX = 54;
const TITLE_LINES = 2;

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Rough width of text in Inter, in ems: enough to wrap a title without a text engine. */
function emWidth(text: string, bold: boolean): number {
  let w = 0;
  for (const ch of text) {
    if (/[ilj.,:;'|!]/.test(ch)) w += 0.28;
    else if (/[ frt()\-]/.test(ch)) w += 0.36;
    else if (/[mwMW@]/.test(ch)) w += 0.9;
    else if (/[A-ZĄĆĘŁŃÓŚŹŻ0-9]/.test(ch)) w += 0.68;
    else w += 0.56;
  }
  return w * (bold ? 1.05 : 1);
}

/** Splits text into at most `max` lines of `widthPx`; the last one ends in "…" when cut. */
export function wrap(
  text: string,
  px: number,
  widthPx: number,
  max: number,
  bold = true,
): string[] {
  const fits = (s: string) => emWidth(s, bold) * px <= widthPx;
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    // A word wider than the line is cut where it stops fitting.
    while (!fits(line)) {
      let cut = line.length - 1;
      while (cut > 1 && !fits(line.slice(0, cut))) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  let last = lines[max - 1]!;
  while (last && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
  return [...lines.slice(0, max - 1), `${last}…`];
}

/** Projects lng/lat around the event onto the map panel (equirectangular, fine at city scale). */
function projector(center: { lat: number; lng: number }) {
  const cx = MAP_X + (PREVIEW_W - MAP_X) / 2;
  const cy = PREVIEW_H / 2;
  const pxPerM = (PREVIEW_W - MAP_X) / 2 / MAP_HALF_M;
  const kx = Math.cos((center.lat * Math.PI) / 180) * 111_320 * pxPerM;
  const ky = 110_574 * pxPerM;
  return {
    cx,
    cy,
    at: ([lng, lat]: number[]) =>
      `${(cx + (lng! - center.lng) * kx).toFixed(1)},${(cy - (lat! - center.lat) * ky).toFixed(1)}`,
  };
}

function outlinePath(o: Outline, at: (p: number[]) => string): string {
  const polys = (
    o.geometry.type === 'Polygon' ? [o.geometry.coordinates] : o.geometry.coordinates
  ) as number[][][][];
  return polys.flatMap((rings) => rings.map((ring) => `M${ring.map(at).join('L')}Z`)).join('');
}

function glyphSvg(id: string, x: number, y: number, size: number, color: string): string {
  const g: Glyph = GLYPHS[isGlyphId(id) ? id : 'dot'];
  const paint = g.fill
    ? `fill="${color}" stroke="none"`
    : `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" ${paint}>${g.paths
    .map((d) => `<path d="${d}"/>`)
    .join('')}</g>`;
}

export function previewSvg(d: PreviewData, theme: ThemeConfig): string {
  const c = theme.themes.day;
  const accent = d.category?.color ?? c.ink;
  const glyph = eventGlyph(d.category ?? undefined, [d.title, d.venue ?? '']);
  const map = projector(d.point);
  const here = d.outlines.find((o) => o.here);

  const title = wrap(d.title, TITLE_PX, TEXT_W, TITLE_LINES);
  const titleTop = 214;
  const lineH = Math.round(TITLE_PX * 1.15);
  const afterTitle = titleTop + (title.length - 1) * lineH;
  const venue = d.venue ? wrap(d.venue, 30, TEXT_W, 1, false)[0]! : null;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_W}" height="${PREVIEW_H}" viewBox="0 0 ${PREVIEW_W} ${PREVIEW_H}" font-family="Inter">
<rect width="${PREVIEW_W}" height="${PREVIEW_H}" fill="${c.paper}"/>
<clipPath id="map"><rect x="${MAP_X}" y="0" width="${PREVIEW_W - MAP_X}" height="${PREVIEW_H}"/></clipPath>
<g clip-path="url(#map)">
<rect x="${MAP_X}" y="0" width="${PREVIEW_W - MAP_X}" height="${PREVIEW_H}" fill="${c.land}"/>
${here ? `<path d="${outlinePath(here, map.at)}" fill="${accent}" fill-opacity="0.1" fill-rule="evenodd"/>` : ''}
${d.outlines
  .map(
    (o) =>
      `<path d="${outlinePath(o, map.at)}" fill="none" stroke="${o.here ? accent : c.muted}" stroke-opacity="${o.here ? 0.7 : 0.45}" stroke-width="${o.here ? 3 : 2}" stroke-linejoin="round"/>`,
  )
  .join('\n')}
<circle cx="${map.cx}" cy="${map.cy}" r="44" fill="${accent}" stroke="${c.raised}" stroke-width="7"/>
${glyphSvg(glyph, map.cx - 24, map.cy - 24, 48, c.raised)}
${here ? `<text x="${PREVIEW_W - 28}" y="${PREVIEW_H - 54}" text-anchor="end" font-size="24" font-weight="700" fill="${c.quiet}">${xml(here.name)}</text>` : ''}
${d.outlines.length ? `<text x="${PREVIEW_W - 28}" y="${PREVIEW_H - 24}" text-anchor="end" font-size="16" fill="${c.muted}">© OpenStreetMap</text>` : ''}
</g>
${glyphSvg(glyph, PAD, 84, 34, accent)}
${d.categoryLabel ? `<text x="${PAD + 48}" y="112" font-size="28" font-weight="700" fill="${accent}">${xml(d.categoryLabel)}</text>` : ''}
${title.map((t, i) => `<text x="${PAD}" y="${titleTop + i * lineH}" font-size="${TITLE_PX}" font-weight="700" fill="${c.ink}">${xml(t)}</text>`).join('\n')}
<text x="${PAD}" y="${afterTitle + 82}" font-size="36" fill="${c.ink}">${xml(d.when)}</text>
${venue ? `<text x="${PAD}" y="${afterTitle + 132}" font-size="30" fill="${c.quiet}">${xml(venue)}</text>` : ''}
<text x="${PAD}" y="${PREVIEW_H - 56}" font-size="36" font-weight="700" fill="${c.ink}">Happow</text>
</svg>`;
}

let ready: Promise<unknown> | null = null;

/** The SVG as a PNG. `wasm` is resvg's module; `fonts` are the bundled Inter files. */
export async function renderPng(
  svg: string,
  wasm: WebAssembly.Module | BufferSource,
  fonts: Uint8Array[],
): Promise<Uint8Array> {
  ready ??= initWasm(wasm);
  await ready;
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: PREVIEW_W },
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return r.render().asPng();
}
