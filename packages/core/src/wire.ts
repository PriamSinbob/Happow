import type { EntryType, LatLng } from './types.js';

/**
 * What /api answers with, where the server and the app both name the shape. One definition for
 * both, so a change on one side fails the other's typecheck. A native app or an embedded widget
 * reads the same contract.
 */

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
