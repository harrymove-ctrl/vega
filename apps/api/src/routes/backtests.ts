/**
 * /api/backtests — backtesting lab (bootstrap + run/poll).
 *
 * The browser lab (apps/web/src/components/backtests/backtesting-lab-page.tsx)
 * drives exactly these calls:
 *   GET  /api/backtests/bootstrap?wallet_address=                 -> { strategies, markets, runs, jobs, bots }
 *   POST /api/backtests/runs/jobs                                 -> { id, jobType, status }  (create + run)
 *   POST /api/backtests/runs                                      -> same (contract alias)
 *   GET  /api/backtests/runs/jobs?wallet_address=                 -> BacktestRunJobStatusResponse[]
 *   GET  /api/backtests/runs/jobs/:id                             -> BacktestRunJobStatusResponse  (poll)
 *   GET  /api/backtests/runs?wallet_address=                      -> BacktestRunSummary[]
 *   GET  /api/backtests/runs/:id?wallet_address=                  -> BacktestRunDetail
 *
 * Response shapes are pinned to apps/web/src/lib/backtests.ts (the frontend
 * dereferences result_json.summary, result_json.trades, result_json.equity_curve,
 * run.bot_definition_id, run.assumption_config_json, job.progress, job.result, …).
 *
 * The backtest is REAL but intentionally simple: it fetches SoDEX OHLCV klines
 * from the public gateway (testnet-gw.sodex.dev / mainnet-gw.sodex.dev, same
 * endpoint sodex-public.ts uses), replays a deterministic dual-SMA crossover
 * over the bot's market(s), and computes the equity curve / trades / summary
 * from those actual candles. There are NO fabricated metrics — if klines can't
 * be fetched the run is marked `failed` with a clear failure_reason, and every
 * result carries an `assumptions[]` note describing the model so nothing
 * synthetic is ever presented as live execution.
 *
 * Compute runs inline (Workers has no built-in job queue without a Durable
 * Object / Queue binding), so by the time the create call returns the row is
 * already terminal (`completed` | `failed`). The frontend's poll loop handles
 * that on the first GET — it reads job.status and job.result identically.
 *
 * Writes are gated on requireAuth and use the verified caller (c.var.address);
 * owner-scoped reads take wallet_address as a query param. Non-2xx bodies are
 * `{ detail }` (the frontend's error convention).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { and, desc, eq } from "drizzle-orm";

import type { AppEnv } from "../app";
import { getDb } from "../db/client";
import { backtestRuns, bots, users } from "../db/schema";
import { normalizeAddress, requireAuth } from "../auth";

const r = new Hono<AppEnv>();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// SoDEX public spot gateway (mirrors sodex-public.ts BASE_URL resolution).
const SODEX_TESTNET = "https://testnet-gw.sodex.dev/api/v1/spot";
const SODEX_MAINNET = "https://mainnet-gw.sodex.dev/api/v1/spot";

// Per-request kline cap on the gateway (sodex-public.ts: max 1500).
const KLINE_PAGE_LIMIT = 1000;
// Hard ceiling on total candles replayed in one run so a Worker request stays
// within CPU/time budget (a multi-year 1m range would be enormous otherwise).
const MAX_TOTAL_CANDLES = 6000;
// Dual-SMA crossover windows (deterministic; documented in `assumptions`).
const FAST_SMA = 10;
const SLOW_SMA = 30;

// Interval → milliseconds (matches TIMEFRAME_TO_MS in the lab page). SoDEX
// expects `1D` for daily; everything else lines up.
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/** Map our interval id to the SoDEX gateway's interval string. */
function sodexInterval(interval: string): string {
  return interval === "1d" ? "1D" : interval;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sodexBaseUrl(): string {
  // Default to testnet (same default as the web client when env is unset).
  return SODEX_TESTNET;
}

// ---------------------------------------------------------------------------
// Response shapes — pinned to apps/web/src/lib/backtests.ts
// ---------------------------------------------------------------------------

type AssumptionConfig = {
  fee_bps: number;
  slippage_bps: number;
  funding_bps_per_interval: number;
};

type PriceCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BtTrade = {
  trade_id: string;
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  entry_time: string;
  exit_time: string | null;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  notional_usd: number;
  leverage: number;
  gross_pnl_usd: number;
  fees_paid_usd: number;
  funding_pnl_usd: number;
  pnl_usd: number | null;
  pnl_pct: number | null;
  duration_seconds: number | null;
  close_reason: string | null;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
};

type TriggerEvent = {
  timestamp: number;
  symbol: string;
  kind: string;
  title: string;
  detail: string;
};

type ResultSummary = {
  primary_symbol: string | null;
  symbols: string[];
  requested_symbols?: string[];
  skipped_symbols?: string[];
  interval: string;
  initial_capital_usd: number;
  ending_equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  gross_pnl_total: number;
  pnl_total: number;
  pnl_total_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  trade_count: number;
  winning_trades: number;
  losing_trades: number;
  avg_trade_duration_seconds: number;
  fees_paid_usd: number;
  funding_pnl_usd: number;
};

type BacktestResultJson = {
  equity_curve: Array<{
    time: number;
    equity: number;
    realized_pnl: number;
    unrealized_pnl: number;
  }>;
  price_series: {
    primary_symbol: string | null;
    series_by_symbol: Record<string, PriceCandle[]>;
  };
  trades: BtTrade[];
  trigger_events: TriggerEvent[];
  summary: ResultSummary;
  assumption_config?: AssumptionConfig;
  assumptions: string[];
  preflight_issues?: string[];
  execution_issues?: string[];
  requested_range?: { start_time: number; end_time: number };
};

type BacktestRunRow = typeof backtestRuns.$inferSelect;

type BacktestRunSummary = {
  id: string;
  bot_definition_id: string;
  bot_name_snapshot: string;
  market_scope_snapshot?: string | null;
  strategy_type_snapshot?: string | null;
  interval: string;
  start_time: number;
  end_time: number;
  initial_capital_usd: number;
  execution_model: string;
  pnl_total: number;
  pnl_total_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  trade_count: number;
  status: string;
  assumption_config_json?: AssumptionConfig;
  failure_reason?: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
};

type BacktestRunDetail = BacktestRunSummary & {
  user_id: string;
  wallet_address: string;
  rules_snapshot_json: Record<string, unknown>;
  result_json: BacktestResultJson;
};

type JobStatusResponse = {
  id: string;
  jobType: "backtest_run";
  status: "queued" | "running" | "completed" | "failed";
  progress?: {
    type?: "progress";
    progress: number;
    stage: string;
    detail: string;
    interval: string;
    metrics?: Record<string, number | string>;
  };
  result?: BacktestRunDetail | null;
  errorDetail?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Infer a sensible replay interval from a bot's rules/strategy. The visual
 * builder doesn't pin a canonical timeframe, so we key off the strategy type
 * and any timeframe hints in rules_json; default 15m (the lab's own default).
 */
function inferInterval(strategyType: string, rulesJson: unknown): string {
  const rules =
    rulesJson && typeof rulesJson === "object" && !Array.isArray(rulesJson)
      ? (rulesJson as Record<string, unknown>)
      : {};
  const explicit =
    typeof rules.backtest_interval === "string"
      ? rules.backtest_interval
      : typeof rules.interval === "string"
        ? rules.interval
        : typeof rules.timeframe === "string"
          ? rules.timeframe
          : "";
  if (explicit && explicit in INTERVAL_MS) return explicit;

  const t = strategyType.toLowerCase();
  if (t.includes("scalp") || t.includes("momentum") || t.includes("breakout")) return "5m";
  if (t.includes("swing") || t.includes("trend")) return "1h";
  if (t.includes("twap") || t.includes("maker")) return "15m";
  return "15m";
}

/**
 * Pull the symbol(s) a bot trades out of its market_scope + rules. market_scope
 * looks like 'perps:BTC-USD', 'spot:ETH-USD', 'multi', or ''. We normalise to
 * the SoDEX symbol convention (BTC-USDC) used by the public gateway.
 */
function inferSymbols(marketScope: string, rulesJson: unknown): string[] {
  const out = new Set<string>();

  const fromScope = marketScope.replace(/^(perps|spot|futures):/i, "").trim();
  if (fromScope && fromScope.toLowerCase() !== "multi" && fromScope !== "*") {
    for (const part of fromScope.split(/[,\s|]+/).filter(Boolean)) {
      out.add(normalizeSymbol(part));
    }
  }

  const rules =
    rulesJson && typeof rulesJson === "object" && !Array.isArray(rulesJson)
      ? (rulesJson as Record<string, unknown>)
      : {};
  const blocks: unknown[] = [];
  for (const key of ["conditions", "actions"]) {
    const v = rules[key];
    if (Array.isArray(v)) blocks.push(...v);
  }
  if (Array.isArray(rules.routes)) {
    for (const route of rules.routes) {
      if (route && typeof route === "object") {
        const ro = route as Record<string, unknown>;
        for (const key of ["conditions", "actions"]) {
          const v = ro[key];
          if (Array.isArray(v)) blocks.push(...v);
        }
      }
    }
  }
  for (const block of blocks) {
    if (block && typeof block === "object") {
      const sym = (block as Record<string, unknown>).symbol;
      if (typeof sym === "string" && sym.trim()) out.add(normalizeSymbol(sym));
    }
  }

  if (out.size === 0) out.add("BTC-USDC"); // sane default market for an empty scope
  return Array.from(out);
}

/** Normalise an arbitrary market token to the SoDEX `BASE-USDC` convention. */
function normalizeSymbol(raw: string): string {
  let s = raw.trim().toUpperCase();
  // strip a perps/spot prefix if it slipped through
  s = s.replace(/^(PERPS|SPOT|FUTURES):/, "");
  // BTCUSDC / BTC_USDC / BTC/USDC / BTC-USD -> BTC-USDC
  s = s.replace(/[_/]/g, "-");
  if (s.endsWith("-USD")) s = `${s}C`; // USD -> USDC
  if (!s.includes("-")) {
    if (s.endsWith("USDC")) s = `${s.slice(0, -4)}-USDC`;
    else if (s.endsWith("USDT")) s = `${s.slice(0, -4)}-USDT`;
    else s = `${s}-USDC`;
  }
  return s;
}

type SoDEXCandleRaw = { t: number; o: string; h: string; l: string; c: string; v: string; q: string };

/**
 * Fetch OHLCV candles for one symbol over [start, end] from the SoDEX gateway,
 * paging by KLINE_PAGE_LIMIT until the window is covered or the cap is hit.
 * Returns ascending-by-time PriceCandle[]; empty array means the symbol had no
 * data (caller treats that as a skipped symbol).
 */
async function fetchCandles(
  baseUrl: string,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<PriceCandle[]> {
  const stepMs = INTERVAL_MS[interval] ?? INTERVAL_MS["15m"];
  const gwInterval = sodexInterval(interval);
  const seen = new Map<number, PriceCandle>();
  let cursor = startTime;
  let guard = 0;
  const maxPages = Math.ceil(MAX_TOTAL_CANDLES / KLINE_PAGE_LIMIT) + 2;

  while (cursor <= endTime && guard < maxPages && seen.size < MAX_TOTAL_CANDLES) {
    guard += 1;
    const url = new URL(`${baseUrl}/markets/${symbol}/klines`);
    url.searchParams.set("interval", gwInterval);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));
    url.searchParams.set("limit", String(KLINE_PAGE_LIMIT));

    let payload: { code?: number; data?: SoDEXCandleRaw[] };
    try {
      const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
      if (!res.ok) break;
      payload = (await res.json()) as { code?: number; data?: SoDEXCandleRaw[] };
    } catch {
      break;
    }

    const rows = Array.isArray(payload.data) ? payload.data : [];
    if (rows.length === 0) break;

    let maxT = cursor;
    for (const row of rows) {
      const t = asFiniteNumber(row.t, NaN);
      if (!Number.isFinite(t)) continue;
      if (t > maxT) maxT = t;
      if (t < startTime || t > endTime) continue;
      seen.set(t, {
        time: t,
        open: asFiniteNumber(row.o, 0),
        high: asFiniteNumber(row.h, 0),
        low: asFiniteNumber(row.l, 0),
        close: asFiniteNumber(row.c, 0),
        volume: asFiniteNumber(row.v, 0),
      });
    }

    if (rows.length < KLINE_PAGE_LIMIT) break; // last page
    const next = maxT + stepMs;
    if (next <= cursor) break; // no forward progress — avoid an infinite loop
    cursor = next;
  }

  return Array.from(seen.values())
    .sort((a, b) => a.time - b.time)
    .slice(0, MAX_TOTAL_CANDLES);
}

/** Simple moving average of the last `window` closes ending at index `i`. */
function sma(candles: PriceCandle[], i: number, window: number): number | null {
  if (i + 1 < window) return null;
  let sum = 0;
  for (let k = i - window + 1; k <= i; k++) sum += candles[k].close;
  return sum / window;
}

type EnginePosition = {
  symbol: string;
  side: "long";
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  notionalUsd: number;
};

/**
 * Deterministic dual-SMA crossover replay over real candles.
 *
 * - Long-only, single position per symbol, full available equity allocation.
 * - Enter long when FAST_SMA crosses above SLOW_SMA; exit when it crosses below.
 * - Entry/exit prices pay slippage; both sides pay fee_bps; each held bar pays
 *   funding_bps_per_interval on the open notional.
 * Every number returned is derived from the fetched candles + the caller's
 * fee/slippage/funding assumptions — none are fabricated.
 */
function replay(
  seriesBySymbol: Record<string, PriceCandle[]>,
  symbols: string[],
  interval: string,
  initialCapitalUsd: number,
  assumptions: AssumptionConfig,
): {
  equityCurve: BacktestResultJson["equity_curve"];
  trades: BtTrade[];
  triggerEvents: TriggerEvent[];
  summary: ResultSummary;
} {
  const feeRate = assumptions.fee_bps / 10_000;
  const slipRate = assumptions.slippage_bps / 10_000;
  const fundingRate = assumptions.funding_bps_per_interval / 10_000;
  const stepSeconds = (INTERVAL_MS[interval] ?? INTERVAL_MS["15m"]) / 1000;

  // Per-symbol capital sleeve so a multi-symbol scope splits equity evenly.
  const sleeveCount = Math.max(1, symbols.length);
  const startingSleeve = initialCapitalUsd / sleeveCount;

  const trades: BtTrade[] = [];
  const triggerEvents: TriggerEvent[] = [];
  let realizedPnl = 0;
  let feesPaid = 0;
  let fundingPnl = 0;

  // Build a unified time axis from the densest symbol for the equity curve.
  const primary = symbols[0] ?? null;

  // Track realized cash sleeve + open position per symbol.
  type SymbolState = { cash: number; position: EnginePosition | null };
  const state: Record<string, SymbolState> = {};
  for (const s of symbols) state[s] = { cash: startingSleeve, position: null };

  // Determine the canonical bar count = the symbol with the most candles.
  let axisSymbol = primary;
  let axisLen = 0;
  for (const s of symbols) {
    const len = seriesBySymbol[s]?.length ?? 0;
    if (len > axisLen) {
      axisLen = len;
      axisSymbol = s;
    }
  }
  const axis = (axisSymbol && seriesBySymbol[axisSymbol]) || [];

  const equityCurve: BacktestResultJson["equity_curve"] = [];

  for (let i = 0; i < axis.length; i++) {
    const barTime = axis[i].time;
    let unrealizedAtBar = 0;

    for (const symbol of symbols) {
      const candles = seriesBySymbol[symbol];
      if (!candles || i >= candles.length) continue;
      const candle = candles[i];
      const st = state[symbol];

      // Funding accrual on an open position for this bar.
      if (st.position && fundingRate !== 0) {
        const f = -st.position.notionalUsd * fundingRate;
        fundingPnl += f;
        realizedPnl += f;
        st.cash += f;
      }

      const fast = sma(candles, i, FAST_SMA);
      const slow = sma(candles, i, SLOW_SMA);
      const fastPrev = sma(candles, i - 1, FAST_SMA);
      const slowPrev = sma(candles, i - 1, SLOW_SMA);

      const crossUp =
        fast !== null && slow !== null && fastPrev !== null && slowPrev !== null && fastPrev <= slowPrev && fast > slow;
      const crossDown =
        fast !== null && slow !== null && fastPrev !== null && slowPrev !== null && fastPrev >= slowPrev && fast < slow;

      // ENTRY
      if (!st.position && crossUp && candle.close > 0) {
        const entryPrice = candle.close * (1 + slipRate);
        const notional = st.cash;
        if (notional > 0 && entryPrice > 0) {
          const quantity = notional / entryPrice;
          const fee = notional * feeRate;
          feesPaid += fee;
          realizedPnl -= fee;
          st.cash -= fee;
          st.position = {
            symbol,
            side: "long",
            entryIndex: i,
            entryTime: barTime,
            entryPrice,
            quantity,
            notionalUsd: notional,
          };
          triggerEvents.push({
            timestamp: barTime,
            symbol,
            kind: "entry_long",
            title: "Long entry",
            detail: `Fast SMA(${FAST_SMA}) crossed above slow SMA(${SLOW_SMA}); opened long at ${entryPrice.toFixed(4)}.`,
          });
        }
      }
      // EXIT
      else if (st.position && crossDown) {
        const pos = st.position;
        const exitPrice = candle.close * (1 - slipRate);
        const grossPnl = (exitPrice - pos.entryPrice) * pos.quantity;
        const exitNotional = exitPrice * pos.quantity;
        const fee = exitNotional * feeRate;
        feesPaid += fee;
        const netPnl = grossPnl - fee;
        realizedPnl += grossPnl - fee;
        st.cash += grossPnl; // sleeve already debited entry fee; here add price PnL
        st.cash -= fee;
        const durationSeconds = (i - pos.entryIndex) * stepSeconds;
        // Entry fee attributed to this trade = notional * feeRate (paid at entry).
        const entryFee = pos.notionalUsd * feeRate;
        trades.push({
          trade_id: crypto.randomUUID(),
          symbol,
          side: "long",
          status: "closed",
          entry_time: new Date(pos.entryTime).toISOString(),
          exit_time: new Date(barTime).toISOString(),
          entry_price: round(pos.entryPrice),
          exit_price: round(exitPrice),
          quantity: round(pos.quantity, 8),
          notional_usd: round(pos.notionalUsd),
          leverage: 1,
          gross_pnl_usd: round(grossPnl),
          fees_paid_usd: round(entryFee + fee),
          funding_pnl_usd: 0,
          pnl_usd: round(netPnl - entryFee),
          pnl_pct: pos.notionalUsd > 0 ? round(((netPnl - entryFee) / pos.notionalUsd) * 100, 4) : 0,
          duration_seconds: durationSeconds,
          close_reason: "sma_cross_down",
        });
        triggerEvents.push({
          timestamp: barTime,
          symbol,
          kind: "exit_long",
          title: "Long exit",
          detail: `Fast SMA(${FAST_SMA}) crossed below slow SMA(${SLOW_SMA}); closed long at ${exitPrice.toFixed(4)}.`,
        });
        st.position = null;
      }

      // Mark-to-market any still-open position at this bar.
      if (st.position) {
        unrealizedAtBar += (candle.close - st.position.entryPrice) * st.position.quantity;
      }
    }

    const equity = initialCapitalUsd + realizedPnl + unrealizedAtBar;
    equityCurve.push({
      time: barTime,
      equity: round(equity),
      realized_pnl: round(realizedPnl),
      unrealized_pnl: round(unrealizedAtBar),
    });
  }

  // Close any positions still open at the final bar (mark as open trades so the
  // UI can show them, but fold their unrealized PnL into the summary).
  let unrealizedFinal = 0;
  for (const symbol of symbols) {
    const st = state[symbol];
    const candles = seriesBySymbol[symbol];
    if (st.position && candles && candles.length > 0) {
      const pos = st.position;
      const last = candles[candles.length - 1];
      const markPnl = (last.close - pos.entryPrice) * pos.quantity;
      unrealizedFinal += markPnl;
      const entryFee = pos.notionalUsd * feeRate;
      trades.push({
        trade_id: crypto.randomUUID(),
        symbol,
        side: "long",
        status: "open",
        entry_time: new Date(pos.entryTime).toISOString(),
        exit_time: null,
        entry_price: round(pos.entryPrice),
        exit_price: null,
        quantity: round(pos.quantity, 8),
        notional_usd: round(pos.notionalUsd),
        leverage: 1,
        gross_pnl_usd: round(markPnl),
        fees_paid_usd: round(entryFee),
        funding_pnl_usd: 0,
        pnl_usd: null,
        pnl_pct: null,
        duration_seconds: null,
        close_reason: null,
        unrealized_pnl: round(markPnl),
        unrealized_pnl_pct: pos.notionalUsd > 0 ? round((markPnl / pos.notionalUsd) * 100, 4) : 0,
      });
    }
  }

  const closedTrades = trades.filter((t) => t.status === "closed");
  const winning = closedTrades.filter((t) => (t.pnl_usd ?? 0) > 0).length;
  const losing = closedTrades.filter((t) => (t.pnl_usd ?? 0) < 0).length;
  const durations = closedTrades
    .map((t) => t.duration_seconds ?? 0)
    .filter((d) => d > 0);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  // Max drawdown over the equity curve.
  let peak = initialCapitalUsd;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const dd = ((peak - point.equity) / peak) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  const grossPnlTotal = closedTrades.reduce((a, t) => a + t.gross_pnl_usd, 0) + unrealizedFinal;
  const pnlTotal = realizedPnl + unrealizedFinal;
  const endingEquity = initialCapitalUsd + pnlTotal;

  const summary: ResultSummary = {
    primary_symbol: primary,
    symbols,
    interval,
    initial_capital_usd: round(initialCapitalUsd),
    ending_equity: round(endingEquity),
    realized_pnl: round(realizedPnl),
    unrealized_pnl: round(unrealizedFinal),
    gross_pnl_total: round(grossPnlTotal),
    pnl_total: round(pnlTotal),
    pnl_total_pct: initialCapitalUsd > 0 ? round((pnlTotal / initialCapitalUsd) * 100, 4) : 0,
    max_drawdown_pct: round(maxDrawdownPct, 4),
    win_rate: closedTrades.length > 0 ? round((winning / closedTrades.length) * 100, 2) : 0,
    trade_count: closedTrades.length,
    winning_trades: winning,
    losing_trades: losing,
    avg_trade_duration_seconds: Math.round(avgDuration),
    fees_paid_usd: round(feesPaid),
    funding_pnl_usd: round(fundingPnl),
  };

  // Keep trades chronological for the inspector.
  trades.sort((a, b) => Date.parse(a.entry_time) - Date.parse(b.entry_time));
  triggerEvents.sort((a, b) => a.timestamp - b.timestamp);

  return { equityCurve, trades, triggerEvents, summary };
}

function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// Row -> response mappers
// ---------------------------------------------------------------------------

function parseAssumptionConfig(params: unknown): AssumptionConfig {
  const p =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  const a =
    p.assumptions && typeof p.assumptions === "object" && !Array.isArray(p.assumptions)
      ? (p.assumptions as Record<string, unknown>)
      : {};
  return {
    fee_bps: asFiniteNumber(a.fee_bps, 0),
    slippage_bps: asFiniteNumber(a.slippage_bps, 0),
    funding_bps_per_interval: asFiniteNumber(a.funding_bps_per_interval, 0),
  };
}

function toRunSummary(row: BacktestRunRow): BacktestRunSummary {
  const result = (row.result as BacktestResultJson | null) ?? null;
  const summary = result?.summary ?? null;
  return {
    id: row.id,
    bot_definition_id: row.botId ?? "",
    bot_name_snapshot: row.botNameSnapshot,
    market_scope_snapshot: row.marketScopeSnapshot ?? null,
    strategy_type_snapshot: row.strategyTypeSnapshot ?? null,
    interval: row.interval,
    start_time: row.startTime ?? 0,
    end_time: row.endTime ?? 0,
    initial_capital_usd: row.initialCapitalUsd,
    execution_model: row.executionModel,
    pnl_total: summary?.pnl_total ?? 0,
    pnl_total_pct: summary?.pnl_total_pct ?? 0,
    max_drawdown_pct: summary?.max_drawdown_pct ?? 0,
    win_rate: summary?.win_rate ?? 0,
    trade_count: summary?.trade_count ?? 0,
    status: row.status,
    assumption_config_json: parseAssumptionConfig(row.params),
    failure_reason: row.failureReason ?? null,
    created_at: row.createdAt,
    completed_at: row.completedAt ?? null,
    updated_at: row.updatedAt,
  };
}

/** Empty-but-valid result so the detail view never crashes on a failed run. */
function emptyResult(
  interval: string,
  initialCapitalUsd: number,
  assumptions: AssumptionConfig,
  assumptionNotes: string[],
  failureReason: string | null,
): BacktestResultJson {
  return {
    equity_curve: [],
    price_series: { primary_symbol: null, series_by_symbol: {} },
    trades: [],
    trigger_events: [],
    summary: {
      primary_symbol: null,
      symbols: [],
      interval,
      initial_capital_usd: round(initialCapitalUsd),
      ending_equity: round(initialCapitalUsd),
      realized_pnl: 0,
      unrealized_pnl: 0,
      gross_pnl_total: 0,
      pnl_total: 0,
      pnl_total_pct: 0,
      max_drawdown_pct: 0,
      win_rate: 0,
      trade_count: 0,
      winning_trades: 0,
      losing_trades: 0,
      avg_trade_duration_seconds: 0,
      fees_paid_usd: 0,
      funding_pnl_usd: 0,
    },
    assumption_config: assumptions,
    assumptions: assumptionNotes,
    execution_issues: failureReason ? [failureReason] : [],
  };
}

function toRunDetail(row: BacktestRunRow): BacktestRunDetail {
  const result =
    (row.result as BacktestResultJson | null) ??
    emptyResult(
      row.interval,
      row.initialCapitalUsd,
      parseAssumptionConfig(row.params),
      [],
      row.failureReason ?? null,
    );
  return {
    ...toRunSummary(row),
    user_id: row.ownerAddress,
    wallet_address: row.ownerAddress,
    rules_snapshot_json: (row.rulesSnapshotJson as Record<string, unknown> | null) ?? {},
    result_json: result,
  };
}

function toJobStatus(row: BacktestRunRow): JobStatusResponse {
  const status =
    row.status === "completed" || row.status === "failed" || row.status === "running"
      ? row.status
      : "queued";
  return {
    id: row.id,
    jobType: "backtest_run",
    status: status as JobStatusResponse["status"],
    progress: {
      type: "progress",
      progress: status === "completed" ? 100 : status === "failed" ? 100 : round(row.progress, 2),
      stage:
        status === "completed"
          ? "Replay complete"
          : status === "failed"
            ? "Run failed"
            : "Replaying candles",
      detail:
        status === "completed"
          ? "The result set is ready."
          : status === "failed"
            ? row.failureReason ?? "The backtest could not complete."
            : "Replaying SoDEX candles against the strategy rules.",
      interval: row.interval,
    },
    result: status === "completed" || status === "failed" ? toRunDetail(row) : null,
    errorDetail: status === "failed" ? row.failureReason ?? "Backtest failed." : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? null,
  };
}

async function ensureUser(db: ReturnType<typeof getDb>, address: `0x${string}`) {
  await db
    .insert(users)
    .values({ walletAddress: address })
    .onConflictDoNothing({ target: users.walletAddress });
}

// ---------------------------------------------------------------------------
// GET /bootstrap?wallet_address= — { strategies, markets, runs, jobs, bots }
// ---------------------------------------------------------------------------
r.get("/bootstrap", async (c) => {
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(walletAddress);

  const db = getDb(c.env);

  const botRows = await db
    .select()
    .from(bots)
    .where(eq(bots.ownerAddress, owner))
    .orderBy(desc(bots.updatedAt));

  const runRows = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.ownerAddress, owner))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(DEFAULT_LIMIT);

  const botsPayload = botRows.map((bot) => ({
    id: bot.id,
    name: bot.name,
    description: bot.description,
    strategy_type: bot.strategyType,
    market_scope: bot.marketScope,
    inferred_backtest_interval: inferInterval(bot.strategyType, bot.rulesJson),
    updated_at: bot.updatedAt,
  }));

  const runs = runRows.map(toRunSummary);
  const jobs = runRows.map(toJobStatus);

  return c.json({
    strategies: [],
    markets: [],
    runs,
    jobs,
    bots: botsPayload,
  });
});

// ---------------------------------------------------------------------------
// GET /runs?wallet_address=&limit= — BacktestRunSummary[]
// ---------------------------------------------------------------------------
r.get("/runs", async (c) => {
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(walletAddress);

  const limitRaw = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;

  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.ownerAddress, owner))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(limit);

  return c.json(rows.map(toRunSummary));
});

// ---------------------------------------------------------------------------
// GET /runs/jobs?wallet_address= — BacktestRunJobStatusResponse[]
// (must be registered before /runs/:id so "jobs" isn't captured as an id)
// ---------------------------------------------------------------------------
r.get("/runs/jobs", async (c) => {
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(walletAddress);

  const limitRaw = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;

  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.ownerAddress, owner))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(limit);

  return c.json(rows.map(toJobStatus));
});

// ---------------------------------------------------------------------------
// GET /runs/jobs/:id — poll a single job (BacktestRunJobStatusResponse)
// ---------------------------------------------------------------------------
r.get("/runs/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const row = await db.query.backtestRuns.findFirst({ where: eq(backtestRuns.id, id) });
  if (!row) return c.json({ detail: "Backtest job not found" }, 404);

  // Owner-scope the read when wallet_address is supplied (the lab sends auth
  // headers but not always a wallet on the poll path — scope when we can).
  const walletAddress = c.req.query("wallet_address");
  if (walletAddress && normalizeAddress(walletAddress) !== normalizeAddress(row.ownerAddress)) {
    return c.json({ detail: "Backtest job not found" }, 404);
  }

  return c.json(toJobStatus(row));
});

// ---------------------------------------------------------------------------
// GET /runs/:id?wallet_address= — full BacktestRunDetail
// ---------------------------------------------------------------------------
r.get("/runs/:id", async (c) => {
  const id = c.req.param("id");
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(walletAddress);

  const db = getDb(c.env);
  const row = await db.query.backtestRuns.findFirst({
    where: and(eq(backtestRuns.id, id), eq(backtestRuns.ownerAddress, owner)),
  });
  if (!row) return c.json({ detail: "Backtest run not found" }, 404);

  return c.json(toRunDetail(row));
});

// ---------------------------------------------------------------------------
// Create + run a backtest. Shared by POST /runs and POST /runs/jobs.
// ---------------------------------------------------------------------------
async function createAndRunBacktest(c: Context<AppEnv>) {
  const owner = c.var.address; // verified caller (requireAuth)

  let body: {
    bot_id?: unknown;
    interval?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    initial_capital_usd?: unknown;
    assumptions?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const botId = typeof body.bot_id === "string" ? body.bot_id : "";
  if (!botId) return c.json({ detail: "bot_id is required" }, 400);

  const startTime = asFiniteNumber(body.start_time, NaN);
  const endTime = asFiniteNumber(body.end_time, NaN);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return c.json({ detail: "A valid start_time < end_time range is required" }, 400);
  }

  const initialCapitalUsd = Math.max(0, asFiniteNumber(body.initial_capital_usd, 0));
  if (initialCapitalUsd <= 0) {
    return c.json({ detail: "initial_capital_usd must be greater than zero" }, 400);
  }

  const assumptionsRaw =
    body.assumptions && typeof body.assumptions === "object" && !Array.isArray(body.assumptions)
      ? (body.assumptions as Record<string, unknown>)
      : {};
  const assumptions: AssumptionConfig = {
    fee_bps: Math.max(0, asFiniteNumber(assumptionsRaw.fee_bps, 0)),
    slippage_bps: Math.max(0, asFiniteNumber(assumptionsRaw.slippage_bps, 0)),
    funding_bps_per_interval: asFiniteNumber(assumptionsRaw.funding_bps_per_interval, 0),
  };

  const db = getDb(c.env);

  const bot = await db.query.bots.findFirst({ where: eq(bots.id, botId) });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);
  if (normalizeAddress(bot.ownerAddress) !== owner) {
    return c.json({ detail: "Not authorized for this bot" }, 403);
  }

  await ensureUser(db, owner);

  const interval =
    typeof body.interval === "string" && body.interval in INTERVAL_MS
      ? (body.interval as string)
      : inferInterval(bot.strategyType, bot.rulesJson);
  const requestedSymbols = inferSymbols(bot.marketScope, bot.rulesJson);

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const paramsPayload = {
    wallet_address: owner,
    bot_id: botId,
    interval,
    start_time: startTime,
    end_time: endTime,
    initial_capital_usd: initialCapitalUsd,
    assumptions,
  };

  // Insert the queued row first so a poll mid-compute still finds it.
  await db.insert(backtestRuns).values({
    id,
    ownerAddress: owner,
    botId,
    botNameSnapshot: bot.name,
    marketScopeSnapshot: bot.marketScope,
    strategyTypeSnapshot: bot.strategyType,
    interval,
    startTime: Math.trunc(startTime),
    endTime: Math.trunc(endTime),
    initialCapitalUsd,
    executionModel: "dual-sma-crossover",
    params: paramsPayload,
    rulesSnapshotJson: bot.rulesJson ?? {},
    status: "running",
    progress: 5,
    createdAt,
    updatedAt: createdAt,
  });

  // --- run the backtest inline over real SoDEX candles ---------------------
  const baseUrl = sodexBaseUrl();
  const assumptionNotes = [
    `Deterministic dual-SMA crossover (fast ${FAST_SMA}, slow ${SLOW_SMA}), long-only, one position per market, full-sleeve allocation.`,
    `Fees ${assumptions.fee_bps} bps and slippage ${assumptions.slippage_bps} bps applied on every fill; funding ${assumptions.funding_bps_per_interval} bps charged per held ${interval} bar.`,
    `Replayed over historical SoDEX OHLCV klines (${sodexInterval(interval)} interval) — this is a rules replay over past candles, not live execution.`,
  ];

  const seriesBySymbol: Record<string, PriceCandle[]> = {};
  const usedSymbols: string[] = [];
  const skippedSymbols: string[] = [];
  const preflightIssues: string[] = [];

  try {
    for (const symbol of requestedSymbols) {
      const candles = await fetchCandles(baseUrl, symbol, interval, startTime, endTime);
      if (candles.length >= SLOW_SMA + 2) {
        seriesBySymbol[symbol] = candles;
        usedSymbols.push(symbol);
      } else {
        skippedSymbols.push(symbol);
      }
    }
  } catch {
    // fall through — handled by the empty-usedSymbols branch below
  }

  const completedAt = nowIso();

  if (usedSymbols.length === 0) {
    const failureReason =
      `No replayable SoDEX candle data for ${requestedSymbols.join(", ") || "the bot's market"} ` +
      `over the selected window (need at least ${SLOW_SMA + 2} ${sodexInterval(interval)} bars). ` +
      `Try a wider range, a different market, or a coarser interval.`;
    const emptyRes = emptyResult(interval, initialCapitalUsd, assumptions, assumptionNotes, failureReason);
    emptyRes.summary.requested_symbols = requestedSymbols;
    emptyRes.summary.skipped_symbols = skippedSymbols;
    emptyRes.requested_range = { start_time: Math.trunc(startTime), end_time: Math.trunc(endTime) };

    const [failed] = await db
      .update(backtestRuns)
      .set({
        status: "failed",
        progress: 100,
        result: emptyRes,
        failureReason,
        updatedAt: completedAt,
        completedAt,
      })
      .where(eq(backtestRuns.id, id))
      .returning();

    // Echo the create response the frontend expects: { id, jobType, status }.
    return c.json({ id: failed.id, jobType: "backtest_run", status: "failed" }, 200);
  }

  const { equityCurve, trades, triggerEvents, summary } = replay(
    seriesBySymbol,
    usedSymbols,
    interval,
    initialCapitalUsd,
    assumptions,
  );

  summary.requested_symbols = requestedSymbols;
  if (skippedSymbols.length > 0) summary.skipped_symbols = skippedSymbols;

  if (skippedSymbols.length > 0) {
    preflightIssues.push(
      `Skipped ${skippedSymbols.join(", ")} — not enough SoDEX candle history in this window to replay.`,
    );
  }

  const result: BacktestResultJson = {
    equity_curve: equityCurve,
    price_series: { primary_symbol: usedSymbols[0] ?? null, series_by_symbol: seriesBySymbol },
    trades,
    trigger_events: triggerEvents,
    summary,
    assumption_config: assumptions,
    assumptions: assumptionNotes,
    preflight_issues: preflightIssues.length > 0 ? preflightIssues : undefined,
    requested_range: { start_time: Math.trunc(startTime), end_time: Math.trunc(endTime) },
  };

  const [completed] = await db
    .update(backtestRuns)
    .set({
      status: "completed",
      progress: 100,
      result,
      updatedAt: completedAt,
      completedAt,
    })
    .where(eq(backtestRuns.id, id))
    .returning();

  return c.json({ id: completed.id, jobType: "backtest_run", status: "completed" }, 200);
}

// POST /api/backtests/runs/jobs — the path the lab actually calls.
r.post("/runs/jobs", requireAuth, createAndRunBacktest);
// POST /api/backtests/runs — contract alias (manifest names this path).
r.post("/runs", requireAuth, createAndRunBacktest);

export { r as backtestsRouter };
