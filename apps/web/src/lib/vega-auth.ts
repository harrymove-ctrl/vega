"use client";

import { useCallback, useMemo, type MouseEvent } from "react";

import { useAccount, useDisconnect } from "wagmi";
import { signMessage } from "wagmi/actions";
import { useConnectModal } from "@rainbow-me/rainbowkit";

import { wagmiConfig } from "@/lib/wagmi";

export type AvailableSolanaWallet = {
  id: string;
  label: string;
};

// Base URL of the Vega API worker (apps/api — Hono on Cloudflare Workers).
// Defaults to the local `wrangler dev` port; point NEXT_PUBLIC_API_BASE_URL at
// the deployed worker URL in production (see .env.example). We never hardcode
// a remote URL here.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// --- session token cache -------------------------------------------------
// The signed-challenge flow is interactive (the wallet prompts the user to
// sign), so we cache the minted bearer token per-address to avoid re-prompting
// on every authed request. Cache layers:
//   1. in-memory (per tab, survives re-renders / hook re-mounts)
//   2. sessionStorage (survives a page reload within the same tab)
// We intentionally do NOT use localStorage — a session token shouldn't outlive
// the tab. The token itself is an HMAC-signed claim minted by the worker
// (see apps/api/src/auth), so it is not spoofable like the old `wagmi:<addr>`.

type CachedToken = { address: string; token: string };

let memoryToken: CachedToken | null = null;
// De-dupe concurrent sign prompts: if two requests need a token at once, both
// await the same in-flight challenge instead of opening two wallet popups.
let inflight: Promise<string | null> | null = null;

const SESSION_KEY = "vega.auth.token";

function readSessionToken(address: string): string | null {
  if (memoryToken && memoryToken.address === address) return memoryToken.token;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (parsed?.address === address && parsed?.token) {
      memoryToken = parsed;
      return parsed.token;
    }
  } catch {
    /* malformed / unavailable storage — ignore */
  }
  return null;
}

function writeSessionToken(entry: CachedToken): void {
  memoryToken = entry;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(entry));
  } catch {
    /* storage full / disabled — in-memory cache still works */
  }
}

function clearSessionToken(): void {
  memoryToken = null;
  inflight = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Run the full signed-challenge handshake against the Vega API worker:
 *   1. GET  {API_BASE}/api/auth/nonce?address=  -> { address, nonce, message, expiresAt }
 *   2. signMessage(message)                      (wagmi/RainbowKit signer prompt)
 *   3. POST {API_BASE}/api/auth/verify {address, signature} -> { address, token }
 * Returns the minted bearer token, or null if any step fails (no wallet,
 * user rejected the signature, worker unreachable, …). Callers degrade
 * gracefully — an authed request just goes out unauthenticated and the worker
 * returns 401, which pages already handle.
 */
async function mintToken(address: string): Promise<string | null> {
  try {
    // 1. fetch the server-issued nonce + the exact message to sign.
    const nonceRes = await fetch(
      `${API_BASE_URL}/api/auth/nonce?address=${encodeURIComponent(address)}`,
    );
    if (!nonceRes.ok) return null;
    const { message } = (await nonceRes.json()) as {
      address: string;
      nonce: string;
      message: string;
      expiresAt?: number;
    };
    if (!message) return null;

    // 2. sign the challenge with the connected wallet. The worker rebuilds the
    // same `Vega auth: <nonce>` string and recovers the signer — so we sign the
    // server's `message` verbatim rather than reconstructing it client-side.
    const signature = await signMessage(wagmiConfig, {
      account: address as `0x${string}`,
      message,
    });

    // 3. exchange the signature for a session token.
    const verifyRes = await fetch(`${API_BASE_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature }),
    });
    if (!verifyRes.ok) return null;
    const { token } = (await verifyRes.json()) as {
      address: string;
      token: string;
    };
    if (!token) return null;

    writeSessionToken({ address, token });
    return token;
  } catch {
    // User rejected the sign prompt, network error, no wallet, etc.
    return null;
  }
}

/**
 * Return a cached token for `address`, or run the handshake to mint one.
 * Concurrent callers share a single in-flight handshake (one wallet popup).
 */
async function ensureToken(address: string): Promise<string | null> {
  const cached = readSessionToken(address);
  if (cached) return cached;

  if (inflight) return inflight;
  inflight = mintToken(address).finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Drop-in replacement for the legacy `useVegaAuth` hook from the upstream
 * scaffold. The original was Privy + ValueChain wallets; Vega auth is wagmi +
 * RainbowKit on ValueChain (EVM). The shape of the returned object matches
 * the original so call sites compile unchanged.
 *
 * The Solana-specific bits (`availableWallets`, `connectWallet`) are kept as
 * no-op stubs because RainbowKit drives its own picker UI.
 */
export function useVegaAuth() {
  const { address, isConnected, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const ready = status !== "reconnecting" && status !== "connecting";
  const authenticated = isConnected;
  const walletAddress = address ?? null;

  const availableWallets = useMemo<AvailableSolanaWallet[]>(() => [], []);

  const login = useCallback(
    (
      eventOrOptions?:
        | MouseEvent<HTMLElement>
        | { disableSignup?: boolean; walletClientType?: string },
    ) => {
      if (eventOrOptions && "preventDefault" in eventOrOptions) {
        eventOrOptions.preventDefault();
      }
      openConnectModal?.();
    },
    [openConnectModal],
  );

  const logout = useCallback(() => {
    // Drop any cached session token so the next connect re-signs a fresh
    // challenge rather than reusing a stale bearer.
    clearSessionToken();
    try {
      disconnect();
    } catch {
      /* noop */
    }
  }, [disconnect]);

  const connectWallet = useCallback(
    async (_options?: { disableSignup?: boolean; walletClientType?: string }) => {
      void _options;
      openConnectModal?.();
    },
    [openConnectModal],
  );

  const getAccessToken = useCallback(async () => {
    if (!walletAddress) return null;
    return ensureToken(walletAddress);
  }, [walletAddress]);

  const getAuthHeaders = useCallback(
    async (headersInit?: HeadersInit) => {
      const headers = new Headers(headersInit);
      if (walletAddress) {
        // Signed-challenge session token (HMAC-minted by the worker), NOT the
        // old spoofable `wagmi:<address>` plaintext. Degrades gracefully: if no
        // token can be minted (user rejected the sign, worker down, …) we send
        // the request without an Authorization header and the worker 401s.
        const token = await ensureToken(walletAddress);
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }
      }
      return headers;
    },
    [walletAddress],
  );

  return {
    ready,
    authenticated,
    login,
    logout,
    user: walletAddress ? { wallet: { address: walletAddress } } : null,
    walletAddress,
    availableWallets,
    connectWallet,
    getAccessToken,
    getAuthHeaders,
  };
}
