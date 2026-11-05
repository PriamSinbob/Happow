/**
 * Integration test for M13 against DATABASE_URL after `pnpm db:reset`: every table that refers
 * to an account is in the export and is emptied (or anonymised) when the account goes (slice D),
 * and the crawler's page cache (slice C). It writes to auth.users, so it runs only on a local or
 * CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventStore } from '@happow/ingest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);

/**
 * Each table that refers to auth.users, and the export key that carries its rows. A new table
 * fails the first test until it is added here and to account_export.
 */
const EXPORTED: Record<string, string> = {
  account_feeds: 'feeds',
  account_follows: 'follows',
  account_usage: 'usage',
  attendance: 'attendance',
  claims: 'claims',
  contact_group_members: 'groups',
  contact_groups: 'groups',
  contact_links: 'contactLinks',
  contacts: 'contacts',
  contributions: 'contributions',
  event_edits: 'edits',
  event_posts: 'posts',
  events: 'privateEvents',
  follow_alerts: 'followAlertsSent',
  follow_settings: 'followAlerts',
  friend_overrides: 'friendOverrides',
  invitations: 'invitationsSent',
  plan_grants: 'grants',
  profiles: 'profile',
  push_subscriptions: 'pushDevices',
  reminders: 'reminders',
  reports: 'reports',
  saved_events: 'saved',
  submissions: 'submissions',
};

describe.skipIf(!url || !local)('M13 in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  let refs: { table: string; column: string; rule: string }[] = [];
  let user = '';

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    refs = (
      await db.query<{ table: string; column: string; rule: string }>(
        `select tc.table_name as table, kcu.column_name as column, rc.delete_rule as rule
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
         join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
         join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
         where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
           and ccu.table_schema = 'auth' and ccu.table_name = 'users'`,
      )
    ).rows;
    user = (
      await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        `gdpr-${tag}@example.org`,
      ])
    ).rows[0]!.id;
  });
  afterAll(async () => {
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.query(`delete from page_cache where source_id = $1`, [`t-${tag}`]);
    await db.end();
  });

  it('lists every table that refers to an account in the export map', () => {
    const tables = [...new Set(refs.map((r) => r.table))].sort();
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.filter((t) => !(t in EXPORTED))).toEqual([]);
  });

  it('exports every one of those keys', async () => {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      'select account_export($1) as r',
      [user],
    );
    const keys = Object.keys(rows[0]!.r);
    expect([...new Set(Object.values(EXPORTED))].filter((k) => !keys.includes(k))).toEqual([]);
  });

  it('deletion leaves nothing personal: rows go, or their account reference is cleared', async () => {
    // A row in a few kinds of table, cascade and set-null alike.
    await db.query(
      `insert into push_subscriptions (endpoint, p256dh, auth, device_hash, user_id)
      values ($1, repeat('a', 60), repeat('b', 20), 'dev', $2)`,
      [`https://push.example/${tag}`, user],
    );
    await db.query(
      `insert into account_follows (user_id, norm, name, changed_at)
      values ($1, 'kult', 'Kult', now())`,
      [user],
    );
    await db.query(`select follow_alerts_set($1, true)`, [user]);
    await db.query(`select account_forget($1, $2)`, [user, `gdpr-${tag}@example.org`]);
    await db.query('delete from auth.users where id = $1', [user]);
    for (const { table, column } of refs) {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from ${table} where ${column} = $1`,
        [user],
      );
      expect(rows[0]!.n, `${table}.${column}`).toBe(0);
    }
    // The device's own subscription stays (it can still get its reminders), without the account.
    const sub = await db.query(`select user_id from push_subscriptions where endpoint = $1`, [
      `https://push.example/${tag}`,
    ]);
    expect(sub.rows).toEqual([{ user_id: null }]);
    await db.query(`delete from push_subscriptions where endpoint = $1`, [
      `https://push.example/${tag}`,
    ]);
  });

  it('keeps the crawler page cache per source and URL', async () => {
    const cache = new EventStore(db).pageCache(`t-${tag}`);
    expect(await cache.get('https://a.example/')).toBeUndefined();
    const entry = {
      etag: '"x"',
      lastModified: null,
      hash: 'h1',
      events: [],
      links: ['https://a.example/1'],
      fetchedAt: '2026-11-05T10:00:00.000Z',
    };
    await cache.set('https://a.example/', entry);
    await cache.set('https://a.example/', { ...entry, hash: 'h2' });
    expect(await cache.get('https://a.example/')).toEqual({ ...entry, hash: 'h2' });
    const anon = await db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'page_cache', 'select') as ok`,
    );
    expect(anon.rows[0]!.ok).toBe(false);
  });
});
