import { api, deviceId } from './api';
import { accessToken } from './auth';

/** Contacts, groups and the friends' view (M11 §2, §5): calls over `api()`. */

export interface Contact {
  id: string;
  name: string | null;
  blocked: boolean;
  /** Both of you have each other: invitations and the friends' view work. */
  mutual: boolean;
  groups: number[];
}

export interface Group {
  id: number;
  name: string;
  members: number;
}

export interface ContactBook {
  contacts: Contact[];
  groups: Group[];
  /** Your live contact link's token, if you made one. */
  link: string | null;
}

const authed = async () => ({ token: await accessToken() });

export const contactLinkUrl = (token: string) => `${window.location.origin}/c/${token}`;

export async function loadContacts(): Promise<ContactBook> {
  return api<ContactBook>('contacts', await authed());
}

/** A new contact link (the old one stops working). */
export async function newContactLink(): Promise<string> {
  const { token } = await api<{ token: string }>('contacts/link', {
    ...(await authed()),
    body: {},
  });
  return token;
}

/** Whose link this is; works before signing in. */
export async function contactLinkName(token: string): Promise<string | null> {
  const { name } = await api<{ name: string | null }>(`contacts/link/${token}`);
  return name;
}

export async function acceptContactLink(
  token: string,
): Promise<{ id: string; name: string | null }> {
  return api(`contacts/link/${token}`, { ...(await authed()), body: {} });
}

export async function changeContact(id: string, action: 'remove' | 'block' | 'unblock') {
  await api(`contacts/${id}`, { ...(await authed()), body: { action } });
}

export async function saveGroup(input: { id?: number; name: string; members?: string[] }) {
  return api<{ id: number }>('contacts/groups', { ...(await authed()), body: input });
}

export async function deleteGroup(id: number) {
  await api(`contacts/groups/${id}`, { ...(await authed()), method: 'DELETE' });
}

export interface FriendsView {
  /** You show yourself on this event (the account switch, or this event's override). */
  shown: boolean;
  /** This event's override: true or false, or null for the account switch. */
  override: boolean | null;
  friends: { name: string; kinds: ('going' | 'onway' | 'here')[] }[];
  /** Friends who came through your share links (M9 §5's count, with names). */
  fromMyLinks: string[];
}

export async function loadFriends(eventId: string): Promise<FriendsView> {
  return api<FriendsView>('friends', {
    ...(await authed()),
    body: { eventId, deviceId: deviceId() },
  });
}

export async function setFriendsOverride(eventId: string, show: boolean | null) {
  await api('friends', { ...(await authed()), method: 'PUT', body: { eventId, show } });
}
