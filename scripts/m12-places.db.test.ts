/**
 * Integration test for M12 slice M against DATABASE_URL after `pnpm db:reset`: "first added by
 * you" for a place where nothing happened lately, and thanks from visitors, once per device and
 * only for events people added. It writes to auth.users, so it runs only on a local or CI
 * database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);

describe.skipIf(!url || !local)('M12 places first and thanks in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const fn = async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0]!.r;
  let user = '';
  // A quiet spot well outside the city centre's events.
  const spot = { lat: 51.0412, lng: 16.9101 };

  const event = async (id: string, trust: string, endsIn: string, at = spot) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust)
       values ($1, 'wroclaw', 'Test', '{music}', now() + $2::interval - interval '1 hour',
         now() + $2::interval, 'Europe/Warsaw', st_point($3, $4)::geography, 'x', $5)`,
      [id, endsIn, at.lng, at.lat, trust],
    );
  const submission = async (eventId: string | null, at = spot) => {
    const id = randomUUID();
    await db.query(
      `insert into submissions (id, kind, status, submitter_hash, user_id, event_id, extracted_payload)
       values ($1, 'user', 'pending', $2, $3, $4, $5)`,
      [id, `hash-${tag}`, user, eventId, { event: { point: at } }],
    );
    return id;
  };
  const mark = (id: string) => fn<boolean>('first_place_mark($1, 75, 90)', [id]);

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

  it('marks the first event at a quiet place, and not one next to a recent or coming event', async () => {
    await event(`${tag}-own`, 'community', '2 days');
    const first = await submission(`${tag}-own`);
    // Its own event doesn't count.
    expect(await mark(first)).toBe(true);
    // An event 30 m away that ended 10 days ago makes the place not quiet.
    const near = { lat: spot.lat + 0.00027, lng: spot.lng };
    await event(`${tag}-past`, 'crawled', '-10 days', near);
    expect(await mark(await submission(null))).toBe(false);
    // 120 days ago, or 500 m away, is quiet again.
    const far = { lat: spot.lat + 0.0045, lng: spot.lng };
    expect(await mark(await submission(null, far))).toBe(true);
    const card = await fn<{ events: { submissionId: string; firstPlace: boolean }[] }>(
      `contributions_get($1, '2026-11-01', 5)`,
      [user],
    );
    expect(card.events.find((e) => e.submissionId === first)?.firstPlace).toBe(true);
  });

  it('counts thanks once per device, only for events people added, for the adder only', async () => {
    await event(`${tag}-crawled`, 'crawled', '3 hours');
    expect(await fn<boolean>('thanks_add($1, $2)', [`${tag}-own`, 'device-a'])).toBe(true);
    expect(await fn<boolean>('thanks_add($1, $2)', [`${tag}-own`, 'device-a'])).toBe(false);
    expect(await fn<boolean>('thanks_add($1, $2)', [`${tag}-own`, 'device-b'])).toBe(true);
    await expect(
      db.query('select thanks_add($1, $2)', [`${tag}-crawled`, 'device-a']),
    ).rejects.toMatchObject({
      code: 'P0002',
    });
    const card = await fn<{ thanks: number; events: { eventId: string; thanks: number }[] }>(
      `contributions_get($1, '2026-11-01', 5)`,
      [user],
    );
    expect(card.thanks).toBe(2);
    expect(card.events.find((e) => e.eventId === `${tag}-own`)?.thanks).toBe(2);
    // Nobody reads the table directly.
    await db.query('begin');
    try {
      await db.query('set local role anon');
      await expect(db.query('select thanks_add($1, $2)', [`${tag}-own`, 'x'])).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.query('rollback');
    }
  });
});
