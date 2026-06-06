import type { BuilderAiRoute, VisualCondition } from "@/components/builder/builder-flow-utils";
import type { MarketSnapshot, RouteEvalContext, ConditionResult, RouteEvalResult } from "./types";
import { closes, highs, lows, volumes, typicalPrices } from "./market-snapshot";
import {
  sma,
  rsi,
  vwap,
  emaSeries,
  recentHigh,
  recentLow,
  crossedAbove,
  crossedBelow,
  atr,
  bollingerBands,
  macd,
  volatilityPct,
} from "./indicators";

type Cond = Partial<VisualCondition> & { type: string };

const DEFAULT_TF = "5m";
const DEFAULT_HTF = "1h";

/** Pick the candle series for a condition's declared timeframe, with fallback. */
function candlesFor(snap: MarketSnapshot, interval: string | undefined): import("@/lib/sodex-public").SoDEXCandle[] {
  const tf = interval ?? DEFAULT_TF;
  return snap.candlesByInterval[tf] ?? snap.candlesByInterval[DEFAULT_TF] ?? Object.values(snap.candlesByInterval)[0] ?? [];
}

function ok(type: string, fired: boolean, detail: string): ConditionResult {
  return { type, supported: true, fired, detail };
}
function unsupported(type: string): ConditionResult {
  return { type, supported: false, fired: false, detail: `condition "${type}" not yet evaluatable in runtime` };
}
/** Supported condition that lacks a required input — treated as "did not fire". */
function needs(type: string, what: string): ConditionResult {
  return ok(type, false, `missing ${what}`);
}

/**
 * Evaluate one condition against a market snapshot. The honest contract:
 * conditions we have NOT implemented return `supported: false` so the route is
 * blocked from firing — we never place a real order on a trigger we can't read.
 */
export function evaluateCondition(
  cond: Cond,
  snap: MarketSnapshot,
  ctx: RouteEvalContext,
): ConditionResult {
  const t = cond.type;
  const v = cond.value;
  const last = snap.lastPrice;

  switch (t) {
    case "price_above":
      return v === undefined ? needs(t, "value") : ok(t, last > v, `last ${last} > ${v}`);
    case "price_below":
      return v === undefined ? needs(t, "value") : ok(t, last < v, `last ${last} < ${v}`);

    case "price_change_pct_above":
      return v === undefined ? needs(t, "value") : ok(t, snap.ticker.changePct > v, `Δ ${snap.ticker.changePct}% > ${v}%`);
    case "price_change_pct_below":
      return v === undefined ? needs(t, "value") : ok(t, snap.ticker.changePct < v, `Δ ${snap.ticker.changePct}% < ${v}%`);

    case "volume_above": {
      if (v === undefined) return needs(t, "value");
      const vol = Number(snap.ticker.volume);
      return ok(t, vol > v, `vol ${vol} > ${v}`);
    }
    case "volume_below": {
      if (v === undefined) return needs(t, "value");
      const vol = Number(snap.ticker.volume);
      return ok(t, vol < v, `vol ${vol} < ${v}`);
    }

    case "breakout_above_recent_high": {
      const period = cond.period ?? 20;
      const hi = recentHigh(highs(candlesFor(snap, cond.timeframe)), period);
      return hi === null ? needs(t, `${period} bars`) : ok(t, last > hi, `last ${last} > high(${period}) ${hi}`);
    }
    case "breakout_below_recent_low": {
      const period = cond.period ?? 20;
      const lo = recentLow(lows(candlesFor(snap, cond.timeframe)), period);
      return lo === null ? needs(t, `${period} bars`) : ok(t, last < lo, `last ${last} < low(${period}) ${lo}`);
    }

    case "sma_above": {
      const period = cond.period ?? 20;
      const m = sma(closes(candlesFor(snap, cond.timeframe)), period);
      return m === null ? needs(t, `${period} bars`) : ok(t, last > m, `last ${last} > sma(${period}) ${m.toFixed(4)}`);
    }
    case "sma_below": {
      const period = cond.period ?? 20;
      const m = sma(closes(candlesFor(snap, cond.timeframe)), period);
      return m === null ? needs(t, `${period} bars`) : ok(t, last < m, `last ${last} < sma(${period}) ${m.toFixed(4)}`);
    }

    case "rsi_above": {
      if (v === undefined) return needs(t, "value");
      const period = cond.period ?? 14;
      const r = rsi(closes(candlesFor(snap, cond.timeframe)), period);
      return r === null ? needs(t, `${period + 1} bars`) : ok(t, r > v, `rsi(${period}) ${r.toFixed(2)} > ${v}`);
    }
    case "rsi_below": {
      if (v === undefined) return needs(t, "value");
      const period = cond.period ?? 14;
      const r = rsi(closes(candlesFor(snap, cond.timeframe)), period);
      return r === null ? needs(t, `${period + 1} bars`) : ok(t, r < v, `rsi(${period}) ${r.toFixed(2)} < ${v}`);
    }

    case "vwap_above": {
      const cs = candlesFor(snap, cond.timeframe);
      const w = vwap(typicalPrices(cs), volumes(cs));
      return w === null ? needs(t, "bars") : ok(t, last > w, `last ${last} > vwap ${w.toFixed(4)}`);
    }
    case "vwap_below": {
      const cs = candlesFor(snap, cond.timeframe);
      const w = vwap(typicalPrices(cs), volumes(cs));
      return w === null ? needs(t, "bars") : ok(t, last < w, `last ${last} < vwap ${w.toFixed(4)}`);
    }

    case "ema_crosses_above":
    case "ema_crosses_below": {
      const fastP = cond.fast_period ?? 9;
      const slowP = cond.slow_period ?? 21;
      const cs = closes(candlesFor(snap, cond.timeframe));
      const fast = emaSeries(cs, fastP);
      const slow = emaSeries(cs, slowP);
      if (fast.length < 2 || slow.length < 2) return needs(t, `${slowP + 1} bars`);
      // emaSeries lengths differ (each seeded at its own period); align tails.
      const n = Math.min(fast.length, slow.length);
      const f = fast.slice(fast.length - n);
      const s = slow.slice(slow.length - n);
      const crossed = t === "ema_crosses_above" ? crossedAbove(f, s) : crossedBelow(f, s);
      return ok(t, crossed, `ema(${fastP}/${slowP}) ${t === "ema_crosses_above" ? "↑" : "↓"} = ${crossed}`);
    }

    case "higher_timeframe_sma_above":
    case "higher_timeframe_sma_below": {
      const period = cond.period ?? 50;
      const tf = cond.secondary_timeframe ?? cond.timeframe ?? DEFAULT_HTF;
      const cs = snap.candlesByInterval[tf];
      if (!cs) return needs(t, `${tf} candles (not fetched)`);
      const m = sma(closes(cs), period);
      if (m === null) return needs(t, `${period} ${tf} bars`);
      const fired = t === "higher_timeframe_sma_above" ? last > m : last < m;
      return ok(t, fired, `last ${last} vs ${tf} sma(${period}) ${m.toFixed(4)}`);
    }

    case "cooldown_elapsed": {
      const seconds = cond.seconds ?? 0;
      const since = ctx.secondsSinceLastFire;
      const fired = since === null || since >= seconds;
      return ok(t, fired, since === null ? "never fired" : `${since.toFixed(0)}s elapsed ≥ ${seconds}s`);
    }

    case "atr_above":
    case "atr_below": {
      if (v === undefined) return needs(t, "value");
      const period = cond.period ?? 14;
      const cs = candlesFor(snap, cond.timeframe);
      const a = atr(highs(cs), lows(cs), closes(cs), period);
      if (a === null) return needs(t, `${period + 1} bars`);
      const fired = t === "atr_above" ? a > v : a < v;
      return ok(t, fired, `atr(${period}) ${a.toFixed(6)} ${t === "atr_above" ? ">" : "<"} ${v}`);
    }

    case "bollinger_above_upper":
    case "bollinger_below_lower": {
      const period = cond.period ?? 20;
      const bands = bollingerBands(closes(candlesFor(snap, cond.timeframe)), period, 2);
      if (bands === null) return needs(t, `${period} bars`);
      const fired = t === "bollinger_above_upper" ? last > bands.upper : last < bands.lower;
      const ref = t === "bollinger_above_upper" ? bands.upper : bands.lower;
      return ok(t, fired, `last ${last} vs band ${ref.toFixed(4)}`);
    }

    case "macd_crosses_above_signal":
    case "macd_crosses_below_signal": {
      const fastP = cond.fast_period ?? 12;
      const slowP = cond.slow_period ?? 26;
      const sigP = cond.signal_period ?? 9;
      const m = macd(closes(candlesFor(snap, cond.timeframe)), fastP, slowP, sigP);
      if (m === null || m.macdLine.length < 2) return needs(t, `${slowP + sigP} bars`);
      const crossed =
        t === "macd_crosses_above_signal" ? crossedAbove(m.macdLine, m.signal) : crossedBelow(m.macdLine, m.signal);
      return ok(t, crossed, `macd(${fastP}/${slowP}/${sigP}) ${t === "macd_crosses_above_signal" ? "↑" : "↓"} signal = ${crossed}`);
    }

    case "volatility_above":
    case "volatility_below": {
      if (v === undefined) return needs(t, "value");
      const period = cond.period ?? 20;
      const vol = volatilityPct(closes(candlesFor(snap, cond.timeframe)), period);
      if (vol === null) return needs(t, `${period + 1} bars`);
      const fired = t === "volatility_above" ? vol > v : vol < v;
      return ok(t, fired, `vol(${period}) ${vol.toFixed(3)}% ${t === "volatility_above" ? ">" : "<"} ${v}%`);
    }

    // ── Spot account-state conditions ────────────────────────────────────
    // Derived from the synthesized position (ctx.position). When no account is
    // connected, position is absent → these read as "flat" (supported, not
    // firing), which is the correct behaviour for a position-gated exit route.
    case "has_position":
      return ok(t, ctx.position?.hasPosition ?? false, ctx.position ? `netQty ${ctx.position.netQty}` : "no account/position");
    case "position_side_is": {
      const want = cond.side ?? "long";
      const net = ctx.position?.netQty ?? 0;
      const side = net > 0 ? "long" : net < 0 ? "short" : "flat";
      return ok(t, side === want, `side ${side} == ${want}`);
    }
    case "position_in_profit":
      return ok(t, (ctx.position?.hasPosition ?? false) && (ctx.position?.unrealizedPnl ?? 0) > 0, `uPnL ${ctx.position?.unrealizedPnl ?? 0}`);
    case "position_in_loss":
      return ok(t, (ctx.position?.hasPosition ?? false) && (ctx.position?.unrealizedPnl ?? 0) < 0, `uPnL ${ctx.position?.unrealizedPnl ?? 0}`);
    case "position_pnl_above":
      if (v === undefined) return needs(t, "value");
      return ok(t, (ctx.position?.hasPosition ?? false) && (ctx.position?.unrealizedPnl ?? 0) > v, `uPnL ${ctx.position?.unrealizedPnl ?? 0} > ${v}`);
    case "position_pnl_below":
      if (v === undefined) return needs(t, "value");
      return ok(t, (ctx.position?.hasPosition ?? false) && (ctx.position?.unrealizedPnl ?? 0) < v, `uPnL ${ctx.position?.unrealizedPnl ?? 0} < ${v}`);
    case "position_pnl_pct_above":
      if (v === undefined) return needs(t, "value");
      return ok(t, (ctx.position?.hasPosition ?? false) && (ctx.position?.unrealizedPnlPct ?? 0) > v, `uPnL% ${(ctx.position?.unrealizedPnlPct ?? 0).toFixed(2)} > ${v}`);
    case "position_pnl_pct_below":
      if (v === undefined) return needs(t, "value");
      return ok(t, (ctx.position?.hasPosition ?? false) && (ctx.position?.unrealizedPnlPct ?? 0) < v, `uPnL% ${(ctx.position?.unrealizedPnlPct ?? 0).toFixed(2)} < ${v}`);

    // SoDEX is a SPOT venue — no funding rate exists. Kept honestly unsupported
    // rather than fabricating a value; this blocks any route that depends on it.
    case "funding_rate_above":
    case "funding_rate_below":
      return { type: t, supported: false, fired: false, detail: `"${t}" unsupported: SoDEX spot has no funding rate` };

    default:
      return unsupported(t);
  }
}

/**
 * Evaluate a whole route. Fires only when EVERY condition is supported AND true.
 * Any unsupported condition blocks the route (safe default — never trade on an
 * unreadable trigger).
 */
export function evaluateRoute(
  route: BuilderAiRoute,
  snap: MarketSnapshot,
  ctx: RouteEvalContext,
): RouteEvalResult {
  const conditions = route.conditions.map((c) => evaluateCondition(c, snap, ctx));
  const hasUnsupported = conditions.some((c) => !c.supported);
  const fired = conditions.length > 0 && !hasUnsupported && conditions.every((c) => c.fired);
  return { fired, hasUnsupported, conditions };
}

/** Collect the distinct kline intervals a route's conditions reference. */
export function routeIntervals(route: BuilderAiRoute): string[] {
  const out = new Set<string>([DEFAULT_TF]);
  for (const c of route.conditions as Cond[]) {
    if (c.timeframe) out.add(c.timeframe);
    if (c.secondary_timeframe) out.add(c.secondary_timeframe);
    if (
      (c.type === "higher_timeframe_sma_above" || c.type === "higher_timeframe_sma_below") &&
      !c.secondary_timeframe &&
      !c.timeframe
    ) {
      out.add(DEFAULT_HTF);
    }
  }
  return Array.from(out);
}
