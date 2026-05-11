/**
 * Browser-side SoDEX client (testnet by default, no key required).
 * Docs: https://sodex.com/documentation/api/api
 *
 * Public market-data endpoints — no auth.
 * Trade endpoints use EIP712 typed signatures (signed by the connected
 * EVM wallet via wagmi/viem); see lib/sodex-trade.ts when we wire those.
 */

const TESTNET = "https://testnet-gw.sodex.dev/api/v1/spot";
const MAINNET = "https://mainnet-gw.sodex.dev/api/v1/spot";

const BASE_URL =
  process.env.NEXT_PUBLIC_SODEX_API_BASE ??
  (process.env.NEXT_PUBLIC_SODEX_NETWORK === "mainnet" ? MAINNET : TESTNET);

async function get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`SoDEX ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// --- Types -----------------------------------------------------------------

export type SoDEXTicker = {
  symbol: string;
  lastPx: string;
  openPx: string;
  highPx: string;
  lowPx: string;
  volume: string;
  quoteVolume: string;
  change: string;
  changePct: number;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  openTime: number;
  closeTime: number;
};

export type SoDEXSymbol = {
  id: number;
  name: string;
  displayName: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
};

export type SoDEXOrderbookLevel = [price: string, size: string];

export type SoDEXOrderbook = {
  bids: SoDEXOrderbookLevel[];
  asks: SoDEXOrderbookLevel[];
  timestamp: number;
};

// --- Endpoints -------------------------------------------------------------

export function fetchTickers() {
  return get<{ code: number; timestamp: number; data: SoDEXTicker[] }>(
    "/markets/tickers",
  );
}

export function fetchSymbols() {
  return get<{ code: number; timestamp: number; data: SoDEXSymbol[] }>(
    "/markets/symbols",
  );
}

export function fetchOrderbook(symbol: string, limit = 10) {
  return get<{ code: number; timestamp: number; data: SoDEXOrderbook }>(
    `/markets/${symbol}/orderbook`,
    { limit },
  );
}

export function fetchRecentTrades(symbol: string, limit = 50) {
  return get<{ code: number; timestamp: number; data: unknown[] }>(
    `/markets/${symbol}/trades`,
    { limit },
  );
}

export function isTestnet() {
  return !BASE_URL.includes("mainnet");
}
