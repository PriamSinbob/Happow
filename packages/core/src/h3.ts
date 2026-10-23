// Kept out of the main entry: h3-js is ~500 kB; the client loads it lazily ('@happow/core/h3').
import { cellToLatLng, getHexagonEdgeLengthAvg, latLngToCell } from 'h3-js';
import type { LatLng } from './types.js';

export function h3Cell(point: LatLng, resolution: number): string {
  return latLngToCell(point.lat, point.lng, resolution);
}

export function h3Centre(cell: string): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

/** Average hexagon edge (≈ its radius) at `resolution`, in metres. */
export function h3EdgeM(resolution: number): number {
  return getHexagonEdgeLengthAvg(resolution, 'm');
}
