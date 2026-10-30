// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@happow/core';
import type { PreviewData } from '@happow/api';
import { PREVIEW_H, PREVIEW_W, previewSvg, renderPng, wrap } from '../worker/preview';

/** M9 slice B: the shared-link preview image. */

const config = loadConfig();
const music = config.categories.find((c) => c.id === 'music')!;
const DATA: PreviewData = {
  title: 'Koncert <Jazz> & "więcej" na Wyspie Słodowej z gośćmi specjalnymi i niespodzianką',
  when: 'sob., 31 paź, 19:00–21:30',
  venue: 'Klub Pod Kolumnami',
  category: music,
  categoryLabel: 'Muzyka',
  lang: 'pl',
  point: { lat: 51.11, lng: 17.03 },
  outlines: [
    {
      name: 'Stare Miasto',
      here: true,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [17.02, 51.105],
            [17.04, 51.105],
            [17.04, 51.115],
            [17.02, 51.115],
            [17.02, 51.105],
          ],
        ],
      },
    },
    {
      name: 'Nadodrze',
      here: false,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [17.02, 51.115],
              [17.04, 51.115],
              [17.03, 51.125],
              [17.02, 51.115],
            ],
          ],
        ],
      },
    },
  ],
  version: 'abc123',
};

const dir = 'node_modules/@resvg/resvg-wasm/';
const wasm = readFileSync(`${dir}index_bg.wasm`);
const fonts = ['Inter_400Regular.ttf', 'Inter_700Bold.ttf'].map(
  (f) => new Uint8Array(readFileSync(`worker/fonts/${f}`)),
);

describe('preview image (M9 slice B)', () => {
  it('cuts long titles to two lines with an ellipsis', () => {
    const lines = wrap(DATA.title, 54, 592, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(wrap('Krótki', 54, 592, 2)).toEqual(['Krótki']);
    // A word longer than the line is split rather than overflowing.
    expect(wrap('x'.repeat(80), 54, 592, 2).length).toBe(2);
  });

  it('escapes text and draws the glyph, the districts and the attribution', () => {
    const svg = previewSvg(DATA, config.theme);
    expect(svg).toContain('&lt;Jazz&gt; &amp;');
    expect(svg).toContain('&quot;więcej&quot;');
    expect(svg).not.toContain('<Jazz>');
    expect(svg).toContain('Muzyka');
    expect(svg).toContain('Stare Miasto');
    expect(svg).toContain('© OpenStreetMap');
    // The music glyph's path, in the category colour.
    expect(svg).toContain('M9 17v-13h10v13');
    expect(svg).toContain(music.color);
    // No prices, no counts.
    expect(svg).not.toMatch(/zł|PLN|\d+\+/);
  });

  it('leaves the map plain without districts', () => {
    const svg = previewSvg(
      { ...DATA, outlines: [], category: null, categoryLabel: null },
      config.theme,
    );
    expect(svg).not.toContain('OpenStreetMap');
    expect(svg).toContain('Happow');
  });

  it('renders a 1200×630 PNG', async () => {
    const t0 = performance.now();
    const png = await renderPng(previewSvg(DATA, config.theme), wasm, fonts);
    const first = performance.now() - t0;
    const t1 = performance.now();
    await renderPng(previewSvg(DATA, config.theme), wasm, fonts);
    const again = performance.now() - t1;
    expect([...png.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(PREVIEW_W);
    expect(view.getUint32(20)).toBe(PREVIEW_H);
    if (process.env.PREVIEW_OUT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.PREVIEW_OUT, png);
      console.log(
        `first ${first.toFixed(0)} ms, again ${again.toFixed(0)} ms, ${png.length} bytes`,
      );
    }
  });
});
