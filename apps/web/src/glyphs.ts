/*! Category glyphs. The full notice ships as /third-party-licenses.txt. Several are from Tabler Icons (https://tabler.io/icons), MIT License,
 * Copyright (c) 2020-2026 Paweł Kuna. Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights to use, copy,
 * modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following
 * conditions: The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT
 * WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
 * OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * The category glyph set, chosen by the owner on 2026-10-23: one source for the map pins (drawn
 * into SDF sprites) and for icons in cards and lists (inline SVG). Each glyph is SVG path data on
 * a 24-unit grid, stroked 2 units wide with round caps and joins; `fill` glyphs are filled.
 * `from` names the Tabler icon a glyph comes from; the others are drawn for Happow.
 */
export interface Glyph {
  paths: readonly string[];
  fill?: boolean;
  from?: string;
}

export const GLYPHS = {
  note: {
    from: 'music',
    paths: [
      'M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
      'M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
      'M9 17v-13h10v13',
      'M9 8h10',
    ],
  },
  mask: {
    from: 'masks-theater',
    paths: [
      'M13.192 9h6.616a2 2 0 0 1 1.992 2.183l-.567 6.182a4 4 0 0 1 -3.983 3.635h-1.5a4 4 0 0 1 -3.983 -3.635l-.567 -6.182a2 2 0 0 1 1.992 -2.183',
      'M15 13h.01',
      'M18 13h.01',
      'M15 16.5c1 .667 2 .667 3 0',
      'M8.632 15.982a4.037 4.037 0 0 1 -.382 .018h-1.5a4 4 0 0 1 -3.983 -3.635l-.567 -6.182a2 2 0 0 1 1.992 -2.183h6.616a2 2 0 0 1 2 2',
      'M6 8h.01',
      'M9 8h.01',
      'M6 12c.764 -.51 1.528 -.63 2.291 -.36',
    ],
  },
  film: {
    from: 'movie',
    paths: [
      'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12',
      'M8 4l0 16',
      'M16 4l0 16',
      'M4 8l4 0',
      'M4 16l4 0',
      'M4 12l16 0',
      'M16 8l4 0',
      'M16 16l4 0',
    ],
  },
  frame: {
    from: 'photo',
    paths: [
      'M15 8h.01',
      'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12',
      'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5',
      'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3',
    ],
  },
  confetti: {
    from: 'confetti',
    paths: [
      'M4 5h2',
      'M5 4v2',
      'M11.5 4l-.5 2',
      'M18 5h2',
      'M19 4v2',
      'M15 9l-1 1',
      'M18 13l2 -.5',
      'M18 19h2',
      'M19 18v2',
      'M14 16.518l-6.518 -6.518l-4.39 9.58a1 1 0 0 0 1.329 1.329l9.579 -4.39',
    ],
  },
  spark: {
    from: 'sparkles',
    paths: [
      'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6',
    ],
  },
  run: {
    from: 'run',
    paths: [
      'M11.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M4 17l5 1l.75 -1.5',
      'M15 21v-4l-4 -3l1 -6',
      'M7 12v-3l5 -1l3 3l3 1',
    ],
  },
  basket: {
    from: 'basket',
    paths: [
      'M10 14a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
      'M5.001 8h13.999a2 2 0 0 1 1.977 2.304l-1.255 7.152a3 3 0 0 1 -2.966 2.544h-9.512a3 3 0 0 1 -2.965 -2.544l-1.255 -7.152a2 2 0 0 1 1.977 -2.304',
      'M17 10l-2 -6',
      'M7 10l2 -6',
    ],
  },
  tag: {
    paths: ['M3 3h9l9 9l-9 9l-9 -9z', 'M6.5 8a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0'],
  },
  horse: {
    from: 'horse-toy',
    paths: [
      'M3.5 17.5c5.667 4.667 11.333 4.667 17 0',
      'M19 18.5l-2 -8.5l1 -2l2 1l1.5 -1.5l-2.5 -4.5c-5.052 .218 -5.99 3.133 -7 6h-6a3 3 0 0 0 -3 3',
      'M5 18.5l2 -9.5',
      'M8 20l2 -5h4l2 5',
    ],
  },
  utensils: {
    from: 'tools-kitchen-2',
    paths: [
      'M19 3v12h-5c-.023 -3.681 .184 -7.406 5 -12m0 12v6h-1v-3m-10 -14v17m-3 -17v3a3 3 0 1 0 6 0v-3',
    ],
  },
  cup: {
    paths: ['M4 9h12l-1 11h-10z', 'M16 11q5 0 4 4q-1 2 -4.5 2', 'M8 3v3', 'M12 3v3'],
  },
  beer: {
    paths: [
      'M5 9h10v10a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2z',
      'M15 11h2a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-2',
      'M5 9a2.5 2.5 0 0 1 2.5 -3.5a3 3 0 0 1 5 0a2.5 2.5 0 0 1 2.5 3.5',
      'M8.5 12.5v5',
      'M11.5 12.5v5',
    ],
  },
  mic: {
    paths: ['M9 7a3 3 0 0 1 6 0v5a3 3 0 0 1 -6 0z', 'M6 11q0 6.5 6 6.5q6 0 6 -6.5', 'M12 17.5v3.5'],
  },
  candle: {
    paths: ['M8.5 10h7v11h-7z', 'M12 10v-2', 'M12 2.5q3.5 3.5 0 5q-3.5 -1.5 0 -5'],
  },
  dot: { fill: true, paths: ['M8.5 12a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0'] },
} as const satisfies Record<string, Glyph>;

export type GlyphId = keyof typeof GLYPHS;
export const GLYPH_IDS = Object.keys(GLYPHS) as GlyphId[];

export function isGlyphId(id: string): id is GlyphId {
  return Object.hasOwn(GLYPHS, id);
}

/** Draws a glyph on a canvas already scaled to the 24-unit grid. */
export function drawGlyph(c: CanvasRenderingContext2D, id: GlyphId) {
  const g: Glyph = GLYPHS[id];
  for (const d of g.paths) {
    const p = new Path2D(d);
    if (g.fill) c.fill(p);
    else c.stroke(p);
  }
}
