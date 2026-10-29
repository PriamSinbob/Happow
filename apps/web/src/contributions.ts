import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { accessToken } from './auth';
import { config } from './config';
import type { MessageKey } from './i18n/en';

/** One of the account's own events in GET /api/me/contributions (M12 §5). */
export interface MyEvent {
  submissionId: string;
  /** The dates of one weekly repeat share it (M12 §4.5). */
  seriesId?: string | null;
  eventId: string | null;
  title: string;
  startAt: string | null;
  /** For counting the adder's events in a running season (M12 §6.3). */
  endAt?: string | null;
  categoryIds?: string[];
  status: 'pending' | 'approved' | 'rejected';
  trusted: boolean;
  hidden: boolean;
  /** No reward row yet (pending, or added before rewards existed) is null. */
  reward: 'verified' | 'duplicate' | 'revoked' | null;
  days: number;
  opens: number;
  routes: number;
  arrivals: number;
  thanks: number;
  /** Nothing happened at its place lately when it was added (M12 §6.1). */
  firstPlace: boolean;
}

/** GET /api/me/contributions. */
export interface Contributions {
  verified: number;
  opens: number;
  routes: number;
  arrivals: number;
  /** Thanks from visitors who arrived (M12 §6.4); only the adder sees them. */
  thanks: number;
  trusted: boolean;
  monthDays: number;
  level: string | null;
  showName: boolean;
  events: MyEvent[];
  premiumDaysPerEvent: number;
  premiumDaysPerMonth: number;
  trustedAfter: number;
}

/** The reward a submission got at once (a trusted account's event), from POST /api/submissions. */
export interface Reward {
  kind: 'verified' | 'duplicate';
  days: number;
  startsAt: string | null;
}

export const levels = config.plans.contributions.levels;

/** Level ids come from config; a test checks each has its strings in every language. */
export const levelKey = (id: string) => `level.${id}` as MessageKey;

/** The level after `level`, or null at the top (or before the first, the first). */
export function nextLevel(level: string | null) {
  const i = level ? levels.findIndex((l) => l.id === level) : -1;
  return levels[i + 1] ?? null;
}

export async function loadContributions(): Promise<Contributions> {
  return api<Contributions>('me/contributions', { token: await accessToken() });
}

/** "Show my name on events I add" and the name it shows (PUT /api/me). */
export async function saveCredit(showName: boolean, displayName?: string): Promise<void> {
  await api('me', {
    token: await accessToken(),
    method: 'PUT',
    body: { showName, ...(displayName !== undefined && { displayName }) },
  });
}

/** Loads the signed-in account's contributions; `null` while loading or when it failed. */
export function useContributions(enabled: boolean) {
  const [data, setData] = useState<Contributions | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      setData(await loadContributions());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);
  return { data, failed, reload, setData };
}
