import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function BacktestsPage() {
  return (
    <>
      <Topbar title="Backtests" />
      <PageShell
        title="Backtesting Lab"
        subtitle="Replay your strategies against SoSoValue historical market and ETF data."
      >
        <ComingSoon
          features={[
            {
              title: "Equity curve",
              body: "Lightweight-charts equity, drawdown, and trade markers — same library SoSoValue uses.",
            },
            {
              title: "Indicator pre-compute",
              body: "RSI / EMA / inflow-rate caches so multi-symbol sweeps run in seconds, not minutes.",
            },
            {
              title: "Stat sheet",
              body: "Sharpe, Sortino, max DD, win-rate, expectancy, exposure — exportable as CSV.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
