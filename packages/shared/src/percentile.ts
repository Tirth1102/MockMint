/**
 * Score → percentile estimate.
 *
 * The prototype interpolates linearly between anchor points on a score→percentile
 * curve. ARCHITECTURE.md §7 flags this as an estimate, not a real cohort rank; the
 * production path is a materialised score→rank view per paper, refreshed hourly.
 * Until that view exists this curve is the fallback, and it is kept here so the API
 * and the UI can never disagree about a displayed percentile.
 */

/** [score out of 198, percentile] anchors. */
const CURVE: readonly (readonly [number, number])[] = [
  [0, 8],
  [20, 42],
  [40, 68],
  [60, 83],
  [80, 92],
  [100, 96.5],
  [120, 98.7],
  [150, 99.6],
  [198, 99.99],
];

/**
 * @param score raw marks, already normalised to a 198-mark paper.
 * @returns percentile to two decimals, as a string (display format).
 */
export function estimatePercentile(score: number): string {
  if (!Number.isFinite(score) || score <= 0) return '5.00';

  for (let i = 1; i < CURVE.length; i++) {
    const lower = CURVE[i - 1];
    const upper = CURVE[i];
    if (!lower || !upper) continue;
    const [x1, y1] = upper;
    if (score <= x1) {
      const [x0, y0] = lower;
      const span = x1 - x0;
      if (span === 0) return y1.toFixed(2);
      return (y0 + ((score - x0) / span) * (y1 - y0)).toFixed(2);
    }
  }
  return '99.99';
}

/** Normalises a score onto the standard 198-mark scale before estimating. */
export function estimatePercentileForPaper(score: number, totalMarks: number): string {
  const normalised = totalMarks > 0 ? (score * 198) / totalMarks : 0;
  return estimatePercentile(normalised);
}
