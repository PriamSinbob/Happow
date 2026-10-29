import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { veilBox, type AtlasCell } from '@happow/core';
import { atlasStore, resetAtlasStore } from '../src/atlas/store';
import { useAtlas, type Atlas } from '../src/atlas/useAtlas';
import { drawVeil, type LitCell } from '../src/atlas/veil';
import { About } from '../src/components/About';
import { AtlasBar, CLEAR_HOLD_MS } from '../src/components/Atlas';
import { ThemeProvider } from '../src/theme';
import { config } from '../src/config';
import { I18nProvider } from '../src/i18n';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider initial="en">{children}</I18nProvider>
);
const rynek = { lat: 51.1085, lng: 17.0322 };
const nadodrze = { lat: 51.1163, lng: 17.0395 };
const cell = (id: string, opens = 1, arrivals = 0): AtlasCell => ({
  cell: id,
  opens,
  arrivals,
  lastSeen: '2026-10-23',
});

// jsdom has no canvas: the veil falls back to gradients, without logging an error.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetAtlasStore();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('atlas store (IndexedDB)', () => {
  it('puts, reads back and clears cells', async () => {
    expect(await atlasStore.all()).toEqual([]);
    expect(await atlasStore.put([cell('891e2040887ffff'), cell('891e2040897ffff', 2)])).toBe(true);
    await atlasStore.put([cell('891e2040887ffff', 3, 1)]);
    const all = await atlasStore.all();
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.cell === '891e2040887ffff')).toMatchObject({ opens: 3, arrivals: 1 });
    expect(await atlasStore.clear()).toBe(true);
    expect(await atlasStore.all()).toEqual([]);
  });

  it('never throws when storage is unavailable', async () => {
    // @ts-expect-error: no IndexedDB at all (some private modes)
    globalThis.indexedDB = undefined;
    resetAtlasStore();
    expect(await atlasStore.all()).toEqual([]);
    expect(await atlasStore.put([cell('891e2040887ffff')])).toBe(false);
  });
});

describe('recording (useAtlas)', () => {
  const mount = (position: { lat: number; lng: number } | null, accuracy: number | null) =>
    renderHook(({ p, a }) => useAtlas(p, a), { initialProps: { p: position, a: accuracy } });

  it('records an open once per cell per session, from precise fixes only', async () => {
    const h = mount(rynek, 20);
    await waitFor(() => expect(h.result.current.count).toBe(1), { timeout: 4000 });
    h.rerender({ p: { ...rynek, lng: rynek.lng + 0.0001 }, a: 15 });
    h.rerender({ p: nadodrze, a: 500 });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.result.current.count).toBe(1);
    h.rerender({ p: nadodrze, a: 30 });
    await waitFor(() => expect(h.result.current.count).toBe(2));
    const stored = await atlasStore.all();
    expect(stored.map((c) => c.opens)).toEqual([1, 1]);
    expect(h.result.current.lit?.every((c) => c.strength > 0)).toBe(true);
  });

  it('records arrivals strong, and keeps it on the device', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const h = mount(null, null);
    await waitFor(() => expect(h.result.current.lit).not.toBeNull(), { timeout: 4000 });
    act(() => h.result.current.arrive('e1', rynek));
    await waitFor(() => expect(h.result.current.count).toBe(1));
    act(() => h.result.current.arrive('e1', rynek));
    await new Promise((r) => setTimeout(r, 50));
    const [c] = await atlasStore.all();
    expect(c).toMatchObject({ opens: 0, arrivals: 1 });
    expect(h.result.current.lit![0]!.strength).toBeCloseTo(config.app.atlas.strength.arrival);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('imports by merging (twice changes nothing) and rejects other files', async () => {
    await atlasStore.put([cell('891e2040887ffff', 5)]);
    const h = mount(null, null);
    await waitFor(() => expect(h.result.current.count).toBe(1), { timeout: 4000 });
    const fixture = readFileSync(
      resolve(process.cwd(), '../../packages/core/test/fixtures/atlas-v1.json'),
      'utf8',
    );
    let added: number | null = null;
    await act(async () => {
      added = await h.result.current.importFile(new Blob([fixture]));
    });
    expect(added).toBe(3);
    expect(h.result.current.count).toBe(4);
    const merged = (await atlasStore.all()).find((c) => c.cell === '891e2040887ffff');
    expect(merged).toMatchObject({ opens: 5, arrivals: 1 });
    await act(async () => {
      added = await h.result.current.importFile(new Blob([fixture]));
    });
    expect(added).toBe(0);
    await act(async () => {
      added = await h.result.current.importFile(new Blob(['{"not":"an atlas"}']));
    });
    expect(added).toBeNull();
    await act(async () => {
      added = await h.result.current.importFile(new Blob(['not json']));
    });
    expect(added).toBeNull();
    await act(() => h.result.current.clear());
    expect(h.result.current.count).toBe(0);
    expect(await atlasStore.all()).toEqual([]);
  });
});

describe('the veil drawing', () => {
  const px = config.app.atlas.canvasPx;
  const box = veilBox(rynek, config.app.atlas.veilRadiusM);
  function stubCtx() {
    const calls = { fills: 0, rects: 0, ops: [] as string[] };
    const ctx = {
      canvas: { width: px, height: px },
      set globalCompositeOperation(v: string) {
        calls.ops.push(v);
      },
      fillStyle: '',
      clearRect: () => {},
      fillRect: () => calls.rects++,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      beginPath: () => {},
      arc: () => {},
      fill: () => calls.fills++,
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }
  const lit = (
    centre: { lat: number; lng: number },
    strength: number,
    id = '891e2040887ffff',
  ): LitCell => ({
    cell: id,
    centre,
    strength,
  });

  it('fills the veil colour, then cuts soft holes for each lit cell and the reach', () => {
    const { ctx, calls } = stubCtx();
    const holes = drawVeil(ctx, {
      box,
      colour: '#E6E6E4',
      cells: [lit(rynek, 0.35), lit(nadodrze, 0.85, '891e2040d57ffff'), lit(rynek, 0)],
      cellRadiusM: 200,
      reach: { centre: rynek, radiusM: 500 },
    });
    const blobs = config.app.atlas.blobsPerCell;
    expect(holes).toBe(2 * blobs + 6);
    expect(calls.fills).toBe(holes);
    expect(calls.rects).toBe(1);
    expect(calls.ops).toEqual(['source-over', 'destination-out', 'source-over']);
  });

  it('skips cells outside the canvas box', () => {
    const { ctx } = stubCtx();
    const far = { lat: rynek.lat + 0.5, lng: rynek.lng };
    const holes = drawVeil(ctx, {
      box,
      colour: '#000000',
      cells: [lit(far, 1)],
      cellRadiusM: 200,
      reach: { centre: rynek, radiusM: 500 },
    });
    expect(holes).toBe(6);
  });

  it('runs no JavaScript on pan or zoom: no map event handlers for the veil', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/atlas/veil.ts'), 'utf8');
    expect(src).not.toMatch(/\.on\(/);
    const map = readFileSync(resolve(process.cwd(), 'src/components/MapView.tsx'), 'utf8');
    expect(map).not.toMatch(/on\('(move|zoom)'[^)]*[Vv]eil/);
  });
});

describe('the atlas bar in About (§6)', () => {
  const stub = (): Atlas => ({
    lit: [],
    cellRadiusM: 200,
    count: 37,
    arrive: vi.fn(),
    exportFile: vi.fn(async () => true),
    importFile: vi.fn(async () => 3),
    clear: vi.fn(async () => {}),
  });

  it('sits whole inside About, with the theme and colour settings', () => {
    render(
      <ThemeProvider>
        <About atlas={stub()} onClose={vi.fn()} onModerate={vi.fn()} onOpenEvent={vi.fn()} />
      </ThemeProvider>,
      { wrapper },
    );
    expect(screen.getByRole('img', { name: /37 areas/ })).toBeTruthy();
    // Signed out: export and import need an account (M8 §6); forgetting never does.
    expect(screen.queryByRole('button', { name: /save my places/i })).toBeNull();
    expect(screen.getByRole('button', { name: /forget my places/i })).toBeTruthy();
  });

  it('is wordless, with translated names on every button', () => {
    render(<AtlasBar atlas={stub()} transfer />, { wrapper });
    expect(screen.getByRole('img', { name: /37 areas/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /save my places/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /add places/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /forget my places/i })).toBeTruthy();
  });

  it('exports, and imports a picked file with a +N toast', async () => {
    const a = stub();
    render(<AtlasBar atlas={a} transfer />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /save my places/i }));
    expect(a.exportFile).toHaveBeenCalled();
    const input = screen.getByTestId('atlas-file') as HTMLInputElement;
    const file = new File(['{}'], 'happow-atlas-2026-10-23.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(a.importFile).toHaveBeenCalledWith(file);
    expect(await screen.findByText(/added 3 areas/i)).toBeTruthy();
  });

  it('clears only after a full hold', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const a = stub();
    render(<AtlasBar atlas={a} transfer />, { wrapper });
    const bin = screen.getByRole('button', { name: /forget my places/i });
    fireEvent.pointerDown(bin);
    act(() => vi.advanceTimersByTime(CLEAR_HOLD_MS / 2));
    fireEvent.pointerUp(bin);
    act(() => vi.advanceTimersByTime(CLEAR_HOLD_MS));
    expect(a.clear).not.toHaveBeenCalled();
    fireEvent.pointerDown(bin);
    act(() => vi.advanceTimersByTime(CLEAR_HOLD_MS + 50));
    expect(a.clear).toHaveBeenCalledTimes(1);
  });
});
