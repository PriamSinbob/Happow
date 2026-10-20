/**
 * Runs due sources once. Meant for a cron (GitHub Actions every 15 min) or by hand:
 *   pnpm ingest                       run every due source
 *   pnpm ingest --source ticketmaster --force
 *   pnpm ingest --dry-run             fetch + normalize, print, write nothing (no DATABASE_URL needed)
 *   pnpm ingest --record <dir>        also save response bodies as test fixtures
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { loadConfig } from '@happow/core';
import { runIngest } from './run.js';
import { EventStore } from './store.js';

const { values } = parseArgs({
  options: {
    source: { type: 'string', multiple: true },
    region: { type: 'string', multiple: true },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    record: { type: 'string' },
  },
});

const config = loadConfig();
const dryRun = values['dry-run'];
let client: pg.Client | null = null;
if (!dryRun) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (or use --dry-run)');
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('set search_path = public, extensions');
}

const counters = new Map<string, number>();
const recordDir = values.record;
const onResponse = recordDir
  ? (sourceId: string, _url: string, body: string) => {
      // Never write OAuth token responses to disk.
      if (/"access_token"/.test(body)) return;
      const n = counters.get(sourceId) ?? 0;
      counters.set(sourceId, n + 1);
      mkdirSync(join(recordDir, sourceId), { recursive: true });
      const pretty = JSON.stringify(JSON.parse(body), null, 2).replace(
        /(apikey=)[^&"]+/gi,
        '$1REDACTED',
      );
      writeFileSync(join(recordDir, sourceId, `page-${n}.json`), pretty + '\n');
    }
  : undefined;

try {
  const summaries = await runIngest({
    config,
    env: process.env,
    store: client ? new EventStore(client) : null,
    sourceIds: values.source,
    regionIds: values.region,
    force: values.force || dryRun,
    onResponse,
  });
  if (dryRun)
    for (const s of summaries)
      for (const { event } of s.events ?? [])
        console.log(
          `  ${event.startAt.slice(0, 16)} ${event.categoryIds.join('/')} · ${event.title} @ ${event.venue?.name ?? '?'}`,
        );
  if (summaries.some((s) => s.status === 'failed')) process.exitCode = 1;
} finally {
  await client?.end();
}
