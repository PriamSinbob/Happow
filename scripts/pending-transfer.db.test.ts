/**
 * Accounts waiting for activation folded into the real one, the updates of many events in one
 * read, and a private event handed over to a guest. Writes to auth.users, so local or CI only.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRegion, loadConfig } from '@happow/core';
import { local, sqlFn, tag, url } from './dbtest';

const config = loadConfig();
const region = getRegion(config);
const token = () => randomBytes(16).toString('hex');

describe.skipIf(!url || !local)('waiting accounts, updates and hand-over in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const fn = sqlFn(db);
  const newUser = async (name: string, display: string | null = name) => {
    const id = (
      await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        `${name}-${tag}@example.org`,
      ])
    ).rows[0]!.id;
    await db.query('update profiles set display_name = $2 where user_id = $1', [id, display]);
    return id;
  };
  const event = async (id: string, owner: string | null) => {
    await db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, visibility, owner_id)
       values ($1, $2, $3, '{music}', now() + interval '2 hours', now() + interval '4 hours',
         'Europe/Warsaw', st_point(17.03, 51.11)::geography, 'x', 'community', $4, $5)`,
      [`${id}-${tag}`, region.id, `${id} ${tag}`, owner ? 'private' : 'public', owner],
    );
    return `${id}-${tag}`;
  };
  const invitation = async (ev: string, user: string) =>
    (
      await db.query<{ status: string; inviter: string }>(
        'select status, inviter from invitations where event_id = $1 and invitee = $2',
        [ev, user],
      )
    ).rows[0] ?? null;

  let ala = '';
  let ola = '';

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    ala = await newUser('ala', 'Ala');
    ola = await newUser('ola', null);
  });
  afterAll(async () => {
    await db.query(`delete from events where title like '%${tag}%'`);
    await db.query(`delete from auth.users where email like '%-${tag}@example.org'`);
    await db.end();
  });

  describe('an account waiting for activation', () => {
    it('is folded into the real one: invitations, contacts, name, terms and devices', async () => {
      const waiting = await newUser('waiting', 'Olka');
      await fn('pending_add($1, $2)', [waiting, `Ola-${tag}@Example.org`]);
      expect(await fn('pending_email($1)', [waiting])).toBe(`ola-${tag}@example.org`);
      await db.query(
        `update profiles set terms_version = 'v1', terms_accepted_at = now() where user_id = $1`,
        [waiting],
      );

      // Accepted by link while waiting; a second event where the real account was invited by name.
      const party = await event('party', ala);
      const dinner = await event('dinner', ala);
      const link = token();
      await fn('invite_link($1, $2, $3, null, 200)', [ala, party, link]);
      expect(await fn('invitation_accept_link($1, $2)', [waiting, link])).toBe(party);
      await db.query('insert into invitations (event_id, inviter, invitee) values ($1, $2, $3)', [
        dinner,
        ala,
        ola,
      ]);
      const link2 = token();
      await fn('invite_link($1, $2, $3, null, 200)', [ala, dinner, link2]);
      await fn('invitation_accept_link($1, $2)', [waiting, link2]);
      await db.query(
        `insert into push_subscriptions (endpoint, device_hash, user_id, p256dh, auth, lang)
         values ($1, $2, $3, repeat('k', 60), repeat('a', 20), 'pl')`,
        [`https://push.example/${tag}`, `dev-${tag}`, waiting],
      );

      expect(await fn('pending_merge($1, $2)', [waiting, ola])).toBe(true);

      expect(await invitation(party, ola)).toMatchObject({ status: 'accepted' });
      // Invited twice: one invitation stays, and the acceptance carries over.
      expect(await invitation(dinner, ola)).toMatchObject({ status: 'accepted' });
      expect(await invitation(party, waiting)).toBeNull();
      expect(await invitation(dinner, waiting)).toBeNull();
      expect(await fn('contact_mutual($1, $2)', [ala, ola])).toBe(true);
      const p = (
        await db.query('select display_name, terms_version from profiles where user_id = $1', [ola])
      ).rows[0];
      expect(p).toEqual({ display_name: 'Olka', terms_version: 'v1' });
      expect(
        (
          await db.query('select user_id from push_subscriptions where endpoint = $1', [
            `https://push.example/${tag}`,
          ])
        ).rows[0].user_id,
      ).toBe(ola);
      expect(await fn('pending_email($1)', [waiting])).toBeNull();
      // The caller deletes the waiting user; nothing of it is left behind.
      await db.query('delete from auth.users where id = $1', [waiting]);
      expect(await invitation(party, ola)).toMatchObject({ status: 'accepted' });
    });

    it('never folds a real account into another', async () => {
      const real = await newUser('real', 'Real');
      expect(await fn('pending_merge($1, $2)', [real, ola])).toBe(false);
      expect(await fn('pending_merge($1, $1)', [ola])).toBe(false);
      expect((await db.query('select 1 from profiles where user_id = $1', [real])).rowCount).toBe(
        1,
      );
    });

    it('expires when nobody activates it', async () => {
      const old = await newUser('old');
      const fresh = await newUser('fresh');
      await fn('pending_add($1, $2)', [old, 'a@example.org']);
      await fn('pending_add($1, $2)', [fresh, 'b@example.org']);
      await db.query(
        `update pending_accounts set created_at = now() - interval '40 days' where user_id = $1`,
        [old],
      );
      const expired = await fn<string[]>('pending_expired(30, 100)');
      expect(expired).toContain(old);
      expect(expired).not.toContain(fresh);
    });
  });

  describe('updates of many events', () => {
    it('lists the public events with news, their newest posts first, and no private ones', async () => {
      const quiet = await event('quiet', null);
      const busy = await event('busy', null);
      const secret = await event('secret', ala);
      for (const [ev, body] of [
        [busy, 'first'],
        [busy, 'second'],
        [busy, 'third'],
        [secret, 'private words'],
      ] as const) {
        await db.query(
          `insert into event_posts (event_id, user_id, kind, body, created_at)
           values ($1, $2, 'important', $3, clock_timestamp())`,
          [ev, ala, body],
        );
        await db.query('update events set last_post_at = now() where id = $1', [ev]);
      }
      const list = await fn<{ id: string; title: string; posts: { body: string }[] }[]>(
        'events_updates($1, 2)',
        [[quiet, busy, secret, `missing-${tag}`]],
      );
      expect(list.map((u) => u.id)).toEqual([busy]);
      expect(list[0]!.posts.map((p) => p.body)).toEqual(['third', 'second']);
      expect(list[0]).toMatchObject({ title: `busy ${tag}`, status: 'scheduled' });
    });
  });

  describe('handing a private event over', () => {
    it('makes an accepted guest the owner and keeps the former owner as a guest', async () => {
      const ewa = await newUser('ewa', 'Ewa');
      const jan = await newUser('jan', 'Jan');
      const meet = await event('meet', ala);
      for (const guest of [ewa, jan])
        await db.query(
          `insert into invitations (event_id, inviter, invitee, status) values ($1, $2, $3, $4)`,
          [meet, ala, guest, guest === ewa ? 'accepted' : 'pending'],
        );

      // Only to someone who accepted; only by the owner; never to oneself.
      await expect(fn('event_transfer($1, $2, $3)', [ala, meet, jan])).rejects.toMatchObject({
        code: 'P0002',
      });
      await expect(fn('event_transfer($1, $2, $3)', [ewa, meet, jan])).rejects.toMatchObject({
        code: 'P0002',
      });
      await expect(fn('event_transfer($1, $2, $3)', [ala, meet, ala])).rejects.toMatchObject({
        code: 'HQ010',
      });

      expect(await fn('event_transfer($1, $2, $3)', [ala, meet, ewa])).toEqual({
        owner: ewa,
        ownerName: 'Ewa',
      });
      expect(await fn('event_role($1, $2)', [ewa, meet])).toBe('owner');
      expect(await fn('event_role($1, $2)', [ala, meet])).toBeNull();
      expect(await invitation(meet, ala)).toEqual({ status: 'accepted', inviter: ewa });
      expect(await invitation(meet, ewa)).toBeNull();
      // The others' invitations stay, now from the new owner; the event still shows to them all.
      expect(await invitation(meet, jan)).toEqual({ status: 'pending', inviter: ewa });
      expect(await fn('event_visible_to($1, $2)', [meet, ala])).toBe(true);
      expect(
        (await db.query('select changed_at is not null as c from events where id = $1', [meet]))
          .rows[0].c,
      ).toBe(true);
      // And back again: the new owner can return it.
      await fn('event_transfer($1, $2, $3)', [ewa, meet, ala]);
      expect(await fn('event_role($1, $2)', [ala, meet])).toBe('owner');
      expect(await invitation(meet, ewa)).toEqual({ status: 'accepted', inviter: ala });
    });

    it('is refused to an account still waiting for activation', async () => {
      const waiting = await newUser('w2', 'W');
      await fn('pending_add($1, $2)', [waiting, 'w@example.org']);
      const meet = await event('meet2', ala);
      await db.query(
        `insert into invitations (event_id, inviter, invitee, status) values ($1, $2, $3, 'accepted')`,
        [meet, ala, waiting],
      );
      await expect(fn('event_transfer($1, $2, $3)', [ala, meet, waiting])).rejects.toMatchObject({
        code: 'HQ011',
      });
    });
  });
});
