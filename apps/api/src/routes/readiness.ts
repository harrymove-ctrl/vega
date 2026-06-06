/**
 * /api/sodex — SoDEX deploy-readiness (REAL upstream checks, not a stub).
 *
 * Contract (p1d-backend-contract-and-plan.md §"Readiness", row 9):
 *   GET /readiness?wallet_address= -> SoDEXReadinessPayload
 *     { wallet_address, ready, blockers[], metrics{...}, steps[] }
 *
 * Response shape is dereferenced field-for-field by:
 *   - apps/web/src/lib/sodex-readiness.ts            (SoDEXReadinessPayload / SoDEXReadinessStep)
 *   - apps/web/src/lib/disable-missing-backend.ts    (demo-stub mirror)
 *   - apps/web/src/app/onboarding/page.tsx           (metrics.sol_balance >= min, equity_usd >= min, step "agent_authorization".verified)
 *   - apps/web/src/components/sodex/onboarding-checklist.tsx (renders every metric + step)
 *
 * Readiness is computed from genuine on-chain + exchange reads:
 *   1. FUNDING  — native ValueChain gas balance via JSON-RPC `eth_getBalance`
 *      on the testnet RPC (the token the UI labels "SOSO"). Also proves chain
 *      reachability.
 *   2. APP ACCESS — the SoDEX testnet spot gateway account-state endpoint
 *      (`/api/v1/spot/accounts/<addr>/state`). The account is provisioned on
 *      SoDEX iff the gateway returns `code === 0` with `data.aid > 0`. Equity
 *      is the sum of positive USD-stable balances (vUSDC / tUSDC / USDC).
 *   3. AGENT AUTHORIZATION — EIP-712 delegated-signer authorization is NOT yet
 *      shipped (genuinely out of scope). We source it honestly from our own DB:
 *      an active bot_runtimes row for the wallet means an agent is bound. With
 *      no delegation we report it unverified with a clear detail — never a fake
 *      success.
 *
 * `ready` is true only when the SoDEX account resolves AND has a usable balance
 * (equity >= min AND gas >= min) — i.e. the wallet can actually trade.
 */
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";

import type { AppEnv } from "../app";
import { getDb } from "../db/client";
import { botRuntimes } from "../db/schema";
import { normalizeAddress } from "../auth";

const r = new Hono<AppEnv>();

// --- upstream config (overridable via wrangler vars; testnet defaults) -------
//
// These mirror apps/web/.env.local + apps/web/src/lib/sodex-public.ts so the
// backend reads the same SoDEX testnet gateway + ValueChain testnet RPC the
// frontend signs against.
const SODEX_SPOT_BASE = "https://testnet-gw.sodex.dev/api/v1/spot";
const VALUECHAIN_RPC = "https://testnet-rpc.valuechain.xyz";

// Funding/equity floors. The frontend recomputes the gate from these exact
// fields (onboarding/page.tsx:75,80), so they must be present + numeric.
const MIN_SOL_BALANCE = 0.1; // native "SOSO" gas, in ether units
const MIN_EQUITY_USD = 100; // usable USD-stable equity on SoDEX

// USD-stable coin symbols on the SoDEX testnet that count toward equity.
const USD_STABLE_SYMBOLS = new Set(["VUSDC", "TUSDC", "USDC", "USDT", "VUSDT"]);

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// --- upstream response shapes (subset we read) -------------------------------
type SoDEXCompactBalance = { i: number; a: string; t: string; l: string };
type SoDEXAccountState = {
  user: string;
  aid: number;
  uid: number;
  B: SoDEXCompactBalance[] | null;
  O: unknown[] | null;
};
type SoDEXStateEnvelope = {
  code: number;
  timestamp?: number;
  data?: SoDEXAccountState;
  error?: string;
};

// --- helpers -----------------------------------------------------------------

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Native ValueChain gas balance ("SOSO") in ether units via JSON-RPC.
 * Returns { balance, reachable }: reachable=false means the RPC was
 * unreachable (a hard blocker), distinct from a real 0 balance.
 */
async function fetchNativeBalance(
  address: `0x${string}`,
  rpcUrl: string,
): Promise<{ balance: number; reachable: boolean }> {
  try {
    const res = await fetchWithTimeout(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
    if (!res.ok) return { balance: 0, reachable: false };
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (typeof json.result !== "string") return { balance: 0, reachable: false };
    // hex wei -> ether (number). BigInt for precision, then scale down.
    const wei = BigInt(json.result);
    const balance = Number(wei) / 1e18;
    return { balance: Number.isFinite(balance) ? balance : 0, reachable: true };
  } catch {
    return { balance: 0, reachable: false };
  }
}

/**
 * SoDEX testnet account state. A fresh/unknown wallet returns code:0 with
 * aid:0 + empty balances; a provisioned account returns aid>0. A malformed
 * address returns code:-1 with `error`.
 */
async function fetchSoDEXAccountState(
  address: `0x${string}`,
  spotBase: string,
): Promise<{ state: SoDEXAccountState | null; reachable: boolean; gatewayError: string | null }> {
  try {
    const res = await fetchWithTimeout(`${spotBase}/accounts/${address}/state`, { method: "GET" });
    if (!res.ok) {
      return { state: null, reachable: false, gatewayError: `SoDEX gateway returned ${res.status}` };
    }
    const env = (await res.json()) as SoDEXStateEnvelope;
    if (env.code !== 0) {
      return { state: null, reachable: true, gatewayError: env.error ?? `SoDEX gateway code ${env.code}` };
    }
    return { state: env.data ?? null, reachable: true, gatewayError: null };
  } catch {
    return { state: null, reachable: false, gatewayError: null };
  }
}

/** Sum positive USD-stable balances (total, the compact `t` field) to USD equity. */
function computeEquityUsd(state: SoDEXAccountState | null): number | null {
  if (!state || !Array.isArray(state.B)) return null;
  let equity = 0;
  for (const bal of state.B) {
    if (!USD_STABLE_SYMBOLS.has(bal.a.toUpperCase())) continue;
    const total = Number(bal.t);
    if (Number.isFinite(total) && total > 0) equity += total;
  }
  return equity;
}

// --- route -------------------------------------------------------------------

r.get("/readiness", async (c) => {
  const rawWallet = c.req.query("wallet_address");
  if (!rawWallet || !rawWallet.trim()) {
    return c.json({ detail: "wallet_address is required" }, 400);
  }
  const trimmed = rawWallet.trim();
  if (!EVM_ADDRESS.test(trimmed)) {
    return c.json({ detail: "wallet_address must be a 0x EVM address" }, 400);
  }
  const wallet = normalizeAddress(trimmed);

  const rpcUrl = c.env.VALUECHAIN_RPC ?? VALUECHAIN_RPC;
  const spotBase = c.env.SODEX_SPOT_BASE ?? SODEX_SPOT_BASE;
  const builderCode = c.env.SODEX_BUILDER_CODE ?? null;

  // Real upstream reads, in parallel.
  const [funding, account, agentRuntime] = await Promise.all([
    fetchNativeBalance(wallet, rpcUrl),
    fetchSoDEXAccountState(wallet, spotBase),
    // Agent delegation, sourced honestly from our DB: an active runtime means
    // an agent signer is bound to this wallet. (EIP-712 on-chain delegation is
    // not yet shipped — see step detail below.)
    getDb(c.env)
      .select({ id: botRuntimes.id, ownerAddress: botRuntimes.ownerAddress })
      .from(botRuntimes)
      .where(
        and(
          eq(botRuntimes.ownerAddress, wallet),
          eq(botRuntimes.status, "active"),
          isNull(botRuntimes.stoppedAt),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
      .catch(() => null),
  ]);

  const blockers: string[] = [];

  // --- metric: native gas ("SOSO") ---
  const solBalance = funding.balance;
  if (!funding.reachable) {
    blockers.push("ValueChain testnet RPC is unreachable — cannot verify gas balance.");
  }
  const solReady = funding.reachable && solBalance >= MIN_SOL_BALANCE;

  // --- metric: SoDEX account + equity ---
  const accountState = account.state;
  const accountProvisioned = Boolean(accountState && accountState.aid > 0);
  const equityUsd = computeEquityUsd(accountState);

  if (!account.reachable) {
    blockers.push("SoDEX testnet gateway is unreachable — cannot verify your account.");
  } else if (account.gatewayError) {
    blockers.push(`SoDEX rejected the account lookup: ${account.gatewayError}`);
  } else if (!accountProvisioned) {
    blockers.push("Your wallet is not provisioned on SoDEX yet — open the SoDEX app once to create your account.");
  }

  const equityReady = accountProvisioned && equityUsd !== null && equityUsd >= MIN_EQUITY_USD;
  if (accountProvisioned && !equityReady) {
    blockers.push(`Fund your SoDEX account to at least $${MIN_EQUITY_USD} in USD-stable to deploy.`);
  }

  if (!solReady && funding.reachable) {
    blockers.push(`Fund your wallet with at least ${MIN_SOL_BALANCE} SOSO for gas.`);
  }

  // --- metric: agent authorization (DB-sourced; delegation not yet shipped) ---
  const agentBound = Boolean(agentRuntime);
  const agentWalletAddress = agentRuntime ? agentRuntime.ownerAddress : null;
  const authorizationStatus = agentBound ? "active" : "inactive";
  if (!agentBound) {
    blockers.push("Authorize a Vega agent signer before deploying (delegated trading not yet active).");
  }

  const steps = [
    {
      id: "funding" as const,
      title: "Testnet wallet funded",
      verified: solReady,
      detail: solReady
        ? `${solBalance.toFixed(4)} SOSO available for gas on ValueChain testnet.`
        : funding.reachable
          ? `Need at least ${MIN_SOL_BALANCE} SOSO for gas (have ${solBalance.toFixed(4)}).`
          : "ValueChain testnet RPC unreachable — retry once the chain responds.",
    },
    {
      id: "app_access" as const,
      title: "SoDEX account ready",
      verified: equityReady,
      detail: !account.reachable
        ? "SoDEX gateway unreachable — retry shortly."
        : !accountProvisioned
          ? "Open SoDEX once with this wallet to provision your spot account."
          : equityUsd !== null && equityUsd >= MIN_EQUITY_USD
            ? `$${equityUsd.toFixed(2)} usable USD-stable equity on SoDEX.`
            : `Need $${MIN_EQUITY_USD} USD-stable equity (have $${(equityUsd ?? 0).toFixed(2)}).`,
    },
    {
      id: "agent_authorization" as const,
      title: "Agent runtime ready",
      verified: agentBound,
      detail: agentBound
        ? "A Vega agent signer is bound to this wallet."
        : "Delegated agent signing (EIP-712) is not yet authorized for this wallet.",
    },
  ];

  // `ready` only when the wallet can actually trade: account resolves with a
  // usable balance AND gas is funded. Agent authorization is surfaced as a
  // step/blocker but the on-chain delegation flow is not yet shipped, so it is
  // not gated here (the launch gate in onboarding/page.tsx additionally checks
  // the agent_authorization step before letting the user deploy).
  const ready = equityReady && solReady;

  const payload = {
    wallet_address: wallet,
    ready,
    blockers,
    metrics: {
      sol_balance: solBalance,
      min_sol_balance: MIN_SOL_BALANCE,
      equity_usd: equityUsd,
      min_equity_usd: MIN_EQUITY_USD,
      agent_wallet_address: agentWalletAddress,
      authorization_status: authorizationStatus,
      builder_code: builderCode,
    },
    steps,
  };

  return c.json(payload);
});

export { r as readinessRouter };
