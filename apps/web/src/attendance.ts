import { api, deviceId } from './api';
import { accessToken } from './auth';
import { storage } from './storage';

/**
 * "I'm going", co-presence and share links on the device (M9 §5, §6). Everything is anonymous: the
 * server sees this device's random id (hashed there), and the account only when signed in.
 */

export type Signal = 'going' | 'looking' | 'onway' | 'here';

export interface AttendanceView {
  /** Bucketed (5, 10, 25 …); null = don't show (below the threshold, or a sensitive category). */
  counts: Record<Signal, number | null>;
  mine: Record<Signal, boolean>;
  /** People who came through this device's links and are going; null where counts are off. */
  fromMyLinks: number | null;
}

/** Small JSON maps in local storage, never throwing. */
function readMap(key: string): Record<string, string> {
  try {
    return JSON.parse(storage.get(key) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
function writeMap(key: string, map: Record<string, string>) {
  // Keep the newest 200 entries: enough for a person's links, never growing without end.
  storage.set(key, JSON.stringify(Object.fromEntries(Object.entries(map).slice(-200))));
}

const ARRIVED = 'arrivedVia';
const SHARES = 'shareTokens';

/**
 * A shared link's token (`?s=` on /e/<id>, already turned into `/?s=…#/e/<id>`): remembered for
 * that event, so marking "going" later counts for whoever shared it, then taken out of the URL.
 * The first link a device arrived with for an event is kept.
 */
export function captureArrival(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('s');
  if (!token) return;
  params.delete('s');
  const m = /^#\/e\/(.+)$/.exec(window.location.hash);
  if (m && /^[A-Za-z0-9_-]{8,64}$/.test(token)) {
    try {
      const id = decodeURIComponent(m[1]!);
      const map = readMap(ARRIVED);
      if (!map[id]) writeMap(ARRIVED, { ...map, [id]: token });
    } catch {
      /* a broken id: nothing to remember */
    }
  }
  const rest = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
  );
}

export function arrivalToken(eventId: string): string | null {
  return readMap(ARRIVED)[eventId] ?? null;
}

export async function getAttendance(eventId: string): Promise<AttendanceView> {
  return api<AttendanceView>('attendance', { body: { deviceId: deviceId(), eventId } });
}

export async function setAttendance(
  eventId: string,
  kind: Signal,
  on: boolean,
  forSeconds?: number,
): Promise<AttendanceView> {
  return api<AttendanceView>('attendance/set', {
    body: { deviceId: deviceId(), eventId, kind, on, token: arrivalToken(eventId), forSeconds },
    token: await accessToken().catch(() => null),
  });
}

/** This device's share token for an event: made once, then reused for every share of it. */
export async function shareToken(eventId: string): Promise<string> {
  const known = readMap(SHARES)[eventId];
  if (known) return known;
  const { token } = await api<{ token: string }>('share', {
    body: { deviceId: deviceId(), eventId },
  });
  writeMap(SHARES, { ...readMap(SHARES), [eventId]: token });
  return token;
}

/** When this device last said it was looking at an event, so a re-opened card doesn't resend it. */
const lookedAt = new Map<string, number>();

/**
 * Opening a card: "looking" for the next few minutes (§6), sent at most once per half that window
 * per event, then the card's view. Falls back to only reading the view.
 */
export async function lookAt(eventId: string, minutes: number): Promise<AttendanceView> {
  const last = lookedAt.get(eventId) ?? 0;
  if (Date.now() - last < (minutes / 2) * 60_000) return getAttendance(eventId);
  lookedAt.set(eventId, Date.now());
  return setAttendance(eventId, 'looking', true, minutes * 60).catch(() => getAttendance(eventId));
}

/** A signal sent without waiting for it (GoThere's "on the way"); failures are ignored. */
export function signalQuietly(eventId: string, kind: Signal, on: boolean): void {
  setAttendance(eventId, kind, on).catch(() => {
    /* offline: the count just won't include this device */
  });
}
