/**
 * Private events kept out of every public read, contacts and groups, invitations, the friends'
 * view, organiser claims, posts and push notices, edits and the organiser's fields, and export,
 * deletion and retention. Writes to auth.users, so local or CI only.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRegion, loadConfig } from '@happow/core';
import { normalize } from '@happow/ingest/normalize';
import { local, sqlFn, tag, url } from './dbtest';

const config = loadConfig();
const region = getRegion(config);
const source = config.sources.find((s) => s.adapter === 'user-submission')!;
const month = '2026-11-01';

describe.skipIf(!url || !local)('private events and organisers in Postgres', () => {
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
  /** A private event through submit_private, as the API sends it. */
  const submitPrivate = (user: string, title: string, max = 15, privateMax = 1) => {
    const id = randomUUID();
    const start = new Date(Date.now() + 3 * 3_600_000);
    const res = normalize(
      {
        externalId: id,
        sourceUrl: null,
        title,
        description: null,
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
        categoryLabels: [],
        categoryIds: ['music'],
        venue: {
          externalId: id,
          name: `Ala's flat ${tag}`,
          address: 'ul. Prywatna 1',
          point: { lat: 51.11, lng: 17.03 },
          website: null,
        },
        point: { lat: 51.11, lng: 17.03 },
        isFree: true,
        priceMin: 0,
        priceMax: 0,
        currency: null,
        rules: {},
        ageMin: null,
        family: null,
        entry: null,
        officialUrl: null,
        ticketUrl: null,
        imageUrl: null,
        status: 'scheduled',
      },
      {
        source,
        region,
        categories: config.categories,
        h3Resolution: config.app.h3.eventResolution,
        densityResolution: config.app.h3.densityResolution,
        descriptionMaxChars: 2000,
        now: new Date(),
      },
    );
    if (!res.ok) throw new Error(res.reason);
    return fn<string>('submit_private($1, $2, $3, $4, $5, $6, $7)', [
      { id, form: { title }, normalized: res.value },
      `hash-${tag}`,
      region.id,
      user,
      month,
      max,
      privateMax,
    ]);
  };
  const publicEvent = async (id: string, extra = '') =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust ${extra ? ', venue_id' : ''})
       values ($1, $2, 'Public ${tag}', '{music}', now() + interval '2 hours',
         now() + interval '4 hours', 'Europe/Warsaw', st_point(17.03, 51.11)::geography, 'x',
         'crawled' ${extra ? ', $3' : ''})`,
      extra ? [id, region.id, extra] : [id, region.id],
    );
  const asRole = async <T>(role: 'anon' | 'authenticated', user: string | null, q: string) => {
    await db.query('begin');
    try {
      await db.query(`set local role ${role}`);
      if (user) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      return (await db.query(q)).rows as T[];
    } finally {
      await db.query('rollback');
    }
  };

  let ala = '';
  let ola = '';
  let ewa = '';
  let party = '';

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    ala = await newUser('ala', 'Ala');
    ola = await newUser('ola', 'Ola');
    ewa = await newUser('ewa', 'Ewa');
    party = await submitPrivate(ala, `Party ${tag}`);
  });

  afterAll(async () => {
    await db.query(`delete from events where title like '%${tag}%'`);
    await db.query(`delete from auth.users where email like '%-${tag}@example.org'`);
    await db.end();
  });

  describe('private events', () => {
    it('stores one private, owned, verified, with a private venue, and counts both quotas', async () => {
      const e = (
        await db.query(
          `select e.visibility, e.owner_id, e.verified, e.density_cell, v.private
           from events e join venues v on v.id = e.venue_id where e.id = $1`,
          [party],
        )
      ).rows[0];
      expect(e).toEqual({
        visibility: 'private',
        owner_id: ala,
        verified: true,
        density_cell: null,
        private: true,
      });
      expect(await fn('usage_get($1, $2)', [ala, month])).toEqual({
        events: 1,
        autofills: 0,
        private: 1,
      });
      // The free account's one a month is used.
      await expect(submitPrivate(ala, `Second ${tag}`)).rejects.toMatchObject({ code: 'HQ002' });
      expect(await fn('usage_get($1, $2)', [ala, month])).toMatchObject({ events: 1, private: 1 });
    });

    it('never shows in a public reader', async () => {
      const at = `51.11, 17.03`;
      const readers = [
        `select id from events_public where id = '${party}'`,
        `select id from events_near(${at}, 5000, now(), now() + interval '1 day')`,
        `select id from event_by_id('${party}')`,
        `select id from events_by_ids(array['${party}'])`,
        `select id from events_area(${at}, 5000, now(), now() + interval '1 day', 500)`,
      ];
      for (const q of readers) {
        const ids = (await db.query<{ id: string }>(q)).rows.map((r) => r.id);
        expect(ids, q).not.toContain(party);
      }
      const density = await db.query(
        `select * from density_near(${at}, 5000, 5000, now(), now() + interval '1 day')`,
      );
      expect(JSON.stringify(density.rows)).not.toContain(party);
      expect(
        JSON.stringify(await fn('coverage($1, now())', [region.id])),
        'coverage counts',
      ).toBeTruthy();
      expect(await fn('duplicate_candidates($1, 200, 60)', [party])).toEqual({
        title: `Party ${tag}`,
        others: [],
      });
      await expect(fn('thanks_add($1, $2)', [party, 'dev'])).rejects.toMatchObject({
        code: 'P0002',
      });
      expect(
        await fn('counts_add($1, current_date)', [JSON.stringify([{ eventId: party, opens: 1 }])]),
      ).toBe(0);
      expect(await fn('share_link_create($1, $2, $3)', [`tok-${tag}-xxxxxxxx`, party, 'dev'])).toBe(
        false,
      );
      expect(await fn('event_visibility($1)', [party])).toBe('private');
    });

    it('row-level security: anon and strangers see nothing, the owner sees it', async () => {
      const q = `select id from events where id = '${party}'`;
      expect(await asRole('anon', null, q)).toEqual([]);
      expect(await asRole('authenticated', ola, q)).toEqual([]);
      expect(await asRole('authenticated', ala, q)).toEqual([{ id: party }]);
      const venue = `select v.id from venues v join events e on e.venue_id = v.id where e.id = '${party}'`;
      expect(await asRole('authenticated', ala, venue)).toEqual([]);
    });

    it('reads for the owner, with nothing for others', async () => {
      const mine = await fn<{ id: string; mine: boolean }[]>('private_events_for($1)', [ala]);
      expect(mine).toEqual([
        expect.objectContaining({ id: party, mine: true, visibility: 'private' }),
      ]);
      expect(await fn('private_events_for($1)', [ola])).toEqual([]);
      expect(await fn('private_event_get($1, $2, null)', [ola, party])).toBeNull();
    });
  });

  describe('contacts and groups', () => {
    it('connects through a contact link both ways, and blocking stops it', async () => {
      const token = `link-${tag}-aaaaaaaaaaaa`;
      await fn('contact_link_new($1, $2)', [ala, token]);
      expect(await fn('contact_link_owner($1)', [token])).toEqual({ id: ala, name: 'Ala' });
      expect(await fn('contact_link_accept($1, $2)', [ola, token])).toEqual({
        id: ala,
        name: 'Ala',
      });
      expect(await fn('contact_mutual($1, $2)', [ala, ola])).toBe(true);
      await expect(fn('contact_link_accept($1, $2)', [ala, token])).rejects.toMatchObject({
        code: 'HQ010',
      });
      // A new link retires the old one.
      await fn('contact_link_new($1, $2)', [ala, `${token}-new`]);
      expect(await fn('contact_link_owner($1)', [token])).toBeNull();
      // Ewa blocks Ala: Ala's link no longer connects them.
      await fn('contact_change($1, $2, $3)', [ewa, ala, 'block']);
      await expect(fn('contact_link_accept($1, $2)', [ewa, `${token}-new`])).rejects.toMatchObject({
        code: 'HQ011',
      });
      const list = await fn<{ contacts: { id: string; mutual: boolean }[] }>('contacts_list($1)', [
        ala,
      ]);
      expect(list.contacts).toEqual([
        expect.objectContaining({ id: ola, name: 'Ola', mutual: true }),
      ]);
      expect(await asRole('authenticated', ola, 'select owner from contacts')).toEqual([
        { owner: ola },
      ]);
    });

    it('keeps groups to your own unblocked contacts', async () => {
      const g = await fn<number>('group_save($1, null, $2, $3, 20)', [ala, 'Friends', [ola, ewa]]);
      const list = await fn<{ groups: { id: number; members: number }[] }>('contacts_list($1)', [
        ala,
      ]);
      expect(list.groups).toEqual([{ id: Number(g), name: 'Friends', members: 1 }]);
      expect(await fn('group_delete($1, $2)', [ola, g])).toBe(false);
    });
  });

  describe('invitations', () => {
    it('invites by group and by link; accept, decline, revoke', async () => {
      const groups = await fn<{ groups: { id: number }[] }>('contacts_list($1)', [ala]);
      expect(
        await fn('invite_people($1, $2, null, $3, 200)', [ala, party, [groups.groups[0]!.id]]),
      ).toBe(1);
      // Ola now sees it (pending) through the policy and the reader.
      expect(
        await asRole('authenticated', ola, `select id from events where id = '${party}'`),
      ).toHaveLength(1);
      const seen = await fn<{ invitation: { status: string } }[]>('private_events_for($1)', [ola]);
      expect(seen[0]!.invitation.status).toBe('pending');
      // "Maybe" is an accepted invitation marked so; "going" clears the mark.
      expect(await fn('invitation_answer($1, $2, true, true)', [ola, party])).toBe('accepted');
      expect(
        (await fn<{ invitation: { maybe: boolean } }[]>('private_events_for($1)', [ola]))[0]!
          .invitation.maybe,
      ).toBe(true);
      expect(await fn('invitation_answer($1, $2, true)', [ola, party])).toBe('accepted');
      // A link: Ewa blocked Ala, so she can't take it; a new user can, once.
      const token = `inv-${tag}-bbbbbbbbbbbb`;
      await fn('invite_link($1, $2, $3, $4, 200)', [ala, party, token, 'for Zosia']);
      expect(await fn('private_event_get(null, $1, $2)', [party, token])).toMatchObject({
        id: party,
        link: true,
      });
      await expect(fn('invitation_accept_link($1, $2)', [ewa, token])).rejects.toMatchObject({
        code: 'HQ011',
      });
      const zosia = await newUser('zosia', 'Zosia');
      expect(await fn('invitation_accept_link($1, $2)', [zosia, token])).toBe(party);
      await expect(fn('invitation_accept_link($1, $2)', [ola, token])).rejects.toMatchObject({
        code: 'P0002',
      });
      expect(await fn('contact_mutual($1, $2)', [ala, zosia])).toBe(true);
      // The guest list for the owner, and for a guest.
      const guests = await fn<{ id: string; name: string; status: string }[]>(
        'event_guests($1, $2)',
        [ala, party],
      );
      expect(guests.map((g) => [g.name, g.status])).toEqual([
        ['Ola', 'accepted'],
        ['Zosia', 'accepted'],
      ]);
      expect(await fn('event_guests($1, $2)', [ola, party])).toHaveLength(2);
      await expect(fn('event_guests($1, $2)', [ewa, party])).rejects.toMatchObject({
        code: 'P0002',
      });
      // Revoking Zosia: the event leaves her app.
      const z = guests.find((g) => g.name === 'Zosia')!;
      expect(await fn('invitation_revoke($1, $2)', [ola, z.id])).toBe(false);
      expect(await fn('invitation_revoke($1, $2)', [ala, z.id])).toBe(true);
      expect(await fn('private_events_for($1)', [zosia])).toEqual([]);
      expect(await fn('event_visible_to($1, $2)', [party, zosia])).toBe(false);
      // Not your event: refused.
      await expect(
        fn('invite_people($1, $2, $3, null, 200)', [ola, party, [ala]]),
      ).rejects.toMatchObject({
        code: 'P0002',
      });
    });

    it('lets guests mark going and set reminders, nobody else', async () => {
      const set = (user: string | null, device: string) =>
        fn('attendance_set($1, $2, $3, $4, true, null, 24)', [party, device, user, 'going']);
      expect(await set(null, `anon-${tag}`)).toBeNull();
      expect(await set(ewa, `ewa-${tag}`)).toBeNull();
      expect(await set(ola, `ola-${tag}`)).toMatchObject({ private: true, mine: ['going'] });
      expect(await fn('reminder_set($1, $2, $3, $4, 50)', [`anon-${tag}`, null, party, '60'])).toBe(
        false,
      );
      expect(await fn('reminder_set($1, $2, $3, $4, 50)', [`ola-${tag}`, ola, party, '60'])).toBe(
        true,
      );
    });
  });

  describe("the friends' view", () => {
    it('shows mutual friends who both show themselves, per event overrides included', async () => {
      await set(ala, 'going');
      const view = () =>
        fn<{ friends: { name: string }[] }>('friends_on_event($1, $2, $3)', [ala, party, 'x']);
      // Nobody has the switch on.
      expect((await view()).friends).toEqual([]);
      await db.query('update profiles set friends_visible = true where user_id = $1', [ala]);
      expect((await view()).friends).toEqual([]);
      // Ola shows herself on this event only.
      await fn('friend_override_set($1, $2, true)', [ola, party]);
      expect((await view()).friends).toEqual([{ name: 'Ola', kinds: ['going'] }]);
      // Ala hides herself on this event: she sees nobody either.
      await fn('friend_override_set($1, $2, false)', [ala, party]);
      expect((await view()).friends).toEqual([]);
      await fn('friend_override_set($1, $2, null)', [ala, party]);
      // Removing a contact ends it.
      await fn('contact_change($1, $2, $3)', [ola, ala, 'remove']);
      expect((await view()).friends).toEqual([]);
      await fn('contact_connect($1, $2)', [ala, ola]);
    });
    const set = (user: string, kind: string) =>
      fn('attendance_set($1, $2, $3, $4, true, null, 24)', [party, `${user}-dev`, user, kind]);
  });

  describe('claims, posts and edits', () => {
    const ev = `test:${tag}-claimed`;
    let claim = '';

    beforeAll(async () => {
      await db.query(
        `insert into venues (id, name, point, h3_r9, website)
         values ($1, 'Klub', st_point(17.03, 51.11)::geography, 'x', 'https://klub.example')`,
        [`venue-${tag}`],
      );
      await publicEvent(ev, `venue-${tag}`);
    });

    it('opens, approves and refuses a second organiser', async () => {
      const c = await fn<{ id: string; code: string; page_url: string }>(
        'claim_open($1, $2, $3, $4, $5, $6, $7)',
        [ala, 'event', ev, 'Klub Ala', 'site', 'happow-claim-AAAA', null],
      );
      expect(c.page_url).toBe('https://klub.example');
      claim = c.id;
      // Opening again keeps the same claim and code.
      const again = await fn<{ id: string; code: string }>(
        'claim_open($1, $2, $3, $4, $5, $6, $7)',
        [ala, 'event', ev, 'Klub Ala', 'moderator', 'happow-claim-BBBB', 'I run it'],
      );
      expect([again.id, again.code]).toEqual([claim, 'happow-claim-AAAA']);
      await fn('claim_decide($1, $2, $3, null)', [claim, 'approve', 'site']);
      expect(await fn('event_organiser($1)', [ev])).toEqual({
        user: ala,
        name: 'Klub Ala',
        kind: 'event',
      });
      const other = await fn<{ id: string }>('claim_open($1, $2, $3, $4, $5, $6, $7)', [
        ola,
        'event',
        ev,
        'Ola',
        'moderator',
        'happow-claim-CCCC',
        'mine',
      ]);
      await expect(
        fn('claim_decide($1, $2, $3, null)', [other.id, 'approve', 'mod']),
      ).rejects.toMatchObject({
        code: 'HQ020',
      });
      const queue = await fn<{ id: string; competing: number }[]>('claims_queue()');
      expect(queue.find((q) => q.id === other.id)?.competing).toBe(1);
      await fn('claim_decide($1, $2, $3, null)', [other.id, 'reject', 'mod']);
    });

    it("keeps the organiser's times over a source, and notes the disagreement", async () => {
      const start = new Date(Date.now() + 5 * 3_600_000).toISOString();
      const r = await fn('post_add($1, $2, $3, $4, $5, 10)', [
        ala,
        ev,
        'schedule',
        'Start moved',
        { start_at: start, end_at: new Date(Date.now() + 7 * 3_600_000).toISOString() },
      ]);
      expect(r).toMatchObject({ kind: 'schedule' });
      // A source writes its old time: the organiser's stays, and the source's is noted.
      await db.query(
        `update events set start_at = now() + interval '2 hours', title = 'Src' where id = $1`,
        [ev],
      );
      const row = (
        await db.query(
          'select start_at, title, source_disagrees, changed_at from events where id = $1',
          [ev],
        )
      ).rows[0];
      expect(new Date(row.start_at).toISOString()).toBe(start);
      expect(row.title).toBe('Src');
      expect(Object.keys(row.source_disagrees)).toEqual(['start_at']);
      expect(row.changed_at).not.toBeNull();
      const posts = await fn<{ organiser: { name: string }; posts: { kind: string }[] }>(
        'event_posts_get($1)',
        [ev],
      );
      expect(posts.organiser.name).toBe('Klub Ala');
      expect(posts.posts.map((p) => p.kind)).toEqual(['schedule']);
      await fn('post_add($1, $2, $3, $4, null, 10)', [ala, ev, 'important', 'Bag checks']);
      expect(
        (await fn<{ posts: { kind: string }[] }>('event_posts_get($1)', [ev])).posts[0]!.kind,
      ).toBe('important');
      // Not the organiser: refused.
      await expect(
        fn('post_add($1, $2, $3, $4, null, 10)', [ola, ev, 'info', 'x']),
      ).rejects.toMatchObject({
        code: 'P0002',
      });
      const queue = await fn<{ disagreements: { eventId: string }[] }>('moderation_queue()');
      expect(queue.disagreements.map((d) => d.eventId)).toContain(ev);
    });

    it('hiding a reported schedule change restores the times', async () => {
      const before = (await db.query('select start_at from events where id = $1', [ev])).rows[0]
        .start_at;
      const p = await fn<{ id: string }>('post_add($1, $2, $3, $4, $5, 10)', [
        ala,
        ev,
        'schedule',
        'Later',
        { start_at: new Date(Date.now() + 6 * 3_600_000).toISOString() },
      ]);
      await fn('post_report($1, $2, $3, null)', [p.id, 'rep', 'wrong_info']);
      expect((await fn<{ id: string }[]>('post_reports_queue()')).map((x) => x.id)).toContain(p.id);
      await fn('post_moderate($1, $2, $3)', [p.id, 'hide', 'mod']);
      const after = (await db.query('select start_at from events where id = $1', [ev])).rows[0]
        .start_at;
      expect(after.toISOString()).toBe(before.toISOString());
    });

    it('edits: organiser at once, untrusted contributor through moderation', async () => {
      expect(
        await fn('event_edit($1, $2, $3, false)', [ala, ev, { title: 'Ala live', hidden: true }]),
      ).toEqual({
        status: 'applied',
        role: 'organiser',
      });
      expect(
        (await db.query('select title, hidden from events where id = $1', [ev])).rows[0],
      ).toEqual({
        title: 'Ala live',
        hidden: false,
      });
      await expect(
        fn('event_edit($1, $2, $3, false)', [ewa, ev, { title: 'x' }]),
      ).rejects.toMatchObject({
        code: 'P0002',
      });
      // Ewa added an event (approved): her edit waits.
      const mine = `test:${tag}-ewa`;
      await publicEvent(mine);
      await db.query(
        `insert into submissions (kind, status, submitter_hash, user_id, event_id) values ('user', 'approved', 'h', $1, $2)`,
        [ewa, mine],
      );
      expect(await fn('event_edit($1, $2, $3, false)', [ewa, mine, { title: 'Better' }])).toEqual({
        status: 'pending',
        role: 'contributor',
      });
      const queue = await fn<{ id: number; eventId: string }[]>('edits_queue()');
      const edit = queue.find((q) => q.eventId === mine)!;
      await fn('edit_decide($1, true, $2)', [edit.id, 'mod']);
      expect((await db.query('select title from events where id = $1', [mine])).rows[0].title).toBe(
        'Better',
      );
      const list = await fn<{ id: string; role: string }[]>('my_events($1)', [ewa]);
      expect(list).toEqual([expect.objectContaining({ id: mine, role: 'contributor' })]);
    });

    it('reports: private ones reach the organiser unless abuse; the organiser answers', async () => {
      await fn('report_event($1, $2, null, $3)', [party, 'wrong_info', 'r1']);
      await fn('report_event($1, $2, null, $3)', [party, 'unlawful', 'r2']);
      await fn('report_event($1, $2, null, $3)', [ev, 'cancelled', 'r3']);
      const mod = await fn<{ reports: { event_id: string; count: number }[] }>(
        'moderation_queue()',
      );
      expect(mod.reports.find((r) => r.event_id === party)?.count).toBe(1);
      expect(mod.reports.find((r) => r.event_id === ev)?.count).toBe(1);
      const forAla = await fn<{ id: string; audience: string }[]>('organiser_reports($1, $2)', [
        ala,
        party,
      ]);
      expect(forAla.map((r) => r.audience).sort()).toEqual(['moderators', 'organiser']);
      await expect(fn('organiser_reports($1, $2)', [ola, party])).rejects.toMatchObject({
        code: 'P0002',
      });
      const own = forAla.find((r) => r.audience === 'organiser')!;
      await fn('organiser_report_answer($1, $2, $3)', [ala, own.id, 'Fixed']);
      expect(await fn('organiser_reports($1, $2)', [ala, party])).toHaveLength(1);
      // The public event's report: answered, still with the moderators.
      const pub = (await fn<{ id: string }[]>('organiser_reports($1, $2)', [ala, ev]))[0]!;
      await fn('organiser_report_answer($1, $2, $3)', [ala, pub.id, 'On as planned']);
      const after = await fn<{ reports: { event_id: string; organiser_note: string }[] }>(
        'moderation_queue()',
      );
      expect(after.reports.find((r) => r.event_id === ev)?.organiser_note).toBe('On as planned');
    });

    it('queues a notice for everyone interested who allowed notifications', async () => {
      await db.query(
        `insert into push_subscriptions (endpoint, p256dh, auth, device_hash, user_id, lang)
         values ($1, $2, $3, $4, $5, 'pl'), ($6, $2, $3, $7, null, 'en')`,
        [
          `https://push.example/${tag}/ola`,
          'p'.repeat(60),
          'a'.repeat(16),
          `ola-${tag}`,
          ola,
          `https://push.example/${tag}/anon`,
          `anon-${tag}`,
        ],
      );
      // Ola is a guest with a reminder; the anonymous device marked nothing.
      expect(
        await fn('notice_enqueue($1, $2, $3, $4, 100)', [party, 'schedule', 'Moved', ala]),
      ).toBe(1);
      const due = await fn<{ id: number; endpoint: string; title: string }[]>(
        'notices_due(10, $1)',
        [party],
      );
      expect(due.map((d) => d.endpoint)).toEqual([`https://push.example/${tag}/ola`]);
      await fn('notices_done($1, $2)', [due.map((d) => d.id), []]);
      expect(await fn('notices_due(10, $1)', [party])).toEqual([]);
    });
  });

  describe('export, deletion and retention', () => {
    it('exports everything about private events and organisers, and deleting removes private events', async () => {
      const out = await fn<Record<string, unknown[]>>('account_export($1)', [ala]);
      for (const k of [
        'contacts',
        'groups',
        'contactLinks',
        'privateEvents',
        'invitationsSent',
        'claims',
        'posts',
        'edits',
      ])
        expect(out[k], k).not.toEqual([]);
      const ola2 = await fn<Record<string, unknown[]>>('account_export($1)', [ola]);
      expect(ola2.invitationsReceived).toHaveLength(1);
      await fn('account_forget($1, $2)', [ala, `ala-${tag}@example.org`]);
      await db.query('delete from auth.users where id = $1', [ala]);
      expect((await db.query('select 1 from events where id = $1', [party])).rowCount).toBe(0);
      expect(await fn('private_events_for($1)', [ola])).toEqual([]);
      expect(await fn('event_organiser($1)', [`test:${tag}-claimed`])).toBeNull();
    });

    it('drops private events some days after they end', async () => {
      const old = await submitPrivate(ewa, `Old ${tag}`);
      await db.query(
        `update events set start_at = now() - interval '40 days', end_at = now() - interval '39 days' where id = $1`,
        [old],
      );
      expect(await fn<number>('private_cleanup(30)')).toBeGreaterThanOrEqual(1);
      expect((await db.query('select 1 from events where id = $1', [old])).rowCount).toBe(0);
    });
  });
});
