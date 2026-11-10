import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runIngest } from '../src/run';
import { config } from './helpers';

/** Contract test of the osm-places job against an Overpass answer on disk; no live calls. */

const answer = JSON.parse(
  readFileSync(new URL('./fixtures/places/overpass-places.json', import.meta.url), 'utf8'),
);

describe('osm-places job (dry run)', () => {
  it('asks Overpass for the configured kinds and counts the places it can tell are open', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json(answer),
    );
    const [summary] = await runIngest({
      config,
      env: {},
      now: new Date('2026-11-09T12:00:00Z'),
      store: null,
      force: true,
      sourceIds: ['osm-places'],
      fetch: f as typeof fetch,
      sleep: async () => {},
      log: () => {},
    });
    // Named places of a configured kind: not the nameless restaurant, not the bank. Hours the
    // parser reads: not the café without any, not the seasonal beer garden.
    expect(summary).toMatchObject({
      sourceId: 'osm-places',
      status: 'ok',
      stats: { places: 6, withHours: 4 },
    });
    const query = new URLSearchParams(String(f.mock.calls[0]![1]!.body)).get('data')!;
    expect(query).toContain('nwr["amenity"~"^(restaurant|fast_food|');
    expect(query).toContain('nwr["tourism"~"^(gallery|museum)$"]["name"]');
  });
});
