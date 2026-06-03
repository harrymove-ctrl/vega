"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Wallet, X, RefreshCw, CheckCircle2, AlertTriangle, Loader2, ListTree } from "lucide-react";

import {
  fetchAccountState,
  fetchAccountOpenOrders,
  fetchAccountOrderHistory,
  fetchSymbols,
  type SoDEXOrder,
  type SoDEXSymbol,
} from "@/lib/sodex-public";
import { cancelBatchOrder, SoDEXTradeError } from "@/lib/sodex-trade";

const REFRESH_MS = 8000;

function prettySymbol(s: string) {
  return s.replace(/^v/, "").replace(/ssi/, "").replace("_v", " / ").replace("_", " / ");
}

function relativeTime(ms: number) {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

type CancelState =
  | { kind: "idle" }
  | { kind: "signing"; orderID: number }
  | { kind: "error"; orderID: number; message: string }
  | { kind: "done"; orderID: number };

export function MyOrdersPanel() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const qc = useQueryClient();
  const [cancelState, setCancelState] = useState<CancelState>({ kind: "idle" });

  const stateQ = useQuery({
    queryKey: ["accountState", address],
    enabled: !!address,
    queryFn: () => fetchAccountState(address!),
    refetchInterval: REFRESH_MS,
  });
  const openQ = useQuery({
    queryKey: ["openOrders", address],
    enabled: !!address,
    queryFn: () => fetchAccountOpenOrders(address!),
    refetchInterval: REFRESH_MS,
  });
  const histQ = useQuery({
    queryKey: ["orderHistory", address],
    enabled: !!address,
    queryFn: () => fetchAccountOrderHistory(address!, { limit: 10 }),
    refetchInterval: REFRESH_MS * 4,
  });
  const symbolsQ = useQuery({
    queryKey: ["symbols"],
    queryFn: () => fetchSymbols(),
    staleTime: 5 * 60_000,
  });

  const accountID = stateQ.data?.data?.aid;
  const usdc = stateQ.data?.data?.B?.find((b) => b.a === "vUSDC");
  const openOrders: SoDEXOrder[] = (openQ.data?.data?.orders ?? []) as SoDEXOrder[];
  const history: SoDEXOrder[] = (histQ.data?.data ?? []) as SoDEXOrder[];

  const symbolsByName = new Map<string, SoDEXSymbol>(
    (symbolsQ.data?.data ?? []).map((s) => [s.name, s]),
  );

  async function handleCancel(order: SoDEXOrder) {
    if (!accountID) return;
    const sym = symbolsByName.get(order.symbol);
    if (!sym) {
      setCancelState({
        kind: "error",
        orderID: Number(order.orderID),
        message: `symbol ${order.symbol} not in cache`,
      });
      return;
    }
    setCancelState({ kind: "signing", orderID: Number(order.orderID) });
    try {
      await cancelBatchOrder({
        accountID,
        cancels: [
          {
            symbolID: sym.id,
            clOrdID: `vega-cancel-${Date.now()}`,
            orderID: Number(order.orderID),
          },
        ],
      });
      setCancelState({ kind: "done", orderID: Number(order.orderID) });
      // Trigger immediate refetch of related queries.
      qc.invalidateQueries({ queryKey: ["openOrders", address] });
      qc.invalidateQueries({ queryKey: ["orderHistory", address] });
      qc.invalidateQueries({ queryKey: ["accountState", address] });
    } catch (err) {
      setCancelState({
        kind: "error",
        orderID: Number(order.orderID),
        message: err instanceof SoDEXTradeError
          ? `${err.message} (code ${err.code ?? "?"})`
          : err instanceof Error ? err.message : String(err),
      });
    }
  }

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["openOrders", address] });
    qc.invalidateQueries({ queryKey: ["orderHistory", address] });
    qc.invalidateQueries({ queryKey: ["accountState", address] });
  }

  return (
    <section className="rounded-3xl border border-white/8 bg-card-deep/60 p-5 backdrop-blur-md sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListTree className="size-4 text-[#dce85d]" />
          <h3 className="text-base font-medium tracking-tight text-neutral-50">My SoDEX orders</h3>
          {accountID && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-neutral-300">
              acct #{accountID}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          {usdc && (
            <span className="font-mono tabular-nums">
              <span className="text-neutral-500">vUSDC </span>
              <span className="text-neutral-100">{usdc.t}</span>
              {Number(usdc.l) > 0 && (
                <span className="text-neutral-500"> (locked {usdc.l})</span>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={refetchAll}
            className="rounded-md border border-white/10 bg-white/5 p-1.5 text-neutral-300 hover:bg-white/10"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </header>

      {!isConnected && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-400">
            Connect a wallet to see your open and historical orders on SoDEX testnet.
          </p>
          <button
            type="button"
            onClick={() => openConnectModal?.()}
            className="inline-flex items-center gap-2 rounded-full bg-[#dce85d] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#090a0a] transition hover:bg-[#e4ef6e]"
          >
            <Wallet className="size-3.5" /> Connect wallet
          </button>
        </div>
      )}

      {isConnected && (
        <>
          {/* Open orders */}
          <div className="mb-5">
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-500">
              Open · {openQ.isLoading ? "…" : openOrders.length}
            </h4>
            {openQ.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Loader2 className="size-3 animate-spin" /> loading…
              </div>
            ) : openOrders.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/8 px-3 py-3 text-center text-xs text-neutral-500">
                No resting orders. Use the smoke-test panel above to place one.
              </div>
            ) : (
              <ul className="divide-y divide-white/5 overflow-hidden rounded-md border border-white/8">
                <AnimatePresence initial={false}>
                  {openOrders.map((o) => {
                    const oid = Number(o.orderID);
                    const isCanceling = cancelState.kind === "signing" && cancelState.orderID === oid;
                    const cancelErr = cancelState.kind === "error" && cancelState.orderID === oid ? cancelState.message : null;
                    return (
                      <motion.li
                        key={oid}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="grid grid-cols-[1.2fr_0.7fr_0.9fr_1fr_auto] items-center gap-3 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-neutral-50">
                            {prettySymbol(o.symbol)}
                          </div>
                          <div className="truncate text-[10px] text-neutral-500">{o.clOrdID}</div>
                        </div>
                        <div
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            o.side === "BUY" ? "text-[#74b97f]" : "text-[#e06c6e]"
                          }`}
                        >
                          {o.side} · {o.type}
                        </div>
                        <div className="text-right font-mono tabular-nums text-neutral-100">
                          @{Number(o.price).toLocaleString()}
                          <div className="text-[10px] text-neutral-500">qty {o.origQty}</div>
                        </div>
                        <div className="text-right text-[10px] text-neutral-500">
                          <div className="text-neutral-400">{o.status}</div>
                          <div>{relativeTime(o.createdAt)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCancel(o)}
                          disabled={isCanceling}
                          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                          title="Sign + DELETE"
                        >
                          {isCanceling ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <X className="size-3" />
                          )}
                          {isCanceling ? "signing…" : "Cancel"}
                        </button>
                        {cancelErr && (
                          <div className="col-span-5 -mt-1 flex items-start gap-1 rounded-sm bg-[#e06c6e]/10 px-2 py-1 text-[10px] text-[#e06c6e]">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                            <span className="break-all font-mono">{cancelErr}</span>
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
            {cancelState.kind === "done" && (
              <div className="mt-2 flex items-center gap-1 rounded-md bg-[#74b97f]/10 px-3 py-1.5 text-[11px] text-[#9ee0a8]">
                <CheckCircle2 className="size-3" /> Cancel for order {cancelState.orderID} accepted.
              </div>
            )}
          </div>

          {/* History */}
          <div>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-500">
              History · last {history.length}
            </h4>
            {histQ.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Loader2 className="size-3 animate-spin" /> loading…
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/8 px-3 py-3 text-center text-xs text-neutral-500">
                No past orders yet.
              </div>
            ) : (
              <ul className="divide-y divide-white/5 overflow-hidden rounded-md border border-white/8 text-xs">
                {history.slice(0, 10).map((o) => (
                  <li
                    key={o.orderID}
                    className="grid grid-cols-[1.2fr_0.7fr_0.9fr_1fr] items-center gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm text-neutral-300">
                        {prettySymbol(o.symbol)}
                      </div>
                      <div className="truncate font-mono text-[10px] text-neutral-500">{o.clOrdID}</div>
                    </div>
                    <div
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        o.side === "BUY" ? "text-[#74b97f]" : "text-[#e06c6e]"
                      }`}
                    >
                      {o.side} · {o.type}
                    </div>
                    <div className="text-right font-mono tabular-nums text-neutral-200">
                      @{Number(o.price).toLocaleString()}
                      <div className="text-[10px] text-neutral-500">qty {o.origQty}</div>
                    </div>
                    <div className="text-right text-[10px]">
                      <div
                        className={
                          o.status === "FILLED"
                            ? "text-[#9ee0a8]"
                            : o.status === "CANCELED"
                              ? "text-neutral-500"
                              : "text-neutral-400"
                        }
                      >
                        {o.status}
                      </div>
                      <div className="text-neutral-500">{relativeTime(o.updatedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
