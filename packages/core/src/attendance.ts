/**
 * Public attendance counts (M9 §5, §6): nothing below the threshold, then the highest bucket
 * reached ("10+" for 17), so a count never pins down a small group.
 */
export function attendanceBucket(
  n: number,
  { publicMin, buckets }: { publicMin: number; buckets: readonly number[] },
): number | null {
  if (n < publicMin) return null;
  let shown: number | null = null;
  for (const b of [...buckets].sort((a, z) => a - z)) if (n >= b) shown = b;
  return shown ?? publicMin;
}
