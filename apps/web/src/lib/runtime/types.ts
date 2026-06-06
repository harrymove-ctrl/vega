import type { SoDEXSymbol, SoDEXTicker, SoDEXCandle, SoDEXOrderbook } from "@/lib/sodex-public";

/**
 * Immutable view of one market at a moment in time, assembled from the public
 * SoDEX read endpoints. The trigger evaluator reads ONLY from this — it never
 * does I/O — so a given snapshot always evaluates the same way.
 */
export interface MarketSnapshot {
  /** Concrete market symbol this snapshot describes (e.g. "vMAG7ssi_vUSDC"). */
  symbol: string;
  /** Symbol metadata (precision, tick/step) for order sizing. */
  meta: SoDEXSymbol;
  /** Latest ticker. */
  ticker: SoDEXTicker;
  /** Latest price (Number(ticker.lastPx)). */
  lastPrice: number;
  /** Top-of-book best bid / best ask, when available. */
  bestBid: number | null;
  bestAsk: number | null;
  /** Candle history keyed by interval string ("5m", "1h", ...), oldest-first. */
  candlesByInterval: Record<string, SoDEXCandle[]>;
  /** Raw orderbook (for imbalance-style conditions). */
  orderbook: SoDEXOrderbook | null;
}

/** Per-route runtime state the evaluator needs for stateful conditions. */
export interface RouteEvalContext {
  /** Seconds since this route last fired, or null if it never has. */
  secondsSinceLastFire: number | null;
  /**
   * Synthesized spot position for the runtime's symbol, when an account is
   * connected. Absent (undefined) when no wallet/account is available — in
   * that case position_* conditions evaluate as "no position".
   */
  position?: import("./account-snapshot").SpotPosition;
}

/** Outcome of evaluating a single condition. */
export interface ConditionResult {
  type: string;
  /** Was this condition type implemented for evaluation at all? */
  supported: boolean;
  /** Did it evaluate true? Only meaningful when supported. */
  fired: boolean;
  /** Human-readable reason (for the execution log). */
  detail: string;
}

/** Outcome of evaluating a whole route (entry → conditions → actions). */
export interface RouteEvalResult {
  /** All conditions passed AND every condition was supported. */
  fired: boolean;
  /** True if any condition type was not implemented (route cannot fire). */
  hasUnsupported: boolean;
  conditions: ConditionResult[];
}

export type RuntimeState =
  | "idle"
  | "running"
  | "paused"
  | "stopped"
  | "error";

export interface ExecutionLogEntry {
  /** Caller-supplied monotonic timestamp (ms). The runtime never calls Date.now itself. */
  at: number;
  level: "info" | "order" | "warn" | "error";
  message: string;
  /** Optional structured payload (orderID, clOrdID, route name, etc.). */
  data?: Record<string, unknown>;
}
