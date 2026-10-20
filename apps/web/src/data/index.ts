import { config, region } from '../config';
import type { EventRepository } from './repository';
import { SupabaseEventRepository } from './supabase';

// Seed files are data, picked by the region config's `seedFile` — no region names in code.
const seedFiles = import.meta.glob<{ default: unknown }>('../../../../data/seed/*.json');

function seedLoader(): () => Promise<unknown> {
  const key = Object.keys(seedFiles).find((k) => region.seedFile && k.endsWith(region.seedFile));
  if (!key) return async () => ({ region: region.id, venues: [], events: [] });
  return async () => (await seedFiles[key]!()).default;
}

export function createRepository(): EventRepository {
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = import.meta.env;
  if (url && key) return new SupabaseEventRepository(url, key);
  // The seed path pulls in h3-js; load it only when it is actually used.
  const repo = import('./static').then(
    ({ StaticEventRepository }) =>
      new StaticEventRepository(
        seedLoader(),
        region,
        config.categories,
        config.app.h3.eventResolution,
      ),
  );
  return {
    kind: 'static',
    near: async (q) => (await repo).near(q),
    byId: async (id, from) => (await repo).byId(id, from),
  };
}

export type { EventRepository };
