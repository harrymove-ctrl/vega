import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function AgentsPage() {
  return (
    <>
      <Topbar title="Agents" />
      <PageShell
        title="Your Agents"
        subtitle="Deployed strategy agents executing on SoDEX with delegated authorization."
      >
        <ComingSoon
          features={[
            {
              title: "Agent fleet",
              body: "Status, health score, last heartbeat, kill switch and pause / resume controls.",
            },
            {
              title: "Execution log",
              body: "Per-agent action timeline with input signals, decisions and SoDEX order receipts.",
            },
            {
              title: "Risk envelope",
              body: "Position caps, max drawdown, allowed assets — enforced before any on-chain call.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
