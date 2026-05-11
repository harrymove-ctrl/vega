/**
 * Browser-side SoSoValue client. Uses NEXT_PUBLIC_SOSOVALUE_API_KEY which
 * is embedded in the JS bundle — only acceptable with a Demo-tier free key
 * that can be rotated. For higher tiers, proxy via a Worker function instead.
 *
 * Docs: https://sosovalue.gitbook.io/soso-value-api-doc
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_SOSOVALUE_API_BASE ??
  "https://openapi.sosovalue.com/openapi/v1";

const API_KEY = process.env.NEXT_PUBLIC_SOSOVALUE_API_KEY ?? "";

type Q = Record<string, string | number | undefined>;

async function get<T>(path: string, query?: Q): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: API_KEY ? { "x-soso-api-key": API_KEY } : {},
  });
  if (!res.ok) {
    throw new Error(`SoSoValue ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// --- Types (narrow projection of upstream responses we use) -----------------

export type EtfFlowRow = {
  date: string;
  total_net_inflow: number;
  total_value_traded: number;
  total_net_assets: number;
  cum_net_inflow: number;
};

export type EtfFund = {
  ticker: string;
  name: string;
  exchange: string;
};

export type NewsItem = {
  id: string;
  sourceLink: string;
  releaseTime: number;
  author: string;
  category: number;
  multilanguageContent: { language: string; title: string; content: string }[];
  matchedCurrencies?: { name?: string }[];
  tags?: string[];
};

// --- Endpoints --------------------------------------------------------------

export function fetchEtfSummaryHistory(opts: { symbol?: string; countryCode?: string } = {}) {
  return get<{ code: number; message: string; data: EtfFlowRow[] }>(
    "/etfs/summary-history",
    { symbol: opts.symbol ?? "BTC", country_code: opts.countryCode ?? "US" },
  );
}

export function fetchEtfs(opts: { symbol?: string; countryCode?: string } = {}) {
  return get<{ code: number; message: string; data: EtfFund[] }>("/etfs", {
    symbol: opts.symbol ?? "BTC",
    country_code: opts.countryCode ?? "US",
  });
}

export function fetchFeaturedNews(opts: { pageNum?: number; pageSize?: number } = {}) {
  return get<{
    code: number;
    data: { pageNum: number; pageSize: number; total: number; list: NewsItem[] };
  }>("/news/featured", {
    pageNum: opts.pageNum ?? 1,
    pageSize: opts.pageSize ?? 20,
  });
}
