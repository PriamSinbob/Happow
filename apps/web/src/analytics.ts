import { config } from './config';

type Props = Record<string, string | number | boolean>;
type Plausible = ((event: string, opts?: { u?: string; props?: Props }) => void) & {
  q?: unknown[];
};

declare global {
  interface Window {
    plausible?: Plausible;
  }
}

const { plausibleDomain, scriptUrl } = config.app.analytics;

/**
 * Cookie-free analytics (Plausible), loaded only when `analytics.plausibleDomain` is set. Page
 * views carry the screen name only, never ids, coordinates or the hash (sign-in tokens live
 * there), and no device id is sent.
 */
export function initAnalytics() {
  if (!plausibleDomain || typeof document === 'undefined') return;
  // Calls made before the script loads are queued and replayed by it.
  window.plausible ??= Object.assign(
    (...args: unknown[]) => {
      (window.plausible!.q ??= []).push(args);
    },
    { q: [] as unknown[] },
  ) as Plausible;
  const s = document.createElement('script');
  s.defer = true;
  s.src = scriptUrl;
  s.dataset.domain = plausibleDomain;
  document.head.appendChild(s);
}

export function trackView(screen: string) {
  window.plausible?.('pageview', { u: `${location.origin}/${screen}` });
}

export function track(event: string, props?: Props) {
  window.plausible?.(event, props && { props });
}
