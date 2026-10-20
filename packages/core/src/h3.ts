// Kept out of the main entry: h3-js is ~500 kB and the client only needs it for the offline seed.
import { latLngToCell } from 'h3-js';
import type { LatLng } from './types.js';

export function h3Cell(point: LatLng, resolution: number): string {
  return latLngToCell(point.lat, point.lng, resolution);
}
