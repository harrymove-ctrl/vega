import { AppShell } from "@/components/app/app-shell";
import { AppErrorBoundary } from "@/components/app/error-boundary";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppShell>
      <AppErrorBoundary>{children}</AppErrorBoundary>
    </AppShell>
  );
}
