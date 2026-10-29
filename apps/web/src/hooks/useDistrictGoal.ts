import { useEffect, useState } from 'react';
import { weekendWindow, type LatLng } from '@happow/core';
import { region } from '../config';
import type { DistrictGoal, EventRepository } from '../data/repository';

/**
 * The district goal for an empty reach (M12 §6.2): the district `at` is in, and how many events it
 * has this weekend. Only asked while `at` is given (the caller passes it when the reach is empty);
 * never a notification. Moves under ~100 m (3 decimals) don't ask again.
 */
export function useDistrictGoal(
  repo: EventRepository,
  at: LatLng | null,
  now: Date,
): DistrictGoal | null {
  const [goal, setGoal] = useState<DistrictGoal | null>(null);
  const { from, to } = weekendWindow(now, region.timezone);
  const key = at ? `${at.lat.toFixed(3)},${at.lng.toFixed(3)}|${to.toISOString()}` : null;
  useEffect(() => {
    if (!at) {
      setGoal(null);
      return;
    }
    const ctl = new AbortController();
    repo
      .districtGoal(region.id, at, from, to, ctl.signal)
      .then((g) => !ctl.signal.aborted && setGoal(g))
      .catch(() => !ctl.signal.aborted && setGoal(null));
    return () => ctl.abort();
    // `key` stands for at, from and to.
  }, [repo, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return goal;
}
