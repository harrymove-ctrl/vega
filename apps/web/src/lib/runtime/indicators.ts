/**
 * Pure TA helpers for the strategy runtime's trigger evaluator.
 *
 * Every function takes plain number arrays (oldest-first) and returns either
 * a scalar for the latest bar or a full series. No I/O, no dates — keep these
 * pure so the evaluator stays deterministic and unit-checkable from a script.
 */

/** Simple moving average of the last `period` values. null if not enough data. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Exponential moving average series (same length as input, leading entries
 * are seeded with an SMA of the first `period` values). Empty if not enough data.
 */
export function emaSeries(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  // Seed with SMA of the first `period` values.
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Latest EMA value, or null if not enough data. */
export function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

/**
 * Wilder's RSI for the latest bar. null if not enough data.
 */
export function rsi(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Volume-weighted average price over the provided bars. null if no volume. */
export function vwap(typicalPrices: number[], volumes: number[]): number | null {
  if (typicalPrices.length === 0 || typicalPrices.length !== volumes.length) return null;
  let pv = 0;
  let v = 0;
  for (let i = 0; i < typicalPrices.length; i++) {
    pv += typicalPrices[i] * volumes[i];
    v += volumes[i];
  }
  return v === 0 ? null : pv / v;
}

/** Highest high over the last `period` bars (excludes the current/last bar). */
export function recentHigh(highs: number[], period: number): number | null {
  if (highs.length < period + 1) return null;
  const window = highs.slice(highs.length - 1 - period, highs.length - 1);
  return Math.max(...window);
}

/** Lowest low over the last `period` bars (excludes the current/last bar). */
export function recentLow(lows: number[], period: number): number | null {
  if (lows.length < period + 1) return null;
  const window = lows.slice(lows.length - 1 - period, lows.length - 1);
  return Math.min(...window);
}

/** True when fast crossed above slow between the previous and latest bar. */
export function crossedAbove(fast: number[], slow: number[]): boolean {
  const n = Math.min(fast.length, slow.length);
  if (n < 2) return false;
  const f0 = fast[fast.length - 2];
  const f1 = fast[fast.length - 1];
  const s0 = slow[slow.length - 2];
  const s1 = slow[slow.length - 1];
  return f0 <= s0 && f1 > s1;
}

/** True when fast crossed below slow between the previous and latest bar. */
export function crossedBelow(fast: number[], slow: number[]): boolean {
  const n = Math.min(fast.length, slow.length);
  if (n < 2) return false;
  const f0 = fast[fast.length - 2];
  const f1 = fast[fast.length - 1];
  const s0 = slow[slow.length - 2];
  const s1 = slow[slow.length - 1];
  return f0 >= s0 && f1 < s1;
}
