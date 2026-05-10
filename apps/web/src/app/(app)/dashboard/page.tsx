import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function DashboardPage() {
  return (
    <>
      <Topbar title="Dashboard" />
      <PageShell
        title="Welcome to your sosodex"
        subtitle="One-person on-chain finance — research, agents, and execution in one place."
      >
        <ComingSoon
          features={[
            {
              title: "Net worth + PnL",
              body: "Live PnL across SoDEX positions and tracked wallets, sourced via SoSoValue + on-chain reads.",
            },
            {
              title: "Active agents",
              body: "At-a-glance health of your deployed strategy agents with last-action timestamps.",
            },
            {
              title: "Today's signals",
              body: "Curated feed: ETF inflows, SSI index drift, news sentiment shifts, and SoDEX orderbook anomalies.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
