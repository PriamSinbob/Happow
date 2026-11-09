/**
 * Events read by id for the agenda, and the account's synced saved list. Writes to auth.users, so
 * local or CI only.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { local, tag, url } from './dbtest';

interface Entry {
  id: string;
  on: boolean;
  going: boolean;
  at: number;
}

describe.skipIf(!url || !local)('agenda and saved list in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  let user = '';
  let other = '';
  const event = (id: string, startH: number, hidden = false) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, hidden)
       values ($1, 'wroclaw', 'Test', '{music}', now() + make_interval(hours => $2),
         now() + make_interval(hours => $2 + 2), 'Europe/Warsaw', st_point(16.805, 51.205)::geography,
         'x', 'crawled', $3)`,
      [id, startH, hidden],
    );
  const sync = async (u: string, items: Entry[], keepDays = 30, max = 200) =>
    (
      await db.query<{ r: Entry[] }>(`select saved_sync($1, $2::jsonb, $3, $4) as r`, [
        u,
        JSON.stringify(items),
        keepDays,
        max,
      ])
    ).rows[0]!.r;
  const now = Date.now();

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    const add = async (name: string) =>
      (
        await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
          `${name}-${tag}@example.org`,
        ])
      ).rows[0]!.id;
    user = await add('ala');
    other = await add('ola');
    await event(`${tag}-soon`, 3);
    // 40 days ahead: beyond the map's 14-day snapshot.
    await event(`${tag}-far`, 40 * 24);
    await event(`${tag}-over`, -5);
    await event(`${tag}-hidden`, 1, true);
  });
  afterAll(async () => {
    await db.query('delete from events where id like $1', [`${tag}-%`]);
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.end();
  });

  it('reads listed events by id, ended and far ahead included, hidden and unknown left out', async () => {
    const { rows } = await db.query<{ id: string; distance_m: number | null }>(
      `select id, distance_m from events_by_ids($1, 51.205, 16.805)`,
      [[`${tag}-soon`, `${tag}-far`, `${tag}-over`, `${tag}-hidden`, `${tag}-nope`]],
    );
    expect(rows.map((r) => r.id)).toEqual([`${tag}-over`, `${tag}-soon`, `${tag}-far`]);
    expect(rows[0]!.distance_m).toBeLessThan(1);
    const anon = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'events_by_ids(text[], double precision, double precision)', 'execute') as ok`,
    );
    expect(anon.rows[0]!.ok).toBe(true);
  });

  it('merges a device list: latest change wins, a future time counts as now', async () => {
    const first = await sync(user, [
      { id: 'e1', on: true, going: true, at: now - 60_000 },
      { id: 'e2', on: true, going: false, at: now - 60_000 },
    ]);
    expect(first.map((e) => [e.id, e.on, e.going])).toEqual([
      ['e1', true, true],
      ['e2', true, false],
    ]);
    // An older removal of e1 loses; a newer removal of e2 wins; going without on is not stored.
    const second = await sync(user, [
      { id: 'e1', on: false, going: false, at: now - 120_000 },
      { id: 'e2', on: false, going: true, at: now - 1000 },
      { id: 'e3', on: true, going: false, at: now + 86_400_000 },
    ]);
    const by = Object.fromEntries(second.map((e) => [e.id, e]));
    expect(by.e1).toMatchObject({ on: true, going: true });
    expect(by.e2).toMatchObject({ on: false, going: false });
    expect(by.e3!.at).toBeLessThanOrEqual(Date.now() + 1000);
    // A pull (empty list) returns the same, and another account sees none of it.
    expect((await sync(user, [])).length).toBe(3);
    expect(await sync(other, [])).toEqual([]);
  });

  it('drops old removals and keeps the newest saved past the cap', async () => {
    await sync(other, [
      { id: 'old-removal', on: false, going: false, at: now - 40 * 86_400_000 },
      { id: 's1', on: true, going: false, at: now - 3000 },
      { id: 's2', on: true, going: false, at: now - 2000 },
      { id: 's3', on: true, going: false, at: now - 1000 },
    ]);
    const list = await sync(other, [], 30, 2);
    expect(list.map((e) => e.id)).toEqual(['s2', 's3']);
  });

  it('keeps the table and sync away from the public roles, and exports the list', async () => {
    const t = await db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'saved_events', 'select')
         or has_table_privilege('authenticated', 'saved_events', 'select') as ok`,
    );
    expect(t.rows[0]!.ok).toBe(false);
    const f = await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'saved_sync(uuid, jsonb, integer, integer)', 'execute') as ok`,
    );
    expect(f.rows[0]!.ok).toBe(false);
    const ex = await db.query<{ r: { saved: { eventId: string }[] } }>(
      `select account_export($1) as r`,
      [user],
    );
    expect(ex.rows[0]!.r.saved.map((s) => s.eventId).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('deletes the list with the account', async () => {
    await db.query('delete from auth.users where id = $1', [user]);
    const { rows } = await db.query('select 1 from saved_events where user_id = $1', [user]);
    expect(rows).toEqual([]);
  });
});
