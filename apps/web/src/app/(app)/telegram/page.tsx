import { Topbar } from "@/components/app/topbar";
import { PageShell } from "@/components/app/page-shell";
import { ComingSoon } from "@/components/app/coming-soon";

export default function TelegramPage() {
  return (
    <>
      <Topbar title="Telegram" />
      <PageShell
        title="Telegram bot"
        subtitle="Mobile monitoring and approval for your agents — alerts, daily digests, kill-switch."
      >
        <ComingSoon
          features={[
            {
              title: "Link account",
              body: "Pair a Telegram username via /start so notifications route to the right user.",
            },
            {
              title: "Real-time alerts",
              body: "Trade fills, agent halts, signal triggers — pushed within seconds.",
            },
            {
              title: "Approve from chat",
              body: "Inline buttons to approve or veto a pending trade above your confirmation threshold.",
            },
          ]}
        />
      </PageShell>
    </>
  );
}
