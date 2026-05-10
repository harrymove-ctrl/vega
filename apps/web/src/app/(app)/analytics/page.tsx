import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function AnalyticsPage() {
  return (
    <>
      <Topbar title="Analytics" />
      <PageShell
        title="Analytics"
        subtitle="Deep performance breakdown across agents, strategies, and assets."
      >
        <ComingSoon
          features={[
            {
              title: "Attribution",
              body: "Decompose PnL by signal source, asset, and timeframe.",
            },
            {
              title: "Heatmap",
              body: "Returns by time-of-day / day-of-week to spot regime patterns.",
            },
            {
              title: "Cost ledger",
              body: "Slippage, fees, gas — full accounting for every SoDEX execution.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
