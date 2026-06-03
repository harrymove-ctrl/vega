"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { TrendingUp, BarChart3 } from "lucide-react";

import { fetchKlines, fetchTickers, isTestnet, type SoDEXCandle } from "@/lib/sodex-public";

const COLOR_UP = "#74b97f";
const COLOR_DOWN = "#e06c6e";
const COLOR_VOLUME = "rgba(220,232,93,0.35)";

function asUtc(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function candleToBar(c: SoDEXCandle) {
  return {
    time: asUtc(c.t),
    open: Number(c.o),
    high: Number(c.h),
    low: Number(c.l),
    close: Number(c.c),
  };
}

function candleToVolume(c: SoDEXCandle) {
  const isUp = Number(c.c) >= Number(c.o);
  return {
    time: asUtc(c.t),
    value: Number(c.v),
    color: isUp ? "rgba(116,185,127,0.35)" : "rgba(224,108,110,0.35)",
  };
}

export function MarketChart({
  symbol = "vBTC_vUSDC",
  interval = "1h",
  limit = 200,
  height = 360,
}: {
  symbol?: string;
  interval?: string;
  limit?: number;
  height?: number;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tickerSummary, setTickerSummary] = useState<{
    last: string;
    changePct: number;
    volume: string;
  } | null>(null);

  useEffect(() => {
    let aborted = false;

    async function load() {
      try {
        const [klinesRes, tickersRes] = await Promise.all([
          fetchKlines(symbol, { interval, limit }),
          fetchTickers(),
        ]);
        if (aborted) return;
        if (klinesRes.code !== 0 || !Array.isArray(klinesRes.data)) {
          setError("klines upstream error");
          return;
        }
        // SoDEX returns newest-first; lightweight-charts requires ascending time.
        const bars = [...klinesRes.data]
          .filter((c) => Number.isFinite(Number(c.o)))
          .sort((a, b) => a.t - b.t);

        const node = container.current;
        if (!node) return;
        node.innerHTML = "";
        const chart = createChart(node, {
          autoSize: true,
          layout: {
            background: { color: "transparent" },
            textColor: "#a1a1aa",
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.05)" },
            horzLines: { color: "rgba(255,255,255,0.05)" },
          },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
          timeScale: {
            borderColor: "rgba(255,255,255,0.1)",
            timeVisible: true,
            secondsVisible: false,
          },
          crosshair: {
            vertLine: { color: "rgba(220,232,93,0.2)" },
            horzLine: { color: "rgba(220,232,93,0.2)" },
          },
        });
        chartRef.current = chart;

        const candles = chart.addSeries(CandlestickSeries, {
          upColor: COLOR_UP,
          downColor: COLOR_DOWN,
          borderUpColor: COLOR_UP,
          borderDownColor: COLOR_DOWN,
          wickUpColor: COLOR_UP,
          wickDownColor: COLOR_DOWN,
        });
        candles.setData(bars.map(candleToBar));

        const volume = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: COLOR_VOLUME,
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
        volume.setData(bars.map(candleToVolume));

        chart.timeScale().fitContent();
        const ro = new ResizeObserver(() => chart.timeScale().fitContent());
        ro.observe(node);

        if (tickersRes.code === 0 && Array.isArray(tickersRes.data)) {
          const t = tickersRes.data.find((x) => x.symbol === symbol);
          if (t) {
            setTickerSummary({
              last: t.lastPx,
              changePct: t.changePct,
              volume: t.quoteVolume,
            });
          }
        }

        return () => {
          ro.disconnect();
          chart.remove();
          chartRef.current = null;
        };
      } catch (err) {
        if (!aborted) setError(err instanceof Error ? err.message : "fetch failed");
      }
    }

    const cleanup = load();
    return () => {
      aborted = true;
      cleanup.then?.((fn) => fn?.());
    };
  }, [symbol, interval, limit]);

  const up = (tickerSummary?.changePct ?? 0) >= 0;

  return (
    <section className="rounded-3xl border border-white/8 bg-card-deep/60 p-5 backdrop-blur-md sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="size-4 text-[#dce85d]" />
          <h3 className="text-base font-medium tracking-tight text-neutral-50">
            {symbol.replace(/^v/, "").replace("_v", " / ").replace("_", " / ")} · {interval}
          </h3>
          <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-neutral-400">
            {isTestnet() ? "testnet" : "mainnet"}
          </span>
        </div>
        {tickerSummary && (
          <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-neutral-300">
            <span className="text-neutral-50">${Number(tickerSummary.last).toLocaleString()}</span>
            <span className={up ? "text-[#74b97f]" : "text-[#e06c6e]"}>
              {(up ? "+" : "") + tickerSummary.changePct.toFixed(2)}%
            </span>
            <span className="hidden sm:inline text-[10px] text-neutral-500">
              <TrendingUp className="inline size-3 -mt-0.5" /> Vol{" "}
              {Number(tickerSummary.volume).toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className="mb-3 rounded-md border border-[#e06c6e]/30 bg-[#e06c6e]/10 px-3 py-2 text-xs text-[#e06c6e]">
          {error}
        </div>
      )}

      <div ref={container} style={{ width: "100%", height }} />
    </section>
  );
}
