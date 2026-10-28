import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@happow/core';
import { dueForDispatch } from '@happow/ingest/schedule';
import { createApi, dispatchDueIngest } from '../src';
import { scheduleConfig } from '../src/schedule';

const config = loadConfig();
const SB = 'https://proj.supabase.co';
const now = new Date('2026-10-24T12:00:00Z');
const env = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
  GITHUB_DISPATCH_TOKEN: 'gh',
};
const okRow = (source_id: string, started_at = '2026-10-24T11:50:00Z') => ({
  source_id,
  region_id: 'wroclaw',
  started_at,
  status: 'ok',
});
const allFresh = [
  'ticketmaster',
  'meetup',
  'ebilet',
  'wroclaw-go',
  'nfm',
  'osm-venues',
  'venue-probe',
  'venue-sites',
].map((id) => okRow(id));

function fake(rows: unknown[], dispatchStatus = 204) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(`${SB}/rest/v1/source_runs?`)) return Response.json(rows);
    if (url.startsWith('https://api.github.com/') && !url.endsWith('/dispatches'))
      return Response.json({ id: 1, name: 'Ingest sources' });
    if (url.startsWith('https://api.github.com/'))
      return new Response(dispatchStatus === 204 ? null : '{"message":"Bad credentials"}', {
        status: dispatchStatus,
      });
    throw new Error(`unexpected ${url} ${init.method ?? 'GET'}`);
  });
}

describe('dispatchDueIngest', () => {
  it('does not start the workflow when nothing is due', async () => {
    const f = fake(allFresh);
    const r = await dispatchDueIngest(env, now, { fetch: f, config });
    expect(r).toEqual({ due: [], dispatched: false, tokenSet: true });
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(String(f.mock.calls[0]![0]));
    // A week and an hour back: the weekly OSM venues job is the longest schedule.
    expect(url.searchParams.get('started_at')).toBe('gte.2026-10-17T11:00:00.000Z');
  });

  it('dispatches the configured workflow when a source is due', async () => {
    const f = fake(allFresh.filter((r) => r.source_id !== 'nfm'));
    const r = await dispatchDueIngest(env, now, { fetch: f, config });
    expect(r).toEqual({ due: ['nfm@wroclaw'], dispatched: true, tokenSet: true });
    const [url, init] = f.mock.calls[1]!;
    expect(String(url)).toBe(
      'https://api.github.com/repos/PriamSinbob/happow/actions/workflows/ingest.yml/dispatches',
    );
    expect(init!.method).toBe('POST');
    expect(JSON.parse(String(init!.body))).toEqual({ ref: 'main' });
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer gh');
    // New-style secret keys go in apikey only, never as a bearer token.
    expect(new Headers(f.mock.calls[0]![1]!.headers).get('authorization')).toBeNull();
  });

  it('reports a missing token instead of failing the cron', async () => {
    const f = fake([]);
    const r = await dispatchDueIngest({ ...env, GITHUB_DISPATCH_TOKEN: undefined }, now, {
      fetch: f,
      config,
    });
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe('GITHUB_DISPATCH_TOKEN not set');
    expect(r.tokenSet).toBe(false);
    expect(r.due.length).toBeGreaterThan(0);
  });

  it('fails loudly when GitHub refuses the dispatch', async () => {
    const f = fake([], 401);
    await expect(dispatchDueIngest(env, now, { fetch: f, config })).rejects.toThrow(
      'workflow dispatch failed: 401',
    );
  });

  it('does nothing without database credentials', async () => {
    const f = fake([]);
    const r = await dispatchDueIngest({}, now, { fetch: f, config });
    expect(r.dispatched).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('plans the same runs from the raw JSON as from the validated config', () => {
    const policy = config.app.ingest.dispatch;
    for (const at of ['2026-10-24T12:00:00Z', '2026-10-25T03:00:00Z']) {
      const t = new Date(at);
      expect(dueForDispatch(scheduleConfig(), [], t, policy)).toEqual(
        dueForDispatch(config, [], t, policy),
      );
    }
  });

  it('dry run reports what is due without dispatching', async () => {
    const f = fake(allFresh.filter((r) => r.source_id !== 'nfm'));
    const r = await dispatchDueIngest(env, now, { fetch: f, config }, { dryRun: true });
    expect(r).toEqual({
      due: ['nfm@wroclaw'],
      dispatched: false,
      tokenSet: true,
      reason: 'dry run',
      tokenCheck: { status: 200 },
    });
    // The workflow is read with the token, never dispatched.
    const urls = f.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.endsWith('/dispatches'))).toEqual([]);
    expect(urls).toContain(
      'https://api.github.com/repos/PriamSinbob/happow/actions/workflows/ingest.yml',
    );
  });

  it('dry run passes on GitHub’s reason when the token cannot see the workflow', async () => {
    const f = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith(SB)
        ? Response.json([])
        : Response.json({ message: 'Bad credentials' }, { status: 401 }),
    );
    const r = await dispatchDueIngest(env, now, { fetch: f, config }, { dryRun: true });
    expect(r.tokenCheck).toEqual({ status: 401, message: 'Bad credentials' });
  });

  it('serves the dry run at GET /api/ingest/status without exposing the token', async () => {
    const f = fake(allFresh.filter((r) => r.source_id !== 'nfm'));
    const api = createApi(env, { fetch: f, config, now: () => now });
    const res = await api(new Request('https://app.test/api/ingest/status'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({
      due: ['nfm@wroclaw'],
      dispatched: false,
      tokenSet: true,
    });
    expect(body).not.toContain(env.GITHUB_DISPATCH_TOKEN === 'gh' ? '"gh"' : 'x');
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/dispatches'))).toBe(false);
  });
});
