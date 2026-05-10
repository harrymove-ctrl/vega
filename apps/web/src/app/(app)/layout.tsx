import type { ReactNode } from "react";
import { Sidebar } from "@/components/app/sidebar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full">
      <Sidebar />
      <div className="flex min-h-dvh flex-1 flex-col">{children}</div>
    </div>
  );
}
