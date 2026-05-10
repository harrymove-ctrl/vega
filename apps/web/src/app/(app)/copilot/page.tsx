import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function CopilotPage() {
  return (
    <>
      <Topbar title="Copilot" />
      <PageShell
        title="AI Copilot"
        subtitle="Strategy Assistant Bot — ask questions, get signals, design agents from natural language."
      >
        <ComingSoon
          features={[
            {
              title: "Tool-calling chat",
              body: "Anthropic / OpenAI agents with function calls into SoSoValue and SoDEX APIs.",
            },
            {
              title: "Strategy generation",
              body: "Describe your thesis in plain English; receive a graph-based strategy ready to backtest.",
            },
            {
              title: "Conversation memory",
              body: "Persistent threads with citation back to source data and the agent's tool-call traces.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
