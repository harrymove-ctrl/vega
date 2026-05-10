"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { motion } from "framer-motion";
import { Search } from "lucide-react";

export function Topbar({ title }: { title: string }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="sticky top-0 z-30 flex items-center gap-4 border-b border-default bg-app/80 px-6 py-3 backdrop-blur-xl md:px-10"
    >
      <h1 className="text-base font-medium tracking-tight">{title}</h1>
      <div className="ml-4 hidden flex-1 max-w-md md:flex">
        <div className="flex w-full items-center gap-2 rounded-md border border-default bg-input-deep/40 px-3 py-1.5 text-sm text-muted-foreground">
          <Search className="size-4" />
          <input
            placeholder="Search markets, agents, news…"
            className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-default px-1.5 py-0.5 text-[10px] font-mono">
            ⌘K
          </kbd>
        </div>
      </div>
      <div className="ml-auto">
        <ConnectButton accountStatus="address" chainStatus="icon" />
      </div>
    </motion.header>
  );
}
