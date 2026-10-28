/**
 * Integration test for M12 slice E against DATABASE_URL after `pnpm db:reset`: the contributions
 * ledger (once per submission, the monthly cap, stacking after premium, duplicates, revoking),
 * trust, counts, levels and the public credit. It writes to auth.users, so it runs only on a local
 * or CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);
const MONTH = '2026-11-01';
const ORDER = ['neighbour', 'local', 'guide', 'cityGuide'];

describe.skipIf(!url || !local)('M12 contributions in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const fn = async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0]!.r;
  let user = '';
  const submission = async (status = 'approved', eventId: string | null = null) => {
    const id = randomUUID();
    await db.query(
      `insert into submissions (id, kind, status, submitter_hash, user_id, event_id, reviewed_at)
       values ($1, 'user', $2::submission_status, $3, $4, $5,
         case when $2::submission_status <> 'pending' then now() end)`,
      [id, status, `hash-${tag}`, user, eventId],
    );
    return id;
  };
  const award = (id: string, dup: string | null = null, notBefore: string | null = null) =>
    fn<{ kind: string; days: number; startsAt: string | null } | null>(
      'contribution_award($1, $2, 3, 30, $3, $4)',
      [id, dup, MONTH, notBefore],
    );

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    user = (
      await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        `ala-${tag}@example.org`,
      ])
    ).rows[0]!.id;
  });
  afterAll(async () => {
    await db.query('delete from submissions where submitter_hash = $1', [`hash-${tag}`]);
    await db.query('delete from events where id like $1', [`${tag}-%`]);
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.end();
  });

  it('rewards a submission once, stacking days after the promotion and earlier days', async () => {
    const a = await submission();
    const promoEnd = '2099-12-01T00:00:00.000Z';
    const first = await award(a, null, promoEnd);
    expect(first).toMatchObject({ kind: 'verified', days: 3 });
    expect(new Date(first!.startsAt!).toISOString()).toBe(promoEnd);
    expect(await award(a)).toBeNull();
    // The next days start where the last ones end.
    const second = await award(await submission(), null, promoEnd);
    expect(new Date(second!.startsAt!).toISOString()).toBe('2099-12-04T00:00:00.000Z');
    const g = await db.query(
      `select source, plan from plan_grants where user_id = $1 order by starts_at`,
      [user],
    );
    expect(g.rows).toEqual([
      { source: 'contribution', plan: 'premium' },
      { source: 'contribution', plan: 'premium' },
    ]);
  });

  it('stops at the monthly cap and gives a duplicate nothing', async () => {
    for (let i = 0; i < 8; i++) await award(await submission());
    // 10 awards × 3 days = 30: the cap.
    expect(
      await fn<number>(
        `(select sum(days)::int from contributions where user_id = $1 and month = $2)`,
        [user, MONTH],
      ),
    ).toBe(30);
    expect(await award(await submission())).toMatchObject({ kind: 'verified', days: 0 });
    expect(await award(await submission(), 'ticketmaster:1')).toMatchObject({
      kind: 'duplicate',
      days: 0,
    });
  });

  it('takes back days not yet started when an event turns out wrong, and keeps started ones', async () => {
    const later = await submission();
    await db.query(`delete from contributions where user_id = $1`, [user]);
    await db.query(`delete from plan_grants where user_id = $1`, [user]);
    await award(later, null, '2099-12-01T00:00:00Z');
    expect(await fn<number>('contribution_revoke($1)', [later])).toBe(3);
    expect(await fn<number>('contribution_revoke($1)', [later])).toBe(0);
    const started = await submission();
    await award(started);
    await db.query(
      `update plan_grants set starts_at = now() - interval '1 day' where user_id = $1`,
      [user],
    );
    expect(await fn<number>('contribution_revoke($1)', [started])).toBe(0);
    expect((await db.query(`select 1 from plan_grants where user_id = $1`, [user])).rowCount).toBe(
      1,
    );
  });

  it('trusts after enough approved events; a rejection removes it until the admin restores it', async () => {
    expect(await fn<boolean>('contributor_trusted($1, 5)', [user])).toBe(true);
    expect(await fn<boolean>('contributor_trusted($1, 500)', [user])).toBe(false);
    await submission('rejected');
    expect(await fn<boolean>('contributor_trusted($1, 5)', [user])).toBe(false);
    expect(await fn<boolean>('trust_restore($1)', [`ALA-${tag}@example.org`])).toBe(true);
    expect(await fn<boolean>('contributor_trusted($1, 5)', [user])).toBe(true);
    expect(await fn<boolean>('trust_restore($1)', ['nobody@example.org'])).toBe(false);
  });

  it('adds counts per event and day, skipping unknown events', async () => {
    const id = `${tag}-ev`;
    await db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust)
       values ($1, 'wroclaw', 'Test', '{music}', now(), now() + interval '1 hour', 'Europe/Warsaw',
         st_point(17.03, 51.11)::geography, 'x', 'community')`,
      [id],
    );
    const items = JSON.stringify([
      { eventId: id, opens: 2, routes: 0, arrivals: 1 },
      { eventId: 'no-such-event', opens: 5 },
    ]);
    expect(await fn<number>(`counts_add($1::jsonb, '2026-11-02')`, [items])).toBe(1);
    await fn(`counts_add($1::jsonb, '2026-11-02')`, [items]);
    const row = await db.query(
      `select opens, routes, arrivals from event_counts where event_id = $1`,
      [id],
    );
    expect(row.rows).toEqual([{ opens: 4, routes: 0, arrivals: 2 }]);
  });

  it('stores levels only upwards and shows the credit only when switched on', async () => {
    expect(await fn<string>('contributor_level_set($1, $2, $3)', [user, 'local', ORDER])).toBe(
      'local',
    );
    expect(
      await fn<string | null>('contributor_level_set($1, $2, $3)', [user, 'neighbour', ORDER]),
    ).toBe(null);
    expect(
      (await db.query('select level from profiles where user_id = $1', [user])).rows[0].level,
    ).toBe('local');

    const id = `${tag}-ev`;
    await submission('approved', id);
    expect(await fn('event_credit($1)', [id])).toBeNull();
    await fn('profile_prefs($1, true, $2)', [user, 'Ala']);
    expect(await fn('event_credit($1)', [id])).toEqual({ name: 'Ala', level: 'local' });
    await fn('profile_prefs($1, false, null)', [user]);
    expect(await fn('event_credit($1)', [id])).toBeNull();
  });

  it('lets a moderator reject a trusted publication: hidden, rewarded no more, trust gone', async () => {
    const id = randomUUID();
    await db.query(
      `insert into submissions (id, kind, status, submitter_hash, user_id, event_id, reviewed_at, reviewed_by)
       values ($1, 'user', 'approved', $2, $3, $4, now(), 'trusted')`,
      [id, `hash-${tag}`, user, `${tag}-ev`],
    );
    await fn('trust_restore($1)', [`ala-${tag}@example.org`]);
    await award(id);
    expect((await fn<{ id: string }[]>('trusted_recent(7)')).some((s) => s.id === id)).toBe(true);
    await fn(`moderate_trusted($1, null, 'mod@example.org')`, [id]);
    const ev = await db.query('select hidden from events where id = $1', [`${tag}-ev`]);
    expect(ev.rows[0].hidden).toBe(true);
    expect(
      (await db.query('select revoked_at from contributions where submission_id = $1', [id]))
        .rows[0].revoked_at,
    ).not.toBeNull();
    expect(await fn<boolean>('contributor_trusted($1, 5)', [user])).toBe(false);
    await expect(db.query(`select moderate_trusted($1, null, 'x')`, [id])).rejects.toMatchObject({
      code: 'P0001',
    });
  });
});
