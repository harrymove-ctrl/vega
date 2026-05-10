"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Sparkles,
  Workflow,
  Bot,
  TestTube2,
  Trophy,
  Store,
  Copy,
  MessageCircle,
  BarChart3,
  Newspaper,
} from "lucide-react";

const NAV: { href: string; label: string; icon: typeof Bot }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/research", label: "Research", icon: Newspaper },
  { href: "/copilot", label: "Copilot", icon: Sparkles },
  { href: "/builder", label: "Builder", icon: Workflow },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/backtests", label: "Backtests", icon: TestTube2 },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/copy", label: "Copy", icon: Copy },
  { href: "/telegram", label: "Telegram", icon: MessageCircle },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden h-dvh w-60 shrink-0 border-r border-default bg-sidebar p-4 md:flex md:flex-col md:gap-6">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 px-2 py-1 font-mono text-base tracking-tight"
      >
        <span className="size-2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)] animate-pulse-glow" />
        sosodex
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className="group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-card-hover hover:text-foreground"
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-md border border-default bg-card-soft"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Icon className="relative size-4 shrink-0" />
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-lg border border-default bg-card-soft/60 p-3 text-xs text-muted-foreground">
        Buildathon: SoSoValue × Akindo
      </div>
    </aside>
  );
}
