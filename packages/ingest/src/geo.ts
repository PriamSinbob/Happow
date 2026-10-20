import { distanceM, type LatLng, type Region } from '@happow/core';
import { gridDisk, latLngToCell } from 'h3-js';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash (Ticketmaster's geoPoint takes one). */
export function geohash(p: LatLng, precision = 9): string {
  let [latMin, latMax, lngMin, lngMax] = [-90, 90, -180, 180];
  let hash = '';
  let bits = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (p.lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (p.lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bits === 5) {
      hash += BASE32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Smallest circle around the region's bbox centre that covers the whole bbox. */
export function coveringCircle(region: Region): { center: LatLng; radiusM: number } {
  const { west, south, east, north } = region.bbox;
  const center = { lat: (south + north) / 2, lng: (west + east) / 2 };
  const radiusM = Math.max(
    ...[
      { lat: south, lng: west },
      { lat: south, lng: east },
      { lat: north, lng: west },
      { lat: north, lng: east },
    ].map((c) => distanceM(center, c)),
  );
  return { center, radiusM };
}

export function h3Cell(p: LatLng, resolution: number): string {
  return latLngToCell(p.lat, p.lng, resolution);
}

export function h3Neighbourhood(cell: string, ring: number): string[] {
  return gridDisk(cell, ring);
}
