import { distanceM, isInBbox, type HappowConfig } from '@happow/core';
import { z } from 'zod';
import { ApiError, body, json, latLng, type Limit, type Need } from './http.js';

export interface RoutingDeps {
  config: HappowConfig;
  need: Need;
  limit: Limit;
  clientHash: (req: Request, salt: string) => Promise<string>;
  /** The routing provider's key (the secret named by navigation.routing.secret), if set. */
  routingKey: string | undefined;
  fetch: typeof fetch;
}

export function routingRoutes({
  config,
  need,
  limit,
  clientHash,
  routingKey,
  fetch: doFetch,
}: RoutingDeps) {
  const { navigation } = config.app;

  /**
   * POST /api/route {from, to} → a walking route for "Going there". One call per trip (plus a
   * few re-routes); the app draws a direct line when this answers 503 or 429.
   */
  async function route(req: Request): Promise<Response> {
    const { salt } = need();
    if (!routingKey) throw new ApiError(503, 'not_configured');
    const { from, to } = await body(req, z.object({ from: latLng, to: latLng }));
    if (!config.regions.some((r) => isInBbox(to, r.bbox)))
      throw new ApiError(400, 'outside_region');
    if (distanceM(from, to) > navigation.maxRouteKm * 1000)
      throw new ApiError(400, 'invalid_input', 'too far');
    await limit('route', await clientHash(req, salt), 3600, navigation.routesPerHourPerClient);
    const res = await doFetch(navigation.routing.endpoint, {
      method: 'POST',
      headers: {
        authorization: routingKey,
        'content-type': 'application/json',
        accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
    });
    // Quota used up (403 daily, 429 per minute) or provider down: the app draws a direct line.
    if (res.status === 403 || res.status === 429) throw new ApiError(429, 'rate_limited');
    if (!res.ok) throw new ApiError(503, 'not_configured', `routing ${res.status}`);
    const geo = (await res.json()) as {
      features?: {
        geometry?: { coordinates?: [number, number][] };
        properties?: { summary?: { distance?: number; duration?: number } };
      }[];
    };
    const f = geo.features?.[0];
    const coords = f?.geometry?.coordinates;
    if (!coords?.length) throw new ApiError(503, 'not_configured', 'no route');
    return json({
      path: coords.map(([lng, lat]) => ({ lat, lng })),
      distanceM: Math.round(f?.properties?.summary?.distance ?? 0),
      durationS: Math.round(f?.properties?.summary?.duration ?? 0),
      attribution: navigation.routing.attribution,
    });
  }

  return route;
}
