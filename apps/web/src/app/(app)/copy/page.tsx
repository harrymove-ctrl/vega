import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function CopyPage() {
  return (
    <>
      <Topbar title="Copy Trading" />
      <PageShell
        title="Copy Trading Support Tool"
        subtitle="Mirror or clone top-performing agents with risk caps and confirmation gates."
      >
        <ComingSoon
          features={[
            {
              title: "Live mirror",
              body: "Replicate trades in real-time with proportional sizing relative to your capital.",
            },
            {
              title: "Clone-and-fork",
              body: "Snapshot a strategy graph and tune it before deploying — no blind copying.",
            },
            {
              title: "Confirmation gates",
              body: "Optional manual approve for trades above $X — security awareness baked in.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
