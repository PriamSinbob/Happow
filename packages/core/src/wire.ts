import type { EntryType, LatLng } from './types.js';

/**
 * What /api answers with, where the server and the app both name the shape. One definition for
 * both, so a change on one side fails the other's typecheck. A native app or an embedded widget
 * reads the same contract.
 */

/**
 * The API's contract version, sent as `x-happow-api` on every answer. It changes only for a
 * change an installed app could not read; adding fields or endpoints never changes it.
 */
export const API_VERSION = 1;

/**
 * How an app names itself on every request: `x-happow-client: android/1.4.0` (or `ios/…`,
 * `web/…`). The server answers 426 client_outdated to builds below the configured minimum.
 */
export const CLIENT_HEADER = 'x-happow-client';

/** Every `error` code an /api response can carry. */
export const API_ERROR_CODES = [
  'invalid_input',
  'invalid_json',
  'unsafe_url',
  'page_unavailable',
  'outside_region',
  'rate_limited',
  'not_configured',
  'unauthorized',
  'forbidden',
  'unknown_event',
  'already_reviewed',
  'not_found',
  'quota_exceeded',
  'photo_unavailable',
  'photo_too_large',
  'too_many_feeds',
  'feed_stopped',
  'account_required',
  'auth_failed',
  'email_failed',
  'name_required',
  'blocked',
  'too_many_invitations',
  'too_many_groups',
  'too_many_contacts',
  'already_claimed',
  'own_item',
  'reminder_refused',
  /** This app build is older than `native.<platform>.minVersion`: it should ask to update. */
  'client_outdated',
  /** The account waits for its code: only invitations and its own profile work until then. */
  'activation_required',
  'server_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** "I'm going" and co-presence: what a device can say about an event. */
export const ATTENDANCE_SIGNALS = ['going', 'looking', 'onway', 'here'] as const;
export type AttendanceSignal = (typeof ATTENDANCE_SIGNALS)[number];

/** What the card shows of an event's attendance (POST /api/attendance, /api/attendance/set). */
export interface AttendanceView {
  /** Bucketed (5, 10, 25 …); null = don't show (below the threshold, or a sensitive category). */
  counts: Record<AttendanceSignal, number | null>;
  /** This device's own signals. */
  mine: Record<AttendanceSignal, boolean>;
  /** People who came through this device's links and are going; null where counts are off. */
  fromMyLinks: number | null;
}

/** One prefill for the add-event form (POST /api/autofill, /api/autofill/photo). */
export interface Prefill {
  title: string;
  categoryIds: string[];
  /** "2026-10-24T19:00" in the region's time zone, as <input type="datetime-local"> takes it. */
  start: string | null;
  end: string | null;
  venueName: string | null;
  address: string | null;
  point: LatLng | null;
  isFree: boolean | null;
  priceMin: number | null;
  currency: string | null;
  /** None for a poster photo. */
  url: string | null;
  ticketUrl: string | null;
  ageMin: number | null;
  family: boolean | null;
  entry: EntryType | null;
  /** Names as printed, one per line in the form. */
  performers: string[];
}

/** A search hit (GET /api/search) or a followed performer's date (POST /api/follows/match). */
export interface EventHit {
  id: string;
  title: string;
  categoryIds: string[];
  startAt: string;
  endAt: string;
  timezone: string;
  venueName: string | null;
  point: LatLng;
  distanceM: number | null;
  isFree: boolean;
  status: string;
  performers: string[];
  matchedPerformer: string | null;
  /** Search only: how it matched. */
  match?: 'performer' | 'performer_similar' | 'title';
  matchedNorm?: string;
  matchedExternalId?: string | null;
}

/** A Ticketmaster date outside the region: shown in the list with its city, not on the map. */
export interface NationwideDate {
  id: string;
  attractionId: string;
  performer: string;
  title: string;
  startAt: string | null;
  localDate: string | null;
  city: string | null;
  venueName: string | null;
  url: string | null;
  point: LatLng | null;
}

/** A Supabase Auth session as /api hands it out (POST /api/auth/pending). */
export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  /** Seconds the access token lasts. */
  expires_in: number;
}

/** POST /api/auth/pending: the waiting account's session, and the email it waits for. */
export interface PendingSession {
  session: SessionTokens;
  email: string;
}

/** An organiser's post on an event (GET /api/events/:id/posts, POST /api/events/updates). */
export interface EventPost {
  id: string;
  kind: 'schedule' | 'important' | 'info';
  body: string;
  /** A schedule post's change, in the database's column names. */
  change: { start_at?: string; end_at?: string; status?: string } | null;
  createdAt: string;
}

/** One event's news (POST /api/events/updates): events with none are left out of the answer. */
export interface EventUpdates {
  id: string;
  title: string;
  status: string;
  /** The organiser's newest post, and the last change of time or status made by hand. */
  lastPostAt: string | null;
  changedAt: string | null;
  /** The newest posts, newest first (`organiser.updatesPosts` of them). */
  posts: EventPost[];
}
