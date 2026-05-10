import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain, type Chain } from "viem";
import { mainnet, base, arbitrum, optimism, polygon } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// SoDEX runs on ValueChain (EVM-compatible L1, native gas = $SOSO).
// RPC / chainId / explorer come from env so we never hardcode unverified
// network details. Fill from the official ValueChain docs.
function maybeValueChain(opts: {
  id: number;
  name: string;
  rpc: string | undefined;
  explorer: string | undefined;
  testnet?: boolean;
}): Chain | null {
  if (!opts.rpc || !opts.id) return null;
  return defineChain({
    id: opts.id,
    name: opts.name,
    nativeCurrency: { name: "SoSoValue", symbol: "SOSO", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpc] } },
    blockExplorers: opts.explorer
      ? { default: { name: "Explorer", url: opts.explorer } }
      : undefined,
    testnet: opts.testnet,
  });
}

const valueChain = maybeValueChain({
  id: Number(process.env.NEXT_PUBLIC_VALUECHAIN_ID ?? 0),
  name: "ValueChain",
  rpc: process.env.NEXT_PUBLIC_VALUECHAIN_RPC,
  explorer: process.env.NEXT_PUBLIC_VALUECHAIN_EXPLORER,
});

const valueChainTestnet = maybeValueChain({
  id: Number(process.env.NEXT_PUBLIC_VALUECHAIN_TESTNET_ID ?? 0),
  name: "ValueChain Testnet",
  rpc: process.env.NEXT_PUBLIC_VALUECHAIN_TESTNET_RPC,
  explorer: process.env.NEXT_PUBLIC_VALUECHAIN_TESTNET_EXPLORER,
  testnet: true,
});

const chains = [
  ...(valueChain ? [valueChain] : []),
  ...(valueChainTestnet ? [valueChainTestnet] : []),
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
] as const;

export const wagmiConfig = getDefaultConfig({
  appName: "Sosodex",
  projectId,
  chains: chains as unknown as readonly [Chain, ...Chain[]],
  ssr: true,
});
