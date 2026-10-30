import { attendanceBucket, type HappowConfig } from '@happow/core';
import { z } from 'zod';
import { ApiError, body, json, sha256 } from './http.js';
import type { Supabase } from './supabase.js';

/**
 * "I'm going", co-presence and share links on the server (M9 §5, §6). Anonymous: a device is its
 * salted hash, as for submissions. Counts leave as buckets from the threshold up, and not at all
 * for categories with publicAttendance: false. A sharer's link count has no threshold (it's their
 * own link) but follows the same category rule.
 */

export const SIGNALS = ['going', 'looking', 'onway', 'here'] as const;
export type Signal = (typeof SIGNALS)[number];

export interface AttendanceDeps {
  config: HappowConfig;
  need: () => { db: Supabase; salt: string };
  now: () => Date;
  limit: (bucket: string, actor: string, windowSeconds: number, max: number) => Promise<void>;
  /** The signed-in account, if any: kept with the row for M11's friends' view, never shown. */
  userOf: (req: Request) => Promise<{ id: string } | null>;
}

/** What the card shows: bucketed counts (null = don't show), this device's own signals. */
export interface AttendanceView {
  counts: Record<Signal, number | null>;
  mine: Record<Signal, boolean>;
  /** People who came through this device's links and are going; null where counts are off. */
  fromMyLinks: number | null;
}

interface Raw {
  categories: string[] | null;
  counts: Partial<Record<Signal, number>>;
  mine: Signal[];
  fromMyLinks: number;
}

const deviceId = z.string().min(8).max(100);
const eventId = z.string().min(1).max(300);
const viewSchema = z.object({ deviceId, eventId });
const setSchema = z.object({
  deviceId,
  eventId,
  kind: z.enum(SIGNALS),
  on: z.boolean(),
  /** The share link this device arrived with. */
  token: z.string().min(8).max(64).nullable().optional(),
  /** Seconds a short-lived signal lasts ("looking", slice F). */
  forSeconds: z.number().int().positive().max(86_400).optional(),
});

/** 16 random bytes, URL-safe: a share link's token. */
function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function attendanceRoutes({ config, need, now, limit, userOf }: AttendanceDeps) {
  const cfg = config.app.attendance;
  const hidden = new Set(config.categories.filter((c) => !c.publicAttendance).map((c) => c.id));

  /** Raw database counts to what the card may show. */
  function view(raw: Raw): AttendanceView {
    const off = (raw.categories ?? []).some((c) => hidden.has(c));
    const counts = Object.fromEntries(
      SIGNALS.map((s) => [s, off ? null : attendanceBucket(raw.counts[s] ?? 0, cfg)]),
    ) as AttendanceView['counts'];
    const mine = Object.fromEntries(
      SIGNALS.map((s) => [s, raw.mine.includes(s)]),
    ) as AttendanceView['mine'];
    return { counts, mine, fromMyLinks: off ? null : raw.fromMyLinks };
  }

  const device = (salt: string, id: string) => sha256(`${salt}:device:${id}`);

  /** POST /api/attendance: the card's counts and this device's signals. */
  async function get(req: Request): Promise<Response> {
    const { db, salt } = need();
    const input = await body(req, viewSchema);
    const raw = await db.rpc<Raw>('attendance_get', {
      p_event: input.eventId,
      p_device: await device(salt, input.deviceId),
    });
    if (!raw.categories) throw new ApiError(404, 'not_found');
    return json(view(raw));
  }

  /** POST /api/attendance/set: one signal on or off; the event must not have ended. */
  async function set(req: Request): Promise<Response> {
    const { db, salt } = need();
    const input = await body(req, setSchema);
    const hash = await device(salt, input.deviceId);
    await limit('attendance', hash, 3600, cfg.perHourPerDevice);
    const user = await userOf(req).catch(() => null);
    const raw = await db.rpc<Raw | null>('attendance_set', {
      p_event: input.eventId,
      p_device: hash,
      p_user: user?.id ?? null,
      p_kind: input.kind,
      p_on: input.on,
      p_token: input.token ?? null,
      p_keep_hours: cfg.keepAfterEndHours,
      p_until: input.forSeconds
        ? new Date(now().getTime() + input.forSeconds * 1000).toISOString()
        : null,
    });
    if (!raw) throw new ApiError(404, 'not_found');
    return json(view(raw));
  }

  /** POST /api/share: a new share link token for this device and event (§5). */
  async function share(req: Request): Promise<Response> {
    const { db, salt } = need();
    const input = await body(req, viewSchema);
    const hash = await device(salt, input.deviceId);
    await limit('share', hash, 3600, cfg.sharesPerHourPerDevice);
    const token = newToken();
    const ok = await db.rpc<boolean>('share_link_create', {
      p_token: token,
      p_event: input.eventId,
      p_device: hash,
    });
    if (!ok) throw new ApiError(404, 'not_found');
    return json({ token }, 201);
  }

  return {
    async route(req: Request, head: string, rest: string[]): Promise<Response> {
      if (req.method !== 'POST') throw new ApiError(404, 'not_found');
      if (head === 'share' && !rest.length) return share(req);
      if (head === 'attendance' && !rest.length) return get(req);
      if (head === 'attendance' && rest.join('/') === 'set') return set(req);
      throw new ApiError(404, 'not_found');
    },
  };
}
