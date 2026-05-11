"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Activity, TrendingUp, TrendingDown } from "lucide-react";
import { fetchTickers, isTestnet, type SoDEXTicker } from "@/lib/sodex-public";

function formatPx(s: string) {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 10000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function prettySymbol(s: string) {
  // vMAG7ssi_vUSDC → MAG7 / USDC
  return s.replace(/^v/, "").replace(/ssi/, "").replace("_v", " / ").replace("_", " / ");
}

const FEATURED_ORDER = [
  "vMAG7ssi_vUSDC",
  "TESTBTC_vUSDC",
  "vTSLA_vUSDC",
  "vBNB_vUSDC",
];

export function LiveSoDEXMarkets({ limit = 5 }: { limit?: number }) {
  const [rows, setRows] = useState<SoDEXTicker[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    fetchTickers()
      .then((res) => {
        if (aborted) return;
        if (res.code !== 0 || !Array.isArray(res.data)) {
          setError("upstream error");
          return;
        }
        const byName = new Map(res.data.map((t) => [t.symbol, t]));
        const featured = FEATURED_ORDER.flatMap((s) =>
          byName.has(s) ? [byName.get(s)!] : [],
        );
        const others = res.data
          .filter((t) => !FEATURED_ORDER.includes(t.symbol))
          .slice(0, Math.max(0, limit - featured.length));
        setRows([...featured, ...others].slice(0, limit));
      })
      .catch((err) => !aborted && setError(err instanceof Error ? err.message : "fetch failed"));
    return () => {
      aborted = true;
    };
  }, [limit]);

  return (
    <section className="rounded-3xl border border-white/8 bg-card-deep/60 p-5 backdrop-blur-md sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-[#dce85d]" />
          <h3 className="text-base font-medium tracking-tight text-neutral-50">
            SoDEX live markets
          </h3>
          <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-neutral-400">
            {isTestnet() ? "testnet" : "mainnet"}
          </span>
        </div>
        <a
          href="https://sodex.com/documentation/api/api"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#dce85d] hover:underline"
        >
          SoDEX API ↗
        </a>
      </header>

      {error && (
        <div className="rounded-md border border-[#e06c6e]/30 bg-[#e06c6e]/10 px-3 py-2 text-xs text-[#e06c6e]">
          {error}
        </div>
      )}

      {!rows && !error && (
        <ul className="space-y-2">
          {Array.from({ length: limit }).map((_, i) => (
            <li key={i} className="h-10 animate-pulse rounded-md bg-white/5" />
          ))}
        </ul>
      )}

      {rows && (
        <ul className="divide-y divide-white/5">
          {rows.map((t, i) => {
            const up = t.changePct >= 0;
            return (
              <motion.li
                key={t.symbol}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.25 }}
                className="grid grid-cols-[1.4fr_1fr_0.9fr] items-center gap-3 py-2.5 first:pt-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-neutral-50">
                    {prettySymbol(t.symbol)}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    Vol {Number(t.quoteVolume).toLocaleString("en-US", { maximumFractionDigits: 0 })} USDC
                  </div>
                </div>
                <div className="text-right font-mono text-sm tabular-nums text-neutral-100">
                  ${formatPx(t.lastPx)}
                </div>
                <div
                  className={`flex items-center justify-end gap-1 font-mono text-xs tabular-nums ${
                    up ? "text-[#74b97f]" : "text-[#e06c6e]"
                  }`}
                >
                  {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                  {(up ? "+" : "") + t.changePct.toFixed(2)}%
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-neutral-500">
        SoDEX trades natively on <span className="text-neutral-300">ValueChain</span> (EVM L1,
        chainId 286623). Vega orders are signed client-side via EIP712 typed
        signatures using your connected wallet — no custody.
      </p>
    </section>
  );
}
