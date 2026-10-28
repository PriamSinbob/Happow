import { deviceId } from './api';

/**
 * "Your impact" counts (M12 §5.1): opens, in-app routes and arrivals per event, sent in batches
 * to /api/counts. Totals only: the server keeps no device or user with them. Each event counts
 * once per kind per page session, so reopening a card doesn't inflate it. Failures are dropped:
 * these are a thank-you to contributors, not data the app depends on.
 */

export type CountKind = 'open' | 'route' | 'arrival';

const FLUSH_MS = 10_000;
const MAX_BATCH = 50;

const seen = new Set<string>();
let queue: { eventId: string; kind: CountKind }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function countEvent(eventId: string, kind: CountKind): void {
  const key = `${kind}:${eventId}`;
  if (seen.has(key)) return;
  seen.add(key);
  queue.push({ eventId, kind });
  if (queue.length >= MAX_BATCH) flushCounts();
  else timer ??= setTimeout(flushCounts, FLUSH_MS);
}

/** Sends what is waiting; `keepalive` lets it finish while the page is being hidden or closed. */
export function flushCounts(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const items = queue.slice(0, MAX_BATCH);
    queue = queue.slice(MAX_BATCH);
    void fetch('/api/counts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId(), items }),
      keepalive: true,
    }).catch(() => {});
  }
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCounts();
  });

/** For tests: forget what was counted and drop anything waiting. */
export function resetCounts(): void {
  seen.clear();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}
