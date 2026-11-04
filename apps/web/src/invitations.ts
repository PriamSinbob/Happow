import { useSyncExternalStore } from 'react';
import type { AcceptedInvitation } from '@happow/core';

/**
 * Accepted invitations (M10 §6, filled by M11). Their events are always in "My plans", private
 * ones also in "Private", and they can't be un-bookmarked: declining removes them. Empty until
 * M11 adds invitations; M11 calls `invitations.set` with what the server returns.
 */

let accepted: readonly AcceptedInvitation[] = [];
const listeners = new Set<() => void>();

export const invitations = {
  accepted: (): readonly AcceptedInvitation[] => accepted,
  has: (id: string): boolean => accepted.some((i) => i.id === id),
  set: (next: readonly AcceptedInvitation[]) => {
    accepted = next;
    for (const l of listeners) l();
  },
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const snapshot = () => accepted;
export function useAcceptedInvitations(): readonly AcceptedInvitation[] {
  return useSyncExternalStore(invitations.subscribe, snapshot, snapshot);
}
