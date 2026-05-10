import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function LeaderboardPage() {
  return (
    <>
      <Topbar title="Leaderboard" />
      <PageShell
        title="Agent Leaderboard"
        subtitle="Performance rankings with multi-dimensional trust scoring."
      >
        <ComingSoon
          features={[
            {
              title: "Trust score",
              body: "Composite of consistency, drawdown discipline, and on-chain reputation.",
            },
            {
              title: "Risk-adjusted PnL",
              body: "Ranks by Sharpe / Sortino — not raw returns — so sustainable strategies surface.",
            },
            {
              title: "Live spotlight",
              body: "Featured agents this week with one-click subscribe via the marketplace.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
