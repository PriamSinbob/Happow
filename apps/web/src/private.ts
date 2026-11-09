import { useEffect, useSyncExternalStore } from 'react';
import type { LatLng, NearbyEvent } from '@happow/core';
import { api, ApiError } from './api';
import { accessToken } from './auth';
import { rowToEvent, type Row } from './data/supabase';
import { invitations } from './invitations';
import { storage } from './storage';

/**
 * Private events: the ones you own or are invited to, read from the API with your sign-in
 * (never the public snapshot). They show locked on the map in every view, in the Private view,
 * and in My plans once accepted. Kept in memory only, so signing out clears them.
 */

export interface InvitationState {
  id: string;
  status: 'pending' | 'accepted' | 'declined';
  seenAt: string | null;
}

export interface PrivateEvent extends NearbyEvent {
  visibility: 'private';
  /** You created it. */
  mine: boolean;
  ownerName: string | null;
  invitation: InvitationState | null;
  /** When the start, end or status last changed by hand, and the newest post (the agenda dot). */
  changedAt: string | null;
  lastPostAt: string | null;
  /** Opened through an invite link that is still free to take. */
  link?: boolean;
}

interface PrivateRow extends Row {
  mine: boolean;
  owner_name: string | null;
  invitation: InvitationState | null;
  changed_at: string | null;
  last_post_at: string | null;
  link?: boolean;
}

export function rowToPrivate(r: PrivateRow): PrivateEvent {
  return {
    ...rowToEvent(r),
    visibility: 'private',
    mine: r.mine,
    ownerName: r.owner_name,
    invitation: r.invitation,
    changedAt: r.changed_at,
    lastPostAt: r.last_post_at,
    ...(r.link && { link: true }),
  };
}

export const isPrivate = (e: NearbyEvent): e is PrivateEvent =>
  (e as Partial<PrivateEvent>).visibility === 'private';

/** Something changed since you last opened it: a new time, a cancellation or a post. */
export function hasNews(e: PrivateEvent): boolean {
  const seen = e.invitation?.seenAt;
  if (!seen || e.mine) return false;
  const latest = Math.max(Date.parse(e.changedAt ?? '') || 0, Date.parse(e.lastPostAt ?? '') || 0);
  return latest > Date.parse(seen);
}

let list: readonly PrivateEvent[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  // My plans and Private read the same list.
  invitations.set(
    list.map((e) => ({
      id: e.id,
      private: true,
      status: e.mine ? 'owner' : e.invitation?.status === 'accepted' ? 'accepted' : 'pending',
    })),
  );
  for (const l of listeners) l();
};

export const privateEvents = {
  list: () => list,
  set(next: readonly PrivateEvent[]) {
    list = next;
    emit();
  },
  /** Signed out: nothing private stays on the device. */
  clear() {
    if (!list.length) return;
    list = [];
    emit();
  },
  /** One event's local copy after an answer or an edit, until the next read. */
  patch(id: string, change: Partial<PrivateEvent> | null) {
    list = change
      ? list.map((e) => (e.id === id ? { ...e, ...change } : e))
      : list.filter((e) => e.id !== id);
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const snapshot = () => list;
export function usePrivateEvents(): readonly PrivateEvent[] {
  return useSyncExternalStore(privateEvents.subscribe, snapshot, snapshot);
}

/** Reads your private events now (pending and accepted invitations, and your own). */
export async function refreshPrivate(center: LatLng | null): Promise<void> {
  const token = await accessToken();
  if (!token) {
    privateEvents.clear();
    return;
  }
  const q = center ? `?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}` : '';
  const { events } = await api<{ events: PrivateRow[] }>(`private${q}`, { token });
  privateEvents.set(events.map(rowToPrivate));
}

/**
 * Keeps the list fresh while signed in: on sign-in, then every `minutes`. Declined and revoked
 * invitations leave at the next read.
 */
export function usePrivateSync(signedIn: boolean, center: LatLng, minutes: number): void {
  const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  useEffect(() => {
    if (!signedIn) {
      privateEvents.clear();
      return;
    }
    let live = true;
    const run = () =>
      refreshPrivate(center).catch((err) => {
        // Offline: keep what we have. Signed out on the server: clear.
        if (live && err instanceof ApiError && err.status === 401) privateEvents.clear();
      });
    void run();
    const id = setInterval(run, minutes * 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
    // The centre only moves the distances; re-read when it moves more than ~100 m.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, key, minutes]);
}

// ---------- Invite links (?i=<token> on /e/<id>) ----------

const INVITES = 'inviteLinks';

function readInvites(): Record<string, string> {
  try {
    return JSON.parse(storage.get(INVITES) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * An invite link's token (`/e/<id>?i=…`, already `/?i=…#/e/<id>`): remembered for that event
 * until it is accepted, then taken out of the address, as the share token is.
 */
export function captureInvite(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('i');
  if (!token) return;
  params.delete('i');
  const m = /^#\/e\/(.+)$/.exec(window.location.hash);
  if (m && /^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    try {
      const id = decodeURIComponent(m[1]!);
      storage.set(INVITES, JSON.stringify({ ...readInvites(), [id]: token }));
    } catch {
      /* a broken id */
    }
  }
  const rest = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
  );
}

export const inviteToken = (eventId: string): string | null => readInvites()[eventId] ?? null;
function forgetInvite(eventId: string): void {
  const map = readInvites();
  delete map[eventId];
  storage.set(INVITES, JSON.stringify(map));
}

/** One private event for its owner, an invitee, or the holder of a live invite link. */
export async function fetchPrivateEvent(
  id: string,
  center: LatLng | null,
): Promise<PrivateEvent | null> {
  const token = await accessToken();
  const link = inviteToken(id);
  if (!token && !link) return null;
  const q = new URLSearchParams();
  if (link) q.set('i', link);
  if (center) {
    q.set('lat', center.lat.toFixed(5));
    q.set('lng', center.lng.toFixed(5));
  }
  try {
    const { event } = await api<{ event: PrivateRow }>(
      `private/${encodeURIComponent(id)}${q.size ? `?${q}` : ''}`,
      { token },
    );
    return rowToPrivate(event);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 401)) return null;
    throw err;
  }
}

export async function answerInvitation(id: string, accept: boolean): Promise<void> {
  const token = await accessToken();
  const { status } = await api<{ status: 'accepted' | 'declined' }>(
    `private/${encodeURIComponent(id)}/answer`,
    { token, body: { accept } },
  );
  const e = list.find((x) => x.id === id);
  if (e?.invitation) privateEvents.patch(id, { invitation: { ...e.invitation, status } });
  if (status === 'declined') privateEvents.patch(id, null);
}

/** Takes an invite link with your account; the event is then yours to see. */
export async function acceptInviteLink(eventId: string, center: LatLng | null): Promise<void> {
  const link = inviteToken(eventId);
  if (!link) throw new ApiError(404, 'not_found');
  const token = await accessToken();
  await api('invitations/accept', { token, body: { token: link } });
  forgetInvite(eventId);
  await refreshPrivate(center);
}

// ---------- The organiser's side ----------

export interface Guest {
  id?: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  name: string | null;
  label?: string | null;
  link?: boolean;
  /** An unused link's token, to share it again. */
  token?: string | null;
  person?: string | null;
}

export async function loadGuests(eventId: string): Promise<Guest[]> {
  const token = await accessToken();
  const { guests } = await api<{ guests: Guest[] }>(
    `private/${encodeURIComponent(eventId)}/guests`,
    { token },
  );
  return guests;
}

export async function invitePeople(
  eventId: string,
  people: string[],
  groups: number[],
): Promise<number> {
  const token = await accessToken();
  const { invited } = await api<{ invited: number }>(
    `private/${encodeURIComponent(eventId)}/invite`,
    { token, body: { people, groups } },
  );
  return invited;
}

/** A single-use invite link, as an absolute URL to share. */
export async function inviteLink(eventId: string, label: string): Promise<string> {
  const token = await accessToken();
  const { url } = await api<{ url: string }>(`private/${encodeURIComponent(eventId)}/invite`, {
    token,
    body: { link: true, ...(label.trim() && { label: label.trim() }) },
  });
  return `${window.location.origin}${url}`;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const token = await accessToken();
  await api(`invitations/${invitationId}`, { token, method: 'DELETE' });
}
