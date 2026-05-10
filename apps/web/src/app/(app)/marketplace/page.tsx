import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function MarketplacePage() {
  return (
    <>
      <Topbar title="Marketplace" />
      <PageShell
        title="Creator Marketplace"
        subtitle="Discover, subscribe to, and clone agents built by other one-person funds."
      >
        <ComingSoon
          features={[
            {
              title: "Featured shelves",
              body: "Curated agent collections by theme: ETF rotation, news arbitrage, index rebalance.",
            },
            {
              title: "Creator profile",
              body: "Track record, stat history, social proof — backed by on-chain trade attestations.",
            },
            {
              title: "Subscribe / clone",
              body: "Mirror live trades or fork the strategy graph into your own editable draft.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
