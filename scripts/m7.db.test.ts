/**
 * Integration test for M7 against DATABASE_URL after `pnpm db:reset`: performers, the search
 * function and its trigram indexes (slice B), follow matching (D), the nationwide cache (E), and
 * synced follows with new-date alerts (G). It writes to auth.users, so it runs only on a local or
 * CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, normName } from '@happow/core';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);
const { search } = loadConfig().app;

describe.skipIf(!url || !local)('M7 in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  let user = '';
  const publish = (id: string, title: string, performers: object[], startH = 48, extra = {}) =>
    db.query(`select publish_event($1::jsonb)`, [
      JSON.stringify({
        regionId: 'wroclaw',
        sourceId: 'm7test',
        externalId: id,
        sourceUrl: null,
        venue: {
          id: `m7test:${tag}`,
          name: `Hala ${tag}`,
          address: null,
          point: { lat: 51.1069, lng: 17.0773 },
          h3r9: 'x',
          website: null,
        },
        event: {
          id,
          title,
          categoryIds: ['music'],
          startAt: new Date(Date.now() + startH * 3_600_000).toISOString(),
          endAt: new Date(Date.now() + (startH + 2) * 3_600_000).toISOString(),
          endEstimated: true,
          timezone: 'Europe/Warsaw',
          point: { lat: 51.1069, lng: 17.0773 },
          h3r9: 'x',
          isFree: false,
          status: 'scheduled',
          trust: 'api',
          performers,
          ...extra,
        },
      }),
    ]);
  const find = async (q: string) =>
    (
      await db.query<{ id: string; match: string; matched_performer: string | null }>(
        `select id, match, matched_performer from search_events($1, 'wroclaw', 51.1, 17.03,
           now(), now() + interval '60 days', 40, $2, $3)`,
        [q, search.minSimilarity, search.minWordSimilarity],
      )
    ).rows.filter((r) => r.id.startsWith(tag));

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    await db.query(`insert into sources (id, adapter, region_ids, schedule, trust_level)
      values ('m7test', 'seed', '{wroclaw}', '1h', 'api') on conflict (id) do nothing`);
    user = (
      await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        `ala-${tag}@example.org`,
      ])
    ).rows[0]!.id;
    await publish(`${tag}-dp`, 'Trasa 2026', [
      { name: 'Dawid Podsiadło', externalId: 'K8vZ9175Tr0' },
    ]);
    await publish(`${tag}-pod`, 'Podsiadło – tribute night', [], 72);
    await publish(
      `${tag}-kult`,
      'Koncert',
      [{ name: 'Kult' }, { name: 'kult' }, { name: 'X' }],
      24,
    );
    await publish(`${tag}-past`, `Dawid Podsiadło ${tag}`, [{ name: 'Dawid Podsiadło' }], -48);
    await db.query(`update events set end_at = start_at + interval '2 hours' where id = $1`, [
      `${tag}-past`,
    ]);
  });
  afterAll(async () => {
    await db.query('delete from events where id like $1', [`${tag}-%`]);
    await db.query('delete from venues where id = $1', [`m7test:${tag}`]);
    await db.query('delete from follow_lookups where attraction_id like $1', [`${tag}%`]);
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.end();
  });

  it('normalises names in SQL exactly as normName does', async () => {
    const names = ['Dawid Podsiadło', '  ŁÓDŹ   Żółć ', 'Mela Koteluk', 'Ńś Ęą Ćó'];
    const { rows } = await db.query<{ n: string }>(
      'select f_norm(x) as n from unnest($1::text[]) x',
      [names],
    );
    expect(rows.map((r) => r.n)).toEqual(names.map(normName));
  });

  it('publish_event writes performers once per name, in order', async () => {
    const { rows } = await db.query(
      `select name, norm, external_id from event_performers where event_id = any($1) order by event_id, ord`,
      [[`${tag}-dp`, `${tag}-kult`]],
    );
    expect(rows).toEqual([
      { name: 'Dawid Podsiadło', norm: 'dawid podsiadlo', external_id: 'K8vZ9175Tr0' },
      { name: 'Kult', norm: 'kult', external_id: null },
    ]);
  });

  it('finds the same event for "podsiadlo", "Podsiadło", "podsiadło dawid" and a typo (§10)', async () => {
    for (const q of ['podsiadlo', 'Podsiadło', 'podsiadło dawid', 'dawid podsiadlp', 'podsaidlo']) {
      const hits = await find(q);
      expect(hits[0], q).toMatchObject({ id: `${tag}-dp`, matched_performer: 'Dawid Podsiadło' });
    }
    // Performer matches rank above a title match; ended events are left out.
    expect((await find('podsiadlo')).map((r) => r.id)).toEqual([`${tag}-dp`, `${tag}-pod`]);
    expect((await find('Dawid Podsiadło'))[0]!.match).toBe('performer');
  });

  it('searches titles and venues too, and refuses one character', async () => {
    expect((await find(`hala ${tag}`)).length).toBeGreaterThanOrEqual(3);
    expect(await find('k')).toEqual([]);
  });

  it('uses the trigram indexes at realistic volume', async () => {
    // On a handful of rows the planner rightly scans; inside a rolled-back transaction, 20,000
    // synthetic names show the plan a full region gets.
    await db.query('begin');
    try {
      await db.query(
        `insert into event_performers (event_id, ord, name, norm)
         select $1, g, 'Band ' || g, 'band ' || md5(g::text) from generate_series(1, 20000) g`,
        [`${tag}-kult`],
      );
      await db.query(`select gin_clean_pending_list('event_performers_norm_trgm')`);
      await db.query('analyze event_performers');
      const plan = async (sql: string) =>
        (await db.query<{ 'QUERY PLAN': string }>(`explain ${sql}`)).rows
          .map((r) => r['QUERY PLAN'])
          .join('\n');
      expect(
        await plan(`select 1 from event_performers where norm operator(extensions.%) 'podsiadlo'`),
      ).toContain('event_performers_norm_trgm');
      expect(
        await plan(`select 1 from event_performers where 'podsiadlo' operator(extensions.<%) norm`),
      ).toContain('event_performers_norm_trgm');
      await db.query('set local enable_seqscan = off');
      expect(
        await plan(`select 1 from events where 'podsiadlo' operator(extensions.<%) search_text`),
      ).toContain('events_search_trgm');
    } finally {
      await db.query('rollback');
    }
  });

  it('keeps private events out of search and follow matches', async () => {
    await publish(`${tag}-priv`, 'Kult w ogrodzie', [{ name: 'Kult' }], 30);
    await db.query(`update events set visibility = 'private', owner_id = $2 where id = $1`, [
      `${tag}-priv`,
      user,
    ]);
    expect((await find('kult')).map((r) => r.id)).not.toContain(`${tag}-priv`);
    const { rows } = await db.query<{ id: string }>(
      `select id from follows_match('{kult}', '{}', 'wroclaw', null, null, now(), now() + interval '60 days', 100)`,
    );
    expect(rows.map((r) => r.id).filter((i) => i.startsWith(tag))).toEqual([`${tag}-kult`]);
    const snap = await db.query<{ performers: string[] }>(
      `select performers from events_area(51.1069, 17.0773, 500, now(), now() + interval '3 days') where id = $1`,
      [`${tag}-kult`],
    );
    expect(snap.rows[0]!.performers).toEqual(['Kult']);
  });

  it('matches follows by name or Ticketmaster id', async () => {
    const { rows } = await db.query<{ id: string; matched_external_id: string | null }>(
      `select id, matched_external_id from follows_match('{}', '{K8vZ9175Tr0}', 'wroclaw', null, null,
         now(), now() + interval '60 days', 100)`,
    );
    expect(rows.map((r) => r.id)).toEqual([`${tag}-dp`]);
  });

  it('caches nationwide lookups per attraction', async () => {
    await db.query(`select follow_lookups_put($1, '[{"id":"a"}]'::jsonb)`, [`${tag}A`]);
    const { rows } = await db.query<{ r: Record<string, { events: unknown[] }> }>(
      `select follow_lookups_get($1) as r`,
      [[`${tag}A`, `${tag}B`]],
    );
    expect(Object.keys(rows[0]!.r)).toEqual([`${tag}A`]);
  });

  it('syncs follows last-writer-wins, with tombstones', async () => {
    const sync = async (items: object[], max = 200) =>
      (
        await db.query<{ r: { norm: string; removed: boolean }[] }>(
          'select follows_sync($1, $2::jsonb, $3) as r',
          [user, JSON.stringify(items), max],
        )
      ).rows[0]!.r;
    await sync([
      { name: 'Kult', norm: 'kult', changedAt: '2026-11-01T10:00:00Z' },
      { name: 'Hey', norm: 'hey', changedAt: '2026-11-01T10:00:00Z' },
    ]);
    // An older change of another device loses; a newer removal wins.
    const out = await sync([
      { name: 'Kult', norm: 'kult', changedAt: '2026-10-01T10:00:00Z', removed: true },
      { name: 'Hey', norm: 'hey', changedAt: '2026-11-02T10:00:00Z', removed: true },
    ]);
    expect(Object.fromEntries(out.map((f) => [f.norm, f.removed]))).toEqual({
      kult: false,
      hey: true,
    });
    const capped = await sync(
      [{ name: 'Mela', norm: 'mela', changedAt: '2026-11-03T10:00:00Z' }],
      1,
    );
    expect(capped.filter((f) => !f.removed).map((f) => f.norm)).toEqual(['mela']);
  });

  it('queues an alert for a new date announced after the follow and switch-on', async () => {
    await db.query(`select follows_sync($1, $2::jsonb, 200)`, [
      user,
      JSON.stringify([
        { name: 'Dawid Podsiadło', norm: 'dawid podsiadlo', changedAt: new Date().toISOString() },
      ]),
    ]);
    await db.query('select follow_alerts_set($1, true)', [user]);
    // Stored before the switch-on: not new.
    await db.query('select follow_alerts_queue(48)');
    expect(
      (await db.query('select 1 from follow_alerts where user_id = $1', [user])).rowCount,
    ).toBe(0);
    await publish(
      `${tag}-new`,
      'Dawid Podsiadło – drugi koncert',
      [{ name: 'Dawid Podsiadło' }],
      100,
    );
    const n = (await db.query<{ n: number }>('select follow_alerts_queue(48) as n')).rows[0]!.n;
    expect(n).toBeGreaterThanOrEqual(1);
    const due = (
      await db.query<{ r: { eventId: string; performer: string }[] }>(
        'select follow_alerts_due(50) as r',
      )
    ).rows[0]!.r.filter((a) => a.eventId.startsWith(tag));
    expect(due).toEqual([
      expect.objectContaining({ eventId: `${tag}-new`, performer: 'Dawid Podsiadło' }),
    ]);
    // Exported with the account; switching off drops unsent alerts.
    const ex = (
      await db.query<{ r: { follows: { name: string }[]; followAlerts: { alerts: boolean } } }>(
        'select account_export($1) as r',
        [user],
      )
    ).rows[0]!.r;
    expect(ex.follows.map((f) => f.name)).toContain('Dawid Podsiadło');
    expect(ex.followAlerts.alerts).toBe(true);
    await db.query('select follow_alerts_set($1, false)', [user]);
    expect(
      (await db.query('select 1 from follow_alerts where user_id = $1 and sent_at is null', [user]))
        .rowCount,
    ).toBe(0);
  });

  it('keeps M7 tables away from anon', async () => {
    const { rows } = await db.query<{ t: string; ok: boolean }>(
      `select t, has_table_privilege('anon', t, 'select') as ok
       from unnest(array['account_follows', 'follow_alerts', 'follow_lookups', 'follow_settings']) t`,
    );
    expect(rows.every((r) => !r.ok)).toBe(true);
    const fn = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'follows_sync(uuid, jsonb, integer)', 'execute') as ok`,
    );
    expect(fn.rows[0]!.ok).toBe(false);
  });
});
