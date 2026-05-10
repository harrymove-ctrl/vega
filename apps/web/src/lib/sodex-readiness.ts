const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type SoDEXReadinessStep = {
  id: "funding" | "app_access" | "agent_authorization";
  title: string;
  verified: boolean;
  detail: string;
};

export type SoDEXReadinessPayload = {
  wallet_address: string;
  ready: boolean;
  blockers: string[];
  metrics: {
    sol_balance: number;
    min_sol_balance: number;
    equity_usd: number | null;
    min_equity_usd: number;
    agent_wallet_address: string | null;
    authorization_status: string;
    builder_code: string | null;
  };
  steps: SoDEXReadinessStep[];
};

type ReadinessErrorPayload = {
  detail?: string;
};

type AuthHeaderFactory = (headersInit?: HeadersInit) => Promise<Headers>;

export class SoDEXReadinessError extends Error {
  readonly readiness: SoDEXReadinessPayload;

  constructor(readiness: SoDEXReadinessPayload) {
    super(formatSoDEXReadinessBlockers(readiness.blockers));
    this.name = "SoDEXReadinessError";
    this.readiness = readiness;
  }
}

export function formatSoDEXReadinessBlockers(blockers: string[]) {
  const uniqueBlockers = Array.from(new Set(blockers.map((blocker) => blocker.trim()).filter(Boolean)));
  return uniqueBlockers.length > 0 ? uniqueBlockers.join(" ") : "SoDEX setup is incomplete.";
}

export async function fetchSoDEXReadiness(walletAddress: string, getAuthHeaders: AuthHeaderFactory) {
  const resolvedWalletAddress = walletAddress.trim();
  if (!resolvedWalletAddress) {
    throw new Error("Connect the wallet you want Vega to trade with.");
  }

  const response = await fetch(`${API_BASE_URL}/api/sodex/readiness?wallet_address=${encodeURIComponent(resolvedWalletAddress)}`, {
    cache: "no-store",
    headers: await getAuthHeaders(),
  });
  const payload = (await response.json()) as SoDEXReadinessPayload | ReadinessErrorPayload;
  if (!response.ok) {
    throw new Error("detail" in payload ? payload.detail ?? "SoDEX readiness check failed." : "SoDEX readiness check failed.");
  }
  return payload as SoDEXReadinessPayload;
}

export async function assertSoDEXDeployReadiness(walletAddress: string, getAuthHeaders: AuthHeaderFactory) {
  const readiness = await fetchSoDEXReadiness(walletAddress, getAuthHeaders);
  if (!readiness.ready) {
    throw new SoDEXReadinessError(readiness);
  }
  return readiness;
}
