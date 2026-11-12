import type { HappowConfig } from '@happow/core';
import { z } from 'zod';
import type { User } from './accounts.js';
import {
  ApiError,
  body,
  json,
  type Limit,
  deviceId,
  eventId,
  uuid,
  noStore,
  deviceHash,
  type Need,
} from './http.js';
import { announce } from './notices.js';
import { SupabaseError } from './supabase.js';

/**
 * Private events, contacts and invitations. Everything here needs an account; nothing
 * is cached anywhere but the person's own device. Links are shared through the phone's share
 * sheet, not by email. An account that still waits for its code may read what it is invited to
 * and accept or decline (an invitation, an invite link, a contact link); the rest needs the code.
 *
 *   GET    /api/private                     the private events you own or are invited to
 *   GET    /api/private/:id?i=<token>       one, for you or for a live invite link
 *   POST   /api/private/:id/invite          {people?, groups?} or {link: true, label?}
 *   GET    /api/private/:id/guests          the organiser's list; accepted guests see who else
 *   POST   /api/private/:id/answer          {accept}
 *   POST   /api/private/:id/transfer        {to}: the owner hands the event to an accepted guest
 *   POST   /api/invitations/accept          {token}: an invite link
 *   DELETE /api/invitations/:id             revoke (the organiser)
 *   GET    /api/contacts                    contacts, groups, your contact link
 *   POST   /api/contacts/link               a new contact link (the old one stops working)
 *   GET    /api/contacts/link/:token        whose link it is (no account needed to see the name)
 *   POST   /api/contacts/link/:token        add them
 *   POST   /api/contacts/:id                {action: remove | block | unblock}
 *   POST   /api/contacts/groups             {id?, name, members?}
 *   DELETE /api/contacts/groups/:id
 *   POST   /api/friends                     {eventId, deviceId}: friends going
 *   PUT    /api/friends                     {eventId, show: true | false | null}
 */

export interface PrivateDeps {
  config: HappowConfig;
  need: Need;
  requireUser: (req: Request) => Promise<User>;
  /** As `requireUser`, with accounts that wait for activation. */
  requireAnyUser: (req: Request) => Promise<User>;
  limit: Limit;
  now: () => Date;
  fetch?: typeof fetch;
  pushSecret: string | undefined;
}

const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** A random URL-safe token (128 bits). */
export function newToken(bytes = 16): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const point = (u: URL) => {
  const lat = Number(u.searchParams.get('lat'));
  const lng = Number(u.searchParams.get('lng'));
  return u.searchParams.has('lat') && Number.isFinite(lat) && Number.isFinite(lng)
    ? { p_lat: lat, p_lng: lng }
    : { p_lat: null, p_lng: null };
};

/** Database refusals as API errors. */
function mapError(err: unknown): never {
  if (err instanceof SupabaseError) {
    if (err.code === 'P0002') throw new ApiError(404, 'not_found');
    if (err.code === 'HQ010') throw new ApiError(409, 'own_item');
    if (err.code === 'HQ011') throw new ApiError(403, 'blocked');
    if (err.code === 'HQ012') throw new ApiError(409, 'too_many_groups');
    if (err.code === 'HQ013') throw new ApiError(409, 'too_many_invitations');
  }
  throw err;
}

export function privateRoutes({
  config,
  need,
  requireUser,
  requireAnyUser,
  limit,
  now,
  fetch: doFetch,
  pushSecret,
}: PrivateDeps) {
  const cfg = config.app.private;
  const rpc = async <T>(name: string, args: object): Promise<T> => {
    try {
      return await need().db.rpc<T>(name, args);
    } catch (err) {
      mapError(err);
    }
  };
  const guard = (user: User) => limit('private', user.id, 3600, cfg.perHourPerAccount);
  /** Contacts and invitations show your name: it has to be set first. */
  async function named(user: User) {
    const p = await rpc<{ displayName: string | null }>('profile_get', { p_user: user.id });
    if (!p.displayName) throw new ApiError(409, 'name_required');
  }

  async function privateEvents(req: Request, path: string[]): Promise<Response> {
    const u = new URL(req.url);
    const [id, action] = path;
    if (!id && req.method === 'GET') {
      const user = await requireAnyUser(req);
      return json(
        { events: await rpc('private_events_for', { p_user: user.id, ...point(u) }) },
        200,
        noStore,
      );
    }
    if (!id || !eventId.safeParse(id).success) throw new ApiError(404, 'not_found');
    if (!action && req.method === 'GET') {
      // A link invitation opens the card before signing in; otherwise an account.
      const linkToken = u.searchParams.get('i');
      const user = req.headers.has('authorization') ? await requireAnyUser(req) : null;
      if (!user && !linkToken) throw new ApiError(401, 'unauthorized');
      const ev = await rpc<{ invitation: { status: string } | null } | null>('private_event_get', {
        p_user: user?.id ?? null,
        p_event: id,
        p_token: linkToken && token.safeParse(linkToken).success ? linkToken : null,
        ...point(u),
      });
      if (!ev) throw new ApiError(404, 'not_found');
      if (user && ev.invitation) await rpc('invitation_seen', { p_user: user.id, p_event: id });
      return json({ event: ev }, 200, noStore);
    }
    // Reading the guests and answering are open to a waiting account; the rest is the owner's.
    const user = await (
      (action === 'guests' && req.method === 'GET') ||
        (action === 'answer' && req.method === 'POST')
        ? requireAnyUser
        : requireUser
    )(req);
    if (action === 'transfer' && req.method === 'POST') {
      await guard(user);
      const { to } = await body(req, z.object({ to: uuid }));
      const r = await rpc<{ owner: string; ownerName: string | null }>('event_transfer', {
        p_user: user.id,
        p_event: id,
        p_to: to,
      });
      // The guests learn who runs it now; the one who handed it over does not need telling.
      const lang = config.app.languages[0] === 'en' ? 'en' : 'pl';
      const who = r.ownerName ?? '';
      const notified = await announce(
        need().db,
        pushSecret,
        config.app,
        now(),
        {
          event: id,
          kind: 'important',
          body: (lang === 'en' ? `New organiser: ${who}` : `Nowy organizator: ${who}`).trim(),
          except: user.id,
        },
        doFetch,
      );
      return json({ ok: true, ownerName: r.ownerName, notified }, 200, noStore);
    }
    if (action === 'invite' && req.method === 'POST') {
      await guard(user);
      await named(user);
      const input = await body(
        req,
        z.union([
          z.object({ link: z.literal(true), label: z.string().trim().max(40).optional() }),
          z.object({
            people: z.array(uuid).max(200).optional(),
            groups: z.array(z.number().int().positive()).max(20).optional(),
          }),
        ]),
      );
      if ('link' in input) {
        const t = newToken();
        const invitation = await rpc<string>('invite_link', {
          p_user: user.id,
          p_event: id,
          p_token: t,
          p_label: input.label ?? null,
          p_max: cfg.maxInvitationsPerEvent,
        });
        return json(
          { id: invitation, token: t, url: `/e/${encodeURIComponent(id)}?i=${t}` },
          201,
          noStore,
        );
      }
      const invited = await rpc<number>('invite_people', {
        p_user: user.id,
        p_event: id,
        p_people: input.people ?? [],
        p_groups: input.groups ?? [],
        p_max: cfg.maxInvitationsPerEvent,
      });
      return json({ invited }, 200, noStore);
    }
    if (action === 'guests' && req.method === 'GET')
      return json(
        { guests: await rpc('event_guests', { p_user: user.id, p_event: id }) },
        200,
        noStore,
      );
    if (action === 'answer' && req.method === 'POST') {
      await guard(user);
      const { accept } = await body(req, z.object({ accept: z.boolean() }));
      const status = await rpc<string>('invitation_answer', {
        p_user: user.id,
        p_event: id,
        p_accept: accept,
      });
      return json({ status }, 200, noStore);
    }
    throw new ApiError(404, 'not_found');
  }

  async function invitations(req: Request, path: string[]): Promise<Response> {
    const accepting = path.join('/') === 'accept' && req.method === 'POST';
    const user = await (accepting ? requireAnyUser : requireUser)(req);
    await guard(user);
    if (accepting) {
      await named(user);
      const input = await body(req, z.object({ token }));
      const id = await rpc<string>('invitation_accept_link', {
        p_user: user.id,
        p_token: input.token,
      });
      return json({ eventId: id }, 200, noStore);
    }
    if (path.length === 1 && req.method === 'DELETE' && uuid.safeParse(path[0]).success) {
      if (!(await rpc<boolean>('invitation_revoke', { p_user: user.id, p_id: path[0] })))
        throw new ApiError(404, 'not_found');
      return json({ ok: true }, 200, noStore);
    }
    throw new ApiError(404, 'not_found');
  }

  async function contacts(req: Request, path: string[]): Promise<Response> {
    // Whose link is this: shown before signing in, so the person knows whom they'd add.
    if (path[0] === 'link' && path.length === 2 && req.method === 'GET') {
      if (!token.safeParse(path[1]).success) throw new ApiError(404, 'not_found');
      const owner = await rpc<{ name: string | null } | null>('contact_link_owner', {
        p_token: path[1],
      });
      if (!owner) throw new ApiError(404, 'not_found');
      return json({ name: owner.name }, 200, noStore);
    }
    // Taking someone's contact link is accepting an invitation: open to a waiting account.
    const taking = path[0] === 'link' && path.length === 2 && req.method === 'POST';
    const user = await (taking ? requireAnyUser : requireUser)(req);
    if (!path.length && req.method === 'GET')
      return json(await rpc('contacts_list', { p_user: user.id }), 200, noStore);
    await guard(user);
    if (path[0] === 'link' && path.length === 1 && req.method === 'POST') {
      await named(user);
      const t = await rpc<string>('contact_link_new', { p_user: user.id, p_token: newToken() });
      return json({ token: t, url: `/c/${t}` }, 201, noStore);
    }
    if (path[0] === 'link' && path.length === 2 && req.method === 'POST') {
      if (!token.safeParse(path[1]).success) throw new ApiError(404, 'not_found');
      await named(user);
      const list = await rpc<{ contacts: unknown[] }>('contacts_list', { p_user: user.id });
      if (list.contacts.length >= cfg.maxContacts) throw new ApiError(409, 'too_many_contacts');
      return json(
        await rpc('contact_link_accept', { p_user: user.id, p_token: path[1] }),
        200,
        noStore,
      );
    }
    if (path[0] === 'groups') {
      if (path.length === 1 && req.method === 'POST') {
        const input = await body(
          req,
          z.object({
            id: z.number().int().positive().nullable().optional(),
            name: z.string().trim().min(1).max(40),
            members: z.array(uuid).max(cfg.maxContacts).optional(),
          }),
        );
        const id = await rpc<number>('group_save', {
          p_user: user.id,
          p_id: input.id ?? null,
          p_name: input.name,
          p_members: input.members ?? null,
          p_max: cfg.maxGroups,
        });
        return json({ id: Number(id) }, 200, noStore);
      }
      if (path.length === 2 && req.method === 'DELETE') {
        const id = Number(path[1]);
        if (
          !Number.isInteger(id) ||
          !(await rpc<boolean>('group_delete', { p_user: user.id, p_id: id }))
        )
          throw new ApiError(404, 'not_found');
        return json({ ok: true }, 200, noStore);
      }
    }
    if (path.length === 1 && req.method === 'POST' && uuid.safeParse(path[0]).success) {
      const { action } = await body(
        req,
        z.object({ action: z.enum(['remove', 'block', 'unblock']) }),
      );
      await rpc('contact_change', { p_user: user.id, p_contact: path[0], p_action: action });
      return json({ ok: true }, 200, noStore);
    }
    throw new ApiError(404, 'not_found');
  }

  async function friends(req: Request, path: string[]): Promise<Response> {
    if (path.length) throw new ApiError(404, 'not_found');
    const user = await requireUser(req);
    if (req.method === 'POST') {
      const input = await body(req, z.object({ eventId, deviceId }));
      const { salt } = need();
      return json(
        await rpc('friends_on_event', {
          p_user: user.id,
          p_event: input.eventId,
          p_device: await deviceHash(salt, input.deviceId),
        }),
        200,
        noStore,
      );
    }
    if (req.method === 'PUT') {
      await guard(user);
      const input = await body(req, z.object({ eventId, show: z.boolean().nullable() }));
      await rpc('friend_override_set', {
        p_user: user.id,
        p_event: input.eventId,
        p_show: input.show,
      });
      return json({ ok: true }, 200, noStore);
    }
    throw new ApiError(404, 'not_found');
  }

  return { privateEvents, invitations, contacts, friends };
}
