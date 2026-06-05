"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Play, Pause, Square, Wallet, Bot, AlertTriangle } from "lucide-react";

import type { BuilderGraphData } from "@/components/builder/builder-flow-utils";
import {
  StrategyRuntime,
  WalletInLoopStrategy,
  DryRunStrategy,
  type ExecutionLogEntry,
  type RuntimeState,
} from "@/lib/runtime";

const DEMO_MODE = (process.env.NEXT_PUBLIC_DEMO_MODE ?? "1") === "1";

const LEVEL_STYLE: Record<ExecutionLogEntry["level"], string> = {
  info: "text-slate-400",
  order: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-rose-400",
};

const STATE_STYLE: Record<RuntimeState, string> = {
  idle: "bg-slate-700 text-slate-200",
  running: "bg-emerald-600 text-white",
  paused: "bg-amber-600 text-white",
  stopped: "bg-slate-600 text-slate-100",
  error: "bg-rose-600 text-white",
};

export interface StrategyRuntimePanelProps {
  /** The builder graph to run. */
  graph: BuilderGraphData;
  /** Default market symbol to trade. */
  defaultSymbol?: string;
  /** Evaluation cadence (ms). */
  pollIntervalMs?: number;
}

/**
 * Option A (wallet-in-loop) runtime control: deploys the current builder graph
 * as a browser-resident agent that evaluates triggers against live SoDEX data
 * and places real testnet orders via the connected wallet. Under
 * NEXT_PUBLIC_DEMO_MODE it runs a dry-run strategy that signs/sends nothing.
 */
export function StrategyRuntimePanel({
  graph,
  defaultSymbol = "vMAG7ssi_vUSDC",
  pollIntervalMs = 15000,
}: StrategyRuntimePanelProps) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [state, setState] = useState<RuntimeState>("idle");
  const [log, setLog] = useState<ExecutionLogEntry[]>([]);
  const runtimeRef = useRef<StrategyRuntime | null>(null);

  const teardown = useCallback(() => {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const deploy = useCallback(() => {
    if (!DEMO_MODE && (!isConnected || !address)) {
      openConnectModal?.();
      return;
    }
    // Resume if paused.
    if (runtimeRef.current && state === "paused") {
      runtimeRef.current.start();
      return;
    }
    setLog([]);
    const strategy =
      DEMO_MODE || !address ? new DryRunStrategy() : new WalletInLoopStrategy(address);
    const runtime = new StrategyRuntime({
      graph,
      symbol,
      strategy,
      pollIntervalMs,
      onStateChange: setState,
      onLog: (entry) => setLog((prev) => [...prev.slice(-199), entry]),
    });
    runtimeRef.current = runtime;
    runtime.start();
  }, [address, isConnected, openConnectModal, graph, symbol, pollIntervalMs, state]);

  const pause = useCallback(() => runtimeRef.current?.pause(), []);
  const stop = useCallback(() => runtimeRef.current?.stop(), []);

  const running = state === "running";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-100">Live runtime (wallet-in-loop)</h3>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLE[state]}`}>
          {state}
        </span>
      </div>

      {DEMO_MODE && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Demo mode is on (<code>NEXT_PUBLIC_DEMO_MODE=1</code>). The runtime evaluates triggers
            and logs intents but places <strong>no real orders</strong>. Set it to <code>0</code> to
            sign live testnet orders.
          </span>
        </div>
      )}

      <div className="mb-4 flex items-end gap-3">
        <label className="flex-1 text-xs text-slate-400">
          Market symbol
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.trim())}
            disabled={running}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-600 disabled:opacity-50"
            placeholder="vMAG7ssi_vUSDC"
          />
        </label>
        <div className="flex gap-2">
          {!running ? (
            <button
              onClick={deploy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {!DEMO_MODE && !isConnected ? <Wallet className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {!DEMO_MODE && !isConnected ? "Connect" : state === "paused" ? "Resume" : "Deploy"}
            </button>
          ) : (
            <button
              onClick={pause}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          )}
          <button
            onClick={stop}
            disabled={state === "idle" || state === "stopped"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <Square className="h-4 w-4" />
            Stop
          </button>
        </div>
      </div>

      <div className="h-56 overflow-y-auto rounded-lg border border-slate-800 bg-black/40 p-3 font-mono text-xs">
        {log.length === 0 ? (
          <p className="text-slate-600">No events yet. Deploy to start evaluating triggers.</p>
        ) : (
          <ul className="space-y-1">
            {log.map((entry, i) => (
              <li key={i} className={LEVEL_STYLE[entry.level]}>
                <span className="text-slate-600">[{entry.level}]</span> {entry.message}
                {entry.data?.orderID ? (
                  <span className="text-emerald-500"> · order #{String(entry.data.orderID)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
