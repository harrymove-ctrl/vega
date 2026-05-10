/**
 * Shared TypeScript contracts between apps/web and any TS tooling.
 * Backend stays in Python — shapes here mirror what the FastAPI service
 * returns. Keep narrow and stable.
 */

// ----- SoSoValue -----

export type SoSoValueETFOverview = {
  asOfDate: string;
  totalAUM: number;
  netInflow24h: number;
  funds: SoSoValueETFFund[];
};

export type SoSoValueETFFund = {
  ticker: string;
  issuer: string;
  aum: number;
  netInflow24h: number;
  premiumDiscount: number;
};

export type SoSoValueNewsItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment?: number;
  currencies?: string[];
};

// ----- SSI / Indices -----

export type SSIIndex = {
  symbol: string;
  name: string;
  navUSD: number;
  components: SSIComponent[];
  rebalance: { lastAt: string; nextAt?: string };
};

export type SSIComponent = {
  symbol: string;
  weight: number;
  drift: number;
};

// ----- SoDEX -----

export type SoDEXMarket = {
  symbol: string;
  base: string;
  quote: string;
  status: "live" | "paused" | "delisted";
  tickSize: number;
  lotSize: number;
};

export type SoDEXOrderbook = {
  symbol: string;
  bids: [price: number, size: number][];
  asks: [price: number, size: number][];
  ts: number;
};

// ----- Agents / Strategies -----

export type AgentStatus = "draft" | "deployed" | "paused" | "stopped" | "error";

export type Agent = {
  id: string;
  ownerAddress: `0x${string}`;
  name: string;
  status: AgentStatus;
  graph: StrategyGraph;
  riskEnvelope: RiskEnvelope;
  createdAt: string;
  updatedAt: string;
};

export type StrategyGraph = {
  nodes: StrategyNode[];
  edges: { from: string; to: string }[];
};

export type StrategyNode =
  | { id: string; kind: "trigger"; condition: TriggerCondition }
  | { id: string; kind: "filter"; condition: FilterCondition }
  | { id: string; kind: "action"; action: AgentAction };

export type TriggerCondition = {
  type:
    | "etf-flow-threshold"
    | "ssi-drift"
    | "news-sentiment"
    | "sodex-orderbook-imbalance";
  params: Record<string, number | string>;
};

export type FilterCondition = {
  type: "asset-allowlist" | "time-of-day" | "indicator-cross";
  params: Record<string, number | string | string[]>;
};

export type AgentAction = {
  type: "sodex-market" | "sodex-limit" | "alert" | "rebalance";
  params: Record<string, number | string>;
};

export type RiskEnvelope = {
  maxPositionUSD: number;
  maxDrawdownPct: number;
  allowedAssets: string[];
  manualApproveAboveUSD?: number;
};

// ----- Backtest -----

export type BacktestResult = {
  agentId: string;
  symbol: string;
  start: string;
  end: string;
  equityCurve: { ts: number; equity: number }[];
  trades: BacktestTrade[];
  stats: BacktestStats;
};

export type BacktestTrade = {
  ts: number;
  side: "buy" | "sell";
  price: number;
  size: number;
  pnl: number;
};

export type BacktestStats = {
  totalReturnPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
  winRate: number;
  trades: number;
};
