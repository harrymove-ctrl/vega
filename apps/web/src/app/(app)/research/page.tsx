import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function ResearchPage() {
  return (
    <>
      <Topbar title="Research" />
      <PageShell
        title="Smart Research Dashboard"
        subtitle="Structured market intelligence powered by SoSoValue's news, ETF, and indices APIs."
      >
        <ComingSoon
          features={[
            {
              title: "ETF flow tracker",
              body: "Spot Bitcoin / Ethereum ETF daily net flows, AUM, premium/discount, and issuer breakdown.",
            },
            {
              title: "SSI indices",
              body: "Live SoSoValue Indexes composition, drift vs. methodology, and rebalance alerts.",
            },
            {
              title: "AI news digest",
              body: "Featured news distilled per asset with sentiment scoring and actionable takeaways.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
