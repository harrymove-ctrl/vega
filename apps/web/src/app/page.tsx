"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Bot, Workflow, Newspaper } from "lucide-react";

const FEATURES = [
  {
    icon: Newspaper,
    title: "Smart Research Dashboard",
    body: "ETF flows, SSI indices, AI-distilled news — every signal SoSoValue surfaces, organized for action.",
  },
  {
    icon: Sparkles,
    title: "AI Copilot",
    body: "Ask questions in natural language; get back signals, charts, and ready-to-deploy strategy graphs.",
  },
  {
    icon: Workflow,
    title: "Visual Strategy Builder",
    body: "Drag-and-drop trigger → filter → action. Backtest before you deploy on SoDEX.",
  },
  {
    icon: Bot,
    title: "Autonomous Agents",
    body: "Delegated execution, risk envelopes, and a kill switch — your fund, on autopilot.",
  },
];

export default function Landing() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(700px 500px at 80% -10%, rgba(220,232,93,0.18), transparent 60%), radial-gradient(700px 500px at 0% 110%, rgba(96,165,250,0.18), transparent 60%)",
        }}
      />

      <header className="shell flex items-center justify-between !pt-8 !pb-0">
        <div className="flex items-center gap-2 font-mono">
          <span className="size-2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)] animate-pulse-glow" />
          sosodex
        </div>
        <Link
          href="/dashboard"
          className="rounded-md border border-default px-3 py-1.5 text-sm hover:bg-card-hover"
        >
          Open app
        </Link>
      </header>

      <section className="shell pt-20 md:pt-28">
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-4xl text-4xl font-semibold tracking-tight md:text-6xl"
        >
          Run a one-person on-chain finance business.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: "easeOut" }}
          className="mt-6 max-w-2xl text-lg text-muted-foreground"
        >
          Sosodex turns SoSoValue&apos;s research, indices, and on-chain orderbook
          into an agentic platform. Be your own news agency, index publisher, and
          fund manager — solo.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
          className="mt-8 flex gap-3"
        >
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground shadow-[0_0_30px_rgba(220,232,93,0.25)] transition hover:shadow-[0_0_40px_rgba(220,232,93,0.45)]"
          >
            Launch dashboard
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://sosovalue-1.gitbook.io/sosovalue-api-doc"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-default px-4 py-2.5 text-sm hover:bg-card-hover"
          >
            SoSoValue API docs
          </a>
        </motion.div>
      </section>

      <section className="shell pt-20 md:pt-28">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <motion.article
              key={title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.06, duration: 0.4, ease: "easeOut" }}
              className="glass-card gradient-border rounded-xl p-5"
            >
              <Icon className="size-5 text-accent" />
              <h3 className="mt-3 text-base font-medium">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <footer className="shell mt-24 border-t border-default !pt-6 text-xs text-muted-foreground">
        Built for the SoSoValue × Akindo Buildathon. Powered by SoSoValue,
        SoDEX, and ValueChain.
      </footer>
    </main>
  );
}
