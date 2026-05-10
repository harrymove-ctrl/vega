"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Wallet connect button. Wraps RainbowKit's ConnectButton.Custom so we can
 * keep the original Vega (formerly Vega) lime-on-dark styling instead
 * of RainbowKit's default chrome.
 */
export function PrivyAuthButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        if (!ready) {
          return (
            <div
              aria-hidden="true"
              className="text-xs uppercase tracking-[0.16em] text-neutral-500"
            >
              Checking wallet
            </div>
          );
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="rounded-full border border-[rgba(255,255,255,0.12)] px-4 py-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-neutral-400 transition-all duration-200 hover:border-[#dce85d] hover:text-[#dce85d]"
            >
              Connect wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="rounded-full border border-[rgba(255,255,255,0.12)] px-4 py-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[#e06c6e] transition-all duration-200 hover:border-[#e06c6e]"
            >
              Wrong network
            </button>
          );
        }

        return (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <button
              type="button"
              onClick={openAccountModal}
              className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#090a0a] px-3 py-2 text-sm font-medium text-neutral-50 transition hover:border-[#dce85d]"
            >
              {account.displayName}
            </button>
            <button
              type="button"
              onClick={openChainModal}
              className="rounded-full border border-[rgba(255,255,255,0.06)] px-4 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-neutral-400 transition hover:border-[#dce85d] hover:text-[#dce85d]"
            >
              {chain.name ?? "Network"}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
