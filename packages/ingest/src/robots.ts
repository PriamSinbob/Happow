import { parseRobots, productToken, type Robots } from '@happow/extract';
import { HttpError, type HttpClient } from './http.js';

/**
 * `allowed(url)`: whether robots.txt lets our crawler fetch it, reading each site's robots.txt
 * once. No robots.txt (4xx) means no restrictions; any other failure stays away from the site.
 */
export function robotsGate(http: HttpClient, userAgent: string): (url: string) => Promise<boolean> {
  const byOrigin = new Map<string, Robots>();
  const token = productToken(userAgent);
  return async (url) => {
    const origin = new URL(url).origin;
    let robots = byOrigin.get(origin);
    if (!robots) {
      let txt = '';
      try {
        txt = await http.text(`${origin}/robots.txt`);
      } catch (err) {
        if (!(err instanceof HttpError && err.status >= 400 && err.status < 500)) throw err;
      }
      robots = parseRobots(txt, token);
      byOrigin.set(origin, robots);
    }
    return robots.isAllowed(url);
  };
}
