import type { VisualAction } from "@/components/builder/builder-flow-utils";
import type { BatchNewOrderItem } from "@/lib/sodex-trade";
import type { MarketSnapshot } from "./types";

type Action = Partial<VisualAction> & { type: string };

export type ActionPlan =
  | { kind: "order"; item: BatchNewOrderItem; notional: number; summary: string }
  | { kind: "unsupported"; type: string; reason: string };

function decimals(s: string): number {
  return (s.split(".")[1] ?? "").length;
}
function roundTo(value: number, stepStr: string, mode: "floor" | "ceil"): string {
  const step = Number(stepStr);
  const decs = decimals(stepStr);
  if (!(step > 0)) return value.toString();
  const n = mode === "floor" ? Math.floor(value / step) : Math.ceil(value / step - 1e-12);
  return (n * step).toFixed(decs);
}

/**
 * Translate a builder action into a concrete SoDEX spot order, sized against
 * the live snapshot and clamped to the symbol's tick/step/min constraints.
 *
 * Spot-only scope (Option A, Phase 1): open_long/open_short and explicit
 * market/limit placements map to real orders. Perp-flavoured actions
 * (close_position, set_tpsl, update_leverage, twap) and cancels are reported
 * `unsupported` so the runtime logs them rather than placing a wrong order.
 */
export function mapActionToOrder(
  action: Action,
  snap: MarketSnapshot,
  clOrdID: string,
): ActionPlan {
  const meta = snap.meta;
  const symbolID = meta.id;

  let side: "buy" | "sell";
  let orderType: "market" | "limit";

  switch (action.type) {
    case "open_long":
      side = "buy";
      orderType = action.price !== undefined ? "limit" : "market";
      break;
    case "open_short":
      side = "sell";
      orderType = action.price !== undefined ? "limit" : "market";
      break;
    case "place_market_order":
      side = action.side === "short" ? "sell" : "buy";
      orderType = "market";
      break;
    case "place_limit_order":
      side = action.side === "short" ? "sell" : "buy";
      orderType = "limit";
      break;
    case "place_twap_order":
    case "close_position":
    case "set_tpsl":
    case "update_leverage":
    case "cancel_order":
    case "cancel_twap_order":
    case "cancel_all_orders":
      return {
        kind: "unsupported",
        type: action.type,
        reason: `"${action.type}" is not wired in the spot runtime yet`,
      };
    default:
      return { kind: "unsupported", type: action.type, reason: `unknown action "${action.type}"` };
  }

  const tif = (action.tif as BatchNewOrderItem["timeInForce"]) ?? (orderType === "market" ? "ioc" : "gtc");

  // Reference price: explicit action price, else best bid/ask, else last.
  const refPrice =
    action.price ??
    (side === "buy" ? snap.bestAsk : snap.bestBid) ??
    snap.lastPrice;
  if (!(refPrice > 0)) {
    return { kind: "unsupported", type: action.type, reason: "no usable reference price in snapshot" };
  }

  // Resolve quantity from size_usd or explicit quantity, clamped to step/min.
  let qtyNum: number;
  if (action.quantity !== undefined) {
    qtyNum = action.quantity;
  } else if (action.size_usd !== undefined) {
    qtyNum = action.size_usd / refPrice;
  } else {
    return { kind: "unsupported", type: action.type, reason: "action has neither size_usd nor quantity" };
  }
  qtyNum = Math.max(qtyNum, Number(meta.minQuantity));
  const quantity = roundTo(qtyNum, meta.stepSize, "ceil");

  const item: BatchNewOrderItem = {
    symbolID,
    clOrdID,
    side,
    type: orderType,
    timeInForce: tif,
  };

  if (orderType === "limit") {
    const priceStr = roundTo(refPrice, meta.tickSize, "floor");
    item.price = priceStr;
    item.quantity = quantity;
    const notional = Number(priceStr) * Number(quantity);
    return { kind: "order", item, notional, summary: `${side} ${quantity} @ ${priceStr} (limit)` };
  }

  // Market order: a buy spends quote `funds`; a sell delivers base `quantity`.
  if (side === "buy" && action.size_usd !== undefined && action.quantity === undefined) {
    item.funds = String(action.size_usd);
    const notional = action.size_usd;
    return { kind: "order", item, notional, summary: `buy ~${notional} quote (market)` };
  }
  item.quantity = quantity;
  const notional = refPrice * Number(quantity);
  return { kind: "order", item, notional, summary: `${side} ${quantity} (market)` };
}
