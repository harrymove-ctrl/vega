import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { BuilderCanvas } from "@/components/builder/builder-canvas";

export default function BuilderPage() {
  return (
    <>
      <Topbar title="Builder" />
      <PageShell
        title="Visual Strategy Builder"
        subtitle="Compose Signal-to-Execution agents on a graph: trigger → filter → action."
      >
        <BuilderCanvas />
      </PageShell>
    </>
  );
}
