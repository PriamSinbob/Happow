export function snapRadius(radius: number, minM: number, maxM: number): number {
  const step = radius < 1000 ? 50 : radius < 5000 ? 250 : 1000;
  return Math.min(maxM, Math.max(minM, Math.round(radius / step) * step));
}

/** Smallest snapped radius that still reaches `distance` (for "expand to include the nearest event"). */
export function snapRadiusUp(distance: number, minM: number, maxM: number): number {
  const step = distance < 1000 ? 50 : distance < 5000 ? 250 : 1000;
  return Math.min(maxM, Math.max(minM, Math.ceil(distance / step) * step));
}
