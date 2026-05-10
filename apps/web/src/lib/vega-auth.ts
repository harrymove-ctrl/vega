"use client";

import { useCallback, useMemo, type MouseEvent } from "react";

import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

export type AvailableSolanaWallet = {
  id: string;
  label: string;
};

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
    return walletAddress ? `wagmi:${walletAddress}` : null;
  }, [walletAddress]);

  const getAuthHeaders = useCallback(
    async (headersInit?: HeadersInit) => {
      const headers = new Headers(headersInit);
      if (walletAddress) {
        headers.set("Authorization", `Bearer wagmi:${walletAddress}`);
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

