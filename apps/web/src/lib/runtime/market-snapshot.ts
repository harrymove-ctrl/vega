import {
  fetchTickers,
  fetchSymbols,
  fetchKlines,
  fetchOrderbook,
  type SoDEXCandle,
} from "@/lib/sodex-public";
import type { MarketSnapshot } from "./types";

/** Close prices, oldest-first. */
export function closes(candles: SoDEXCandle[]): number[] {
  return candles.map((c) => Number(c.c));
}
export function highs(candles: SoDEXCandle[]): number[] {
  return candles.map((c) => Number(c.h));
}
export function lows(candles: SoDEXCandle[]): number[] {
  return candles.map((c) => Number(c.l));
}
export function volumes(candles: SoDEXCandle[]): number[] {
  return candles.map((c) => Number(c.v));
}
/** Typical price (h+l+c)/3 per bar. */
export function typicalPrices(candles: SoDEXCandle[]): number[] {
  return candles.map((c) => (Number(c.h) + Number(c.l) + Number(c.c)) / 3);
}

export interface SnapshotOptions {
  /** Kline intervals to fetch (collected from the route's condition timeframes). */
  intervals?: string[];
  /** Candles per interval. */
  klineLimit?: number;
  /** Orderbook depth (0 = skip orderbook fetch). */
  orderbookDepth?: number;
}

/**
 * Assemble a {@link MarketSnapshot} for one symbol from the public SoDEX
 * endpoints. Pure-ish: the only side effects are network reads. The evaluator
 * consumes the returned object with no further I/O.
 */
export async function buildMarketSnapshot(
  symbol: string,
  opts: SnapshotOptions = {},
): Promise<MarketSnapshot> {
  const intervals = opts.intervals?.length ? Array.from(new Set(opts.intervals)) : ["5m"];
  const klineLimit = opts.klineLimit ?? 200;
  const obDepth = opts.orderbookDepth ?? 10;

  const [tickerRes, symRes] = await Promise.all([fetchTickers(), fetchSymbols()]);
  const ticker = tickerRes.data.find((t) => t.symbol === symbol);
  if (!ticker) throw new Error(`No ticker for symbol "${symbol}" on this network`);
  const meta = symRes.data.find((s) => s.name === symbol);
  if (!meta) throw new Error(`No symbol metadata for "${symbol}" on this network`);

  const candlesByInterval: Record<string, SoDEXCandle[]> = {};
  await Promise.all(
    intervals.map(async (interval) => {
      const res = await fetchKlines(symbol, { interval, limit: klineLimit });
      candlesByInterval[interval] = res.data ?? [];
    }),
  );

  let orderbook = null;
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  if (obDepth > 0) {
    const obRes = await fetchOrderbook(symbol, obDepth);
    orderbook = obRes.data ?? null;
    bestBid = orderbook?.bids?.[0]?.[0] ? Number(orderbook.bids[0][0]) : null;
    bestAsk = orderbook?.asks?.[0]?.[0] ? Number(orderbook.asks[0][0]) : null;
  }

  return {
    symbol,
    meta,
    ticker,
    lastPrice: Number(ticker.lastPx),
    bestBid,
    bestAsk,
    candlesByInterval,
    orderbook,
  };
}
