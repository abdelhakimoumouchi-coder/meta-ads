/**
 * Pure math helpers.
 *
 * All functions are stateless and deterministic.
 * They never throw on valid numeric input.
 * Exception: `clamp` throws when min > max, as this represents a programming error.
 */

// ─── Clamping / bounding ──────────────────────────────────────────────────────

/**
 * Clamps `value` to the inclusive range [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new Error(`[math] clamp: min (${min}) must be ≤ max (${max})`);
  return Math.max(min, Math.min(max, value));
}

// ─── Rounding ────────────────────────────────────────────────────────────────

/**
 * Rounds `value` to `decimals` decimal places using "round half away from zero".
 * E.g. `round(2.5)` → 3, `round(-2.5)` → -3.
 */
export function round(value: number, decimals = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Rounds `value` down to the nearest `step`.
 * E.g. `floorTo(27.6, 0.5)` → 27.5.
 */
export function floorTo(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Linearly normalises `value` from the range [fromMin, fromMax] to [toMin, toMax].
 * Clamps the output to [toMin, toMax].
 * Returns `toMin` if the source range is zero-width.
 */
export function normalizeLinear(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin = 0,
  toMax = 1
): number {
  if (fromMax === fromMin) return toMin;
  const ratio = (value - fromMin) / (fromMax - fromMin);
  return clamp(toMin + ratio * (toMax - toMin), toMin, toMax);
}

/**
 * Normalises a "lower is better" metric (e.g. cost per conversion).
 * Maps `value` on [0, ceiling] to [0, 1] where lower values → higher scores.
 * Returns 1 for values ≤ 0.
 */
export function normalizeLowerIsBetter(value: number, ceiling: number): number {
  if (value <= 0) return 1;
  if (ceiling <= 0) return 0;
  return clamp(1 - value / ceiling, 0, 1);
}

/**
 * Normalises a "higher is better" metric using a soft sigmoid-like curve:
 * `score = value / (value + target)`.
 * At `value === target`, score = 0.5.
 * Approaches 1 as `value` → ∞; equals 0 at `value === 0`.
 *
 * This prevents extreme outliers from dominating the score.
 */
export function normalizeWithTarget(value: number, target: number): number {
  if (value < 0) return 0;
  if (target <= 0) return 1;
  return clamp(value / (value + target), 0, 1);
}

// ─── Safe division ────────────────────────────────────────────────────────────

/**
 * Divides `numerator` by `denominator`.
 * Returns `fallback` (default 0) if the denominator is 0 or NaN.
 */
export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!denominator || !Number.isFinite(denominator)) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

// ─── Percentage helpers ───────────────────────────────────────────────────────

/**
 * Returns `(value / total) * 100` safely.
 * Returns 0 if `total` is 0.
 */
export function pct(value: number, total: number): number {
  return safeDivide(value, total) * 100;
}

/**
 * Returns the percentage change from `from` to `to`.
 * Returns 0 if `from` is 0.
 */
export function pctChange(from: number, to: number): number {
  return safeDivide(to - from, Math.abs(from)) * 100;
}

// ─── Weighted average ─────────────────────────────────────────────────────────

/**
 * Computes a weighted average of values.
 * `pairs` is an array of [value, weight] tuples.
 * Weights do not need to sum to 1 — they are normalised internally.
 * Returns 0 if the total weight is 0.
 */
export function weightedAverage(pairs: [number, number][]): number {
  const totalWeight = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) return 0;
  return pairs.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight;
}

// ─── Confidence dampening ─────────────────────────────────────────────────────

/**
 * Applies a confidence dampener to a score.
 * When confidence is low, the score is pulled toward `neutral` (default 0.5).
 * At full confidence (1.0), the score is returned unchanged.
 *
 * Formula: `neutral + (score - neutral) * confidence`
 */
export function dampScore(
  score: number,
  confidence: number,
  neutral = 0.5
): number {
  const c = clamp(confidence, 0, 1);
  return neutral + (score - neutral) * c;
}
