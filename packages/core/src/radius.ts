/**
 * Logarithmic radius scale for the slider: equal slider steps feel equal at 150 m and at 15 km.
 * Values snap to "nice" numbers so the label never reads 1 437 m.
 */
export function sliderToRadius(t: number, minM: number, maxM: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return snapRadius(minM * Math.pow(maxM / minM, clamped), minM, maxM);
}

export function radiusToSlider(radius: number, minM: number, maxM: number): number {
  const r = Math.min(maxM, Math.max(minM, radius));
  return Math.log(r / minM) / Math.log(maxM / minM);
}

export function snapRadius(radius: number, minM: number, maxM: number): number {
  const step = radius < 1000 ? 50 : radius < 5000 ? 250 : 1000;
  return Math.min(maxM, Math.max(minM, Math.round(radius / step) * step));
}
