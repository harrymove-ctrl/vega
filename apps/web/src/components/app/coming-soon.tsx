"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function ComingSoon({
  features,
}: {
  features: { title: string; body: string }[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {features.map((f, i) => (
        <motion.article
          key={f.title}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.3, ease: "easeOut" }}
          className="glass-card gradient-border relative overflow-hidden rounded-xl p-5"
        >
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-accent">
            <Sparkles className="size-3.5" />
            roadmap
          </div>
          <h3 className="mt-3 text-base font-medium">{f.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {f.body}
          </p>
        </motion.article>
      ))}
    </div>
  );
}
