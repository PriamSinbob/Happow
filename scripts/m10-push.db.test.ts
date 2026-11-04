/**
 * Integration test for M10 slices D and E against DATABASE_URL after `pnpm db:reset`: push
 * subscriptions and reminders. It writes to auth.users, so it runs only on a local or CI database,
 * never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);

interface Due {
  id: number;
  eventId: string;
  startAt: string;
  setStartAt: string;
  status: string;
  hidden: boolean;
  subscriptions: { endpoint: string; lang: string }[];
}

describe.skipIf(!url || !local)('M10 push and reminders in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  let user = '';
  const ev = (id: string) => `${tag}-${id}`;
  /** An event starting `startMin` minutes from now, an hour long. */
  const event = (id: string, startMin: number, hidden = false) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, hidden)
       values ($1, 'wroclaw', 'Test', '{music}', now() + make_interval(mins => $2),
         now() + make_interval(mins => $2 + 60), 'Europe/Warsaw', st_point(16.805, 51.205)::geography,
         'x', 'crawled', $3)`,
      [ev(id), startMin, hidden],
    );
  const subscribe = (device: string, endpoint: string, u: string | null = null, lang = 'pl') =>
    db.query(`select push_subscribe($1, $2, $3, $4, $5, $6)`, [
      device,
      u,
      endpoint,
      'B'.repeat(87),
      'a'.repeat(22),
      lang,
    ]);
  const set = async (
    device: string,
    id: string,
    lead: string | null,
    u: string | null = null,
    max = 50,
  ) =>
    (
      await db.query<{ ok: boolean }>(`select reminder_set($1, $2, $3, $4, $5) as ok`, [
        device,
        u,
        ev(id),
        lead,
        max,
      ])
    ).rows[0]!.ok;
  const due = async (minutesAhead: number) =>
    (
      await db.query<{ r: Due[] }>(
        `select reminders_due(now() + make_interval(mins => $1), '18:00', 100) as r`,
        [minutesAhead],
      )
    ).rows[0]!.r.filter((d) => d.eventId.startsWith(tag));
  const dev = (n: string) => `${tag}-dev-${n}`;
  const endpoint = (n: string) => `https://push.example/${tag}/${n}`;

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    user = (
      await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        `ala-${tag}@example.org`,
      ])
    ).rows[0]!.id;
    await event('soon', 70);
    await event('later', 300);
    await event('started', -10);
    await event('hidden', 50, true);
    await event('moved', 200);
  });
  afterAll(async () => {
    await db.query('delete from reminders where event_id like $1', [`${tag}-%`]);
    await db.query('delete from push_subscriptions where endpoint like $1', [
      `https://push.example/${tag}/%`,
    ]);
    await db.query('delete from events where id like $1', [`${tag}-%`]);
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.end();
  });

  it('keeps a subscription per endpoint and lets only its device remove it', async () => {
    await subscribe(dev('a'), endpoint('a1'));
    await subscribe(dev('a'), endpoint('a1'), null, 'en');
    const { rows } = await db.query('select lang from push_subscriptions where endpoint = $1', [
      endpoint('a1'),
    ]);
    expect(rows).toEqual([{ lang: 'en' }]);
    await db.query('select push_unsubscribe($1, $2)', [dev('other'), endpoint('a1')]);
    expect(
      (await db.query('select 1 from push_subscriptions where endpoint = $1', [endpoint('a1')]))
        .rowCount,
    ).toBe(1);
  });

  it('sets reminders for listed events not yet started, up to the cap', async () => {
    expect(await set(dev('a'), 'soon', '60')).toBe(true);
    expect(await set(dev('a'), 'started', '15')).toBe(false);
    expect(await set(dev('a'), 'hidden', '15')).toBe(false);
    expect(await set(dev('a'), 'nope', '15')).toBe(false);
    // The cap counts other events; changing the lead of one already set is always fine.
    expect(await set(dev('a'), 'later', '30', null, 1)).toBe(false);
    expect(await set(dev('a'), 'soon', '15', null, 1)).toBe(true);
    const list = await db.query<{ r: Record<string, string> }>(
      `select reminders_list($1, null) as r`,
      [dev('a')],
    );
    expect(list.rows[0]!.r).toEqual({ [ev('soon')]: '15' });
  });

  it('sends what is due before the next tick, to the right subscriptions', async () => {
    await set(dev('a'), 'soon', '60');
    // Starts in 70 min, 60 min lead: due within the next 15 minutes, not within 5.
    expect(await due(5)).toEqual([]);
    const now = await due(15);
    expect(now).toHaveLength(1);
    expect(now[0]!.subscriptions.map((s) => s.endpoint)).toEqual([endpoint('a1')]);
    await db.query(`select reminders_done($1, $2, $3)`, [[now[0]!.id], [endpoint('a1')], []]);
    expect(await due(15)).toEqual([]);
    const used = await db.query('select last_used_at from push_subscriptions where endpoint = $1', [
      endpoint('a1'),
    ]);
    expect(used.rows[0]!.last_used_at).not.toBeNull();
  });

  it('follows a moved start, and an event hidden after the reminder was set', async () => {
    expect(await set(dev('b'), 'moved', '60')).toBe(true);
    expect(await due(15)).toEqual([]);
    // The source moves it 3 hours earlier: due at once, with the old start for "time changed".
    await db.query(
      `update events set start_at = start_at - interval '3 hours', end_at = end_at - interval '3 hours' where id = $1`,
      [ev('moved')],
    );
    const [moved] = await due(15);
    expect(moved!.eventId).toBe(ev('moved'));
    expect(Date.parse(moved!.setStartAt) - Date.parse(moved!.startAt)).toBe(3 * 3600_000);
    expect(moved!.subscriptions).toEqual([]);
    await db.query(`select reminders_done($1, '{}', '{}')`, [[moved!.id]]);

    await db.query(`update events set hidden = false where id = $1`, [ev('hidden')]);
    expect(await set(dev('b'), 'hidden', '60')).toBe(true);
    await db.query(`update events set hidden = true where id = $1`, [ev('hidden')]);
    const [hidden] = await due(15);
    expect(hidden).toMatchObject({ eventId: ev('hidden'), hidden: true });
    await db.query(`select reminders_done($1, '{}', '{}')`, [[hidden!.id]]);
  });

  it('the day before fires at 18:00 local the evening before', async () => {
    const { rows } = await db.query<{ t: string }>(
      `select reminder_fire_at('2026-11-07T18:00:00Z', 'Europe/Warsaw', 'dayBefore', '18:00')::text as t`,
    );
    expect(new Date(rows[0]!.t).toISOString()).toBe('2026-11-06T17:00:00.000Z');
  });

  it("with an account: one reminder per event, sent to every device's subscription", async () => {
    await subscribe(dev('phone'), endpoint('phone'), user);
    await subscribe(dev('tablet'), endpoint('tablet'), user);
    await event('acct', 50);
    expect(await set(dev('phone'), 'acct', '60', user)).toBe(true);
    expect(await set(dev('tablet'), 'acct', '30', user)).toBe(true);
    const n = await db.query('select count(*)::int as n from reminders where event_id = $1', [
      ev('acct'),
    ]);
    expect(n.rows[0]!.n).toBe(1);
    const list = await db.query<{ r: Record<string, string> }>(
      `select reminders_list($1, $2) as r`,
      [dev('phone'), user],
    );
    expect(list.rows[0]!.r[ev('acct')]).toBe('30');
    const [r] = (await due(30)).filter((d) => d.eventId === ev('acct'));
    expect(r!.subscriptions.map((s) => s.endpoint).sort()).toEqual([
      endpoint('phone'),
      endpoint('tablet'),
    ]);
    // A gone endpoint is deleted.
    await db.query(`select reminders_done($1, $2, $3)`, [
      [r!.id],
      [endpoint('phone')],
      [endpoint('tablet')],
    ]);
    expect(
      (await db.query('select 1 from push_subscriptions where endpoint = $1', [endpoint('tablet')]))
        .rowCount,
    ).toBe(0);
    expect(await set(dev('phone'), 'acct', null, user)).toBe(true);
    expect(
      (await db.query('select 1 from reminders where event_id = $1', [ev('acct')])).rowCount,
    ).toBe(0);
  });

  it('keeps it all away from the public roles', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'reminders', 'select')
        or has_table_privilege('authenticated', 'push_subscriptions', 'select')
        or has_function_privilege('anon', 'reminders_due(timestamptz, time, integer)', 'execute') as ok`,
    );
    expect(rows[0]!.ok).toBe(false);
  });
});
