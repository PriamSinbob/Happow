import { api, deviceId } from './api';
import { accessToken } from './auth';

/** Organisers: claims, posts, edits and "your events", over `api()`. */

export type PostKind = 'schedule' | 'important' | 'info';

export interface Post {
  id: string;
  kind: PostKind;
  body: string;
  change: { start_at?: string; end_at?: string; status?: string } | null;
  createdAt: string;
}

export interface EventPosts {
  organiser: { name: string; kind: 'event' | 'venue' | 'private' } | null;
  posts: Post[];
}

export type EventRole = 'owner' | 'organiser' | 'contributor' | null;

export interface Claim {
  id: string;
  kind: 'event' | 'venue';
  event_id: string | null;
  venue_id: string | null;
  organiser_name: string;
  method: 'site' | 'moderator';
  code: string;
  page_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  title?: string | null;
}

export interface OrganiserReport {
  id: string;
  reason: string;
  note: string | null;
  audience: 'moderators' | 'organiser';
  createdAt: string;
  answer: string | null;
}

export interface Mine {
  role: EventRole;
  claim: Claim | null;
  reports: OrganiserReport[];
  infoPosts: boolean;
}

const enc = encodeURIComponent;

export async function loadPosts(eventId: string): Promise<EventPosts> {
  const token = await accessToken();
  return api<EventPosts>(`events/${enc(eventId)}/posts`, { token });
}

export async function loadMine(eventId: string): Promise<Mine> {
  return api<Mine>(`events/${enc(eventId)}/mine`, { token: await accessToken() });
}

export async function addPost(
  eventId: string,
  input: {
    kind: PostKind;
    body: string;
    change?: { startAt?: string; endAt?: string; status?: string };
  },
): Promise<{ notified: number }> {
  return api(`events/${enc(eventId)}/posts`, { token: await accessToken(), body: input });
}

export async function deletePost(id: string) {
  await api(`posts/${id}`, { token: await accessToken(), method: 'DELETE' });
}

export async function reportPost(id: string, reason: string, note: string | null) {
  await api(`posts/${id}/report`, { body: { deviceId: deviceId(), reason, note } });
}

export interface EditFields {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string;
  status?: 'scheduled' | 'cancelled' | 'postponed';
  isFree?: boolean;
  priceMin?: number | null;
  priceMax?: number | null;
  officialUrl?: string | null;
  ticketUrl?: string | null;
}

export async function editEvent(
  eventId: string,
  fields: EditFields,
): Promise<{ status: 'applied' | 'pending'; notified: number }> {
  return api(`events/${enc(eventId)}/edit`, { token: await accessToken(), body: { fields } });
}

export async function answerReport(eventId: string, reportId: string, note: string) {
  await api(`events/${enc(eventId)}/reports/${reportId}`, {
    token: await accessToken(),
    body: { note },
  });
}

export async function openClaim(input: {
  kind: 'event' | 'venue';
  target: string;
  organiserName: string;
  method: 'site' | 'moderator';
  evidence?: string | null;
}): Promise<Claim> {
  const { claim } = await api<{ claim: Claim }>('claims', {
    token: await accessToken(),
    body: input,
  });
  return claim;
}

export async function checkClaim(id: string): Promise<{
  result: 'approved' | 'missing' | 'blocked' | 'unavailable' | 'no_page' | string;
  claim: Claim;
}> {
  return api(`claims/${id}/check`, { token: await accessToken(), body: {} });
}

export interface MyEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  visibility: 'public' | 'private';
  hidden: boolean;
  role: EventRole;
  submissionId: string | null;
  guests: { accepted: number; pending: number; declined: number } | null;
  posts: number;
  reports: number;
  pendingEdits: number;
}

export async function loadMyEvents(): Promise<MyEvent[]> {
  const { events } = await api<{ events: MyEvent[] }>('me/events', { token: await accessToken() });
  return events;
}

export async function loadMyClaims(): Promise<Claim[]> {
  const { claims } = await api<{ claims: Claim[] }>('me/claims', { token: await accessToken() });
  return claims;
}
