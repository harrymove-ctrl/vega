/**
 * SoDEX REST client (server-side only).
 * Docs: https://sodex.com/documentation/api/api
 *
 * Defaults to mainnet base URL; override with SODEX_API_BASE for testnet
 * (https://testnet.sodex.com/api).
 *
 * Endpoint paths and auth header are starting guesses — confirm against the
 * official docs once your buildathon access is approved and adjust.
 */
const BASE_URL = process.env.SODEX_API_BASE ?? "https://api.sodex.com";

export class SoDEXError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string,
  ) {
    super(message ?? `SoDEX API error ${status}`);
  }
}

type FetchOpts = {
  query?: Record<string, string | number | undefined>;
  init?: RequestInit;
};

export async function sodexFetch<T = unknown>(
  path: string,
  { query, init }: FetchOpts = {},
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const apiKey = process.env.SODEX_API_KEY;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-sodex-api-key": apiKey } : {}),
      ...(init?.headers ?? {}),
    },
    next: { revalidate: 5 },
  });

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    throw new SoDEXError(res.status, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const sodex = {
  markets: () => sodexFetch(`/v1/markets`),
  orderbook: (symbol: string) =>
    sodexFetch(`/v1/orderbook`, { query: { symbol } }),
};
