import { useEffect, useState } from 'react';
import type { LatLng, NearbyEvent } from '@happow/core';
import type { EventRepository } from '../data';
import { fetchPrivateEvent, type PrivateEvent } from '../private';
import { useEventDetail } from './useEventDetail';

/**
 * The event behind the open screen (its detail, or "Going there"): a public one from the loaded
 * snapshot or the repository, else a private one read with the sign-in — through an invite link,
 * or one the account was invited to since the last read. `version` reads it again (after an edit
 * or an answer on the card), and so does signing in or out.
 */
export function useOpenEvent(
  repo: EventRepository,
  id: string | null,
  known: NearbyEvent[],
  center: LatLng,
  version: number,
  accountStatus: string,
): { ev: NearbyEvent | null; loading: boolean } {
  const pub = useEventDetail(repo, id, known, center, version);
  const [viaLink, setViaLink] = useState<{ id: string; ev: PrivateEvent | null } | null>(null);
  useEffect(() => {
    if (!id || pub.ev || pub.loading) return;
    let live = true;
    fetchPrivateEvent(id, center).then(
      (ev) => live && setViaLink({ id, ev }),
      () => live && setViaLink({ id, ev: null }),
    );
    return () => {
      live = false;
    };
    // Once per id (and after an answer); the centre moving must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pub.ev, pub.loading, version, accountStatus]);

  if (pub.ev) return pub;
  const priv = viaLink && viaLink.id === id ? viaLink.ev : null;
  if (priv) return { ev: priv, loading: false };
  return { ev: null, loading: pub.loading || (!!id && viaLink?.id !== id) };
}
