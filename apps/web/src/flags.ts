import { useCallback, useState } from 'react';
import { SOURCE_MISSING, type EventFlag, type FlagReason, type NearbyEvent } from '@happow/core';
import { config } from './config';

const KEY = 'happow:my-reports';
const { flagThreshold } = config.app.submissions;

/** Status reports sent from this device in this session: shown at once, before the next reload. */
export type MyReports = Record<string, { reason: FlagReason; at: string }>;

function load(): MyReports {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as MyReports;
  } catch {
    return {};
  }
}

export function useMyReports(): [MyReports, (id: string, reason: FlagReason) => void] {
  const [mine, setMine] = useState(load);
  const add = useCallback((id: string, reason: FlagReason) => {
    setMine((m) => {
      const next = { ...m, [id]: { reason, at: new Date().toISOString() } };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }, []);
  return [mine, add];
}

/**
 * The warning everyone should see: the server's open reports once they reach the threshold, or
 * this device's own report right away (counted as at least one), or else the source signal
 * (a source that lists everything stopped listing the event).
 */
export function visibleFlag(ev: NearbyEvent, mine: MyReports): EventFlag | null {
  const server = ev.flag ?? null;
  const fromSource = server?.reason === SOURCE_MISSING;
  if (server && !fromSource && server.count >= flagThreshold) return server;
  const own = mine[ev.id];
  if (own) return { reason: own.reason, count: Math.max(1, server?.count ?? 0), at: own.at };
  return fromSource ? server : null;
}

export function withFlag<T extends NearbyEvent>(ev: T, mine: MyReports): T {
  const flag = visibleFlag(ev, mine);
  return flag === (ev.flag ?? null) ? ev : { ...ev, flag };
}
