import { fetchAccountUserTrades, type SoDEXUserTrade } from "@/lib/sodex-public";

/**
 * Synthesized SPOT position for one symbol, derived from the account's fill
 * history by average-cost accounting. SoDEX spot has no margin/funding/short,
 * so "position" = net base inventory and its mark-to-market vs cost basis.
 */
export interface SpotPosition {
  symbol: string;
  /** Net base inventory. >0 = long (holding base); spot can't go net-short. */
  netQty: number;
  /** Average cost (quote per base) of the remaining inventory. 0 if flat. */
  avgCost: number;
  /** Current mark price. */
  markPrice: number;
  /** Unrealized PnL in quote = (mark - avgCost) * netQty. */
  unrealizedPnl: number;
  /** Unrealized PnL as % of cost basis. 0 if flat. */
  unrealizedPnlPct: number;
  /** True when |netQty| is above dust. */
  hasPosition: boolean;
}

const DUST = 1e-9;

/** Avg-cost walk over fills (oldest-first) → remaining inventory + cost basis. */
export function positionFromTrades(
  symbol: string,
  trades: SoDEXUserTrade[],
  markPrice: number,
): SpotPosition {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  let qty = 0;
  let avgCost = 0;
  for (const t of sorted) {
    const px = Number(t.price);
    const q = Number(t.qty);
    if (!(q > 0) || !Number.isFinite(px)) continue;
    if (t.side === "BUY") {
      const newQty = qty + q;
      avgCost = newQty > 0 ? (avgCost * qty + px * q) / newQty : 0;
      qty = newQty;
    } else {
      qty -= q;
      if (qty <= DUST) {
        qty = Math.max(qty, 0);
        if (qty <= DUST) avgCost = 0;
      }
    }
  }
  const hasPosition = Math.abs(qty) > DUST;
  const unrealizedPnl = hasPosition ? (markPrice - avgCost) * qty : 0;
  const costBasis = avgCost * qty;
  const unrealizedPnlPct = hasPosition && costBasis !== 0 ? (unrealizedPnl / costBasis) * 100 : 0;
  return { symbol, netQty: qty, avgCost, markPrice, unrealizedPnl, unrealizedPnlPct, hasPosition };
}

/**
 * Fetch the account's fills for `symbol` and reduce to a {@link SpotPosition}.
 * Returns a flat position (no error thrown) if the address has no trades.
 */
export async function buildSpotPosition(
  symbol: string,
  address: string,
  markPrice: number,
): Promise<SpotPosition> {
  try {
    const res = await fetchAccountUserTrades(address, { symbol });
    return positionFromTrades(symbol, res.data ?? [], markPrice);
  } catch {
    return {
      symbol,
      netQty: 0,
      avgCost: 0,
      markPrice,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      hasPosition: false,
    };
  }
}
