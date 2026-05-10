import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { defineChain, type Chain } from "viem";
import { mainnet, base, arbitrum, optimism, polygon } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// SoDEX runs on ValueChain (EVM-compatible L1, native gas = $SOSO).
// Chain values come from env so we never hardcode unverified RPC details.
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
const typedChains = chains as unknown as readonly [Chain, ...Chain[]];

const isValidProjectId =
  typeof projectId === "string" &&
  projectId.length === 32 &&
  /^[0-9a-f]+$/i.test(projectId) &&
  projectId !== "0".repeat(32);

// Effective WalletConnect projectId. RainbowKit needs a non-empty string at
// boot, but actual WalletConnect won't function without a real one — so we
// only include the WalletConnect wallet entry when the projectId is real.
const effectiveProjectId = isValidProjectId ? projectId! : "DEV_NO_WC";

const recommendedWallets = [
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  rainbowWallet,
];

const moreWallets = [injectedWallet];

if (isValidProjectId) {
  // Only expose WalletConnect when we have a real projectId.
  recommendedWallets.push(walletConnectWallet);
}

const connectors = connectorsForWallets(
  [
    {
      groupName: "EVM wallets (Vega runs on ValueChain — EVM L1)",
      wallets: recommendedWallets,
    },
    {
      groupName: "Other",
      wallets: moreWallets,
    },
  ],
  { appName: "Vega", projectId: effectiveProjectId },
);

export const wagmiConfig = isValidProjectId
  ? // With a real projectId, getDefaultConfig handles WalletConnect transports
    // for us. We still apply connectorsForWallets via spreading custom config.
    getDefaultConfig({
      appName: "Vega",
      projectId: effectiveProjectId,
      chains: typedChains,
      ssr: true,
      wallets: [
        {
          groupName: "EVM wallets (Vega runs on ValueChain — EVM L1)",
          wallets: recommendedWallets,
        },
        { groupName: "Other", wallets: moreWallets },
      ],
    })
  : createConfig({
      chains: typedChains,
      ssr: true,
      connectors,
      transports: Object.fromEntries(
        typedChains.map((c) => [c.id, http()]),
      ) as Record<number, ReturnType<typeof http>>,
    });
