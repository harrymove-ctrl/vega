"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, Play, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import { useTransition } from "@/components/providers/transition-provider";
import BlurHighlight from "@/components/react-bits/blur-highlight";

// WebGL components — defer to client only.
const AuroraBlur = dynamic(() => import("@/components/react-bits/aurora-blur"), {
  ssr: false,
});
const AgenticBall = dynamic(() => import("@/components/react-bits/agentic-ball"), {
  ssr: false,
});

export function Hero1() {
  const router = useRouter();
  const { triggerTransition } = useTransition();

  const launchApp = () => triggerTransition("/dashboard");

  return (
    <section className="relative isolate overflow-hidden bg-[#050608] text-white">
      {/* Full-bleed Aurora Blur — atmospheric backdrop. Dimmed so the foreground reads. */}
      <div className="absolute inset-0 -z-10">
        <AuroraBlur
          speed={0.6}
          bloomIntensity={2.2}
          brightness={0.9}
          opacity={0.55}
          className="absolute inset-0"
        />
        {/* Vignette + scrim so text on top stays readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#050608]/60 via-[#050608]/30 to-[#050608]/85" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(220,232,93,0.10),transparent_55%)]" />
      </div>

      <div className="relative w-full px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-28">
        <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-16">
          {/* Left Column — Copy */}
          <div className="flex flex-col space-y-6 sm:space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex w-fit cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] p-1 backdrop-blur-md transition-colors hover:border-[#dce85d]/40 sm:gap-3"
            >
              <span className="inline-flex items-center gap-1 rounded-full bg-[#dce85d] px-3 py-1 text-xs font-medium text-[#090a0a] sm:text-sm">
                <Sparkles className="h-3 w-3" />
                New
              </span>
              <span className="mr-2 text-sm text-neutral-100 sm:text-base">
                Built for the SoSoValue Buildathon
              </span>
            </motion.div>

            <h1 className="text-3xl font-medium tracking-tight leading-[1.1] text-white sm:text-4xl md:text-5xl lg:text-6xl">
              <BlurHighlight
                highlightedBits={["one-person", "on-chain"]}
                highlightColor="#dce85d"
                blurAmount={10}
                blurDuration={0.9}
                highlightDelay={0.3}
                highlightDuration={1.1}
              >
                Run a one-person on-chain finance business.
              </BlurHighlight>
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="max-w-xl text-base leading-relaxed text-neutral-300 sm:text-lg"
            >
              Vega turns SoSoValue&apos;s research, indices, and on-chain
              orderbook into an agentic platform. Be your own news agency, index
              publisher, and fund manager — solo.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.55 }}
              className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <motion.button
                onClick={launchApp}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="group inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#dce85d] px-6 py-3 text-sm font-medium text-[#090a0a] shadow-[0_0_30px_rgba(220,232,93,0.25)] transition-colors duration-200 hover:bg-[#e4ef6e] hover:shadow-[0_0_50px_rgba(220,232,93,0.4)] sm:w-auto sm:text-base"
              >
                Launch app
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </motion.button>

              <motion.button
                onClick={() => router.push("/docs")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="group inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] py-3 pl-5 pr-3 text-sm font-medium text-neutral-100 backdrop-blur-md transition-colors duration-200 hover:border-white/24 hover:bg-white/[0.08] sm:w-auto sm:text-base"
              >
                Read docs
                <motion.span
                  className="grid h-6 w-6 place-items-center rounded-full bg-[#dce85d]"
                  whileHover={{ rotate: 90 }}
                  transition={{ duration: 0.3 }}
                >
                  <Play className="h-3 w-3 fill-[#090a0a] text-[#090a0a]" />
                </motion.span>
              </motion.button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.7 }}
              className="flex select-none items-center gap-3 pt-2 sm:gap-4 sm:pt-4"
            >
              <span className="size-2 animate-pulse-glow rounded-full bg-[#dce85d] shadow-[0_0_12px_#dce85d]" />
              <div className="flex flex-col">
                <span className="text-base font-semibold text-white sm:text-lg">
                  Powered by
                </span>
                <span className="text-xs text-neutral-400 sm:text-sm">
                  SoSoValue · SoDEX · ValueChain (EVM L1)
                </span>
              </div>
            </motion.div>
          </div>

          {/* Right Column — Agentic Ball focal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative min-h-[420px] sm:min-h-[520px]"
          >
            <div className="relative h-full w-full overflow-hidden rounded-[2rem] border border-white/8 bg-black/40 backdrop-blur-md">
              <AgenticBall
                speed={0.55}
                complexity={4}
                swirl={2.4}
                className="absolute inset-0"
              />

              {/* Live signal HUD */}
              <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-white backdrop-blur-md">
                  <div className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#dce85d]">
                    Live signal
                  </div>
                  <div className="mt-1 font-mono text-sm tracking-tight">
                    BTC ETF inflow +$184M · sentiment 0.74
                  </div>
                </div>
                <button
                  onClick={launchApp}
                  aria-label="Launch dashboard"
                  className="grid h-12 w-12 place-items-center rounded-full bg-[#dce85d] text-[#090a0a] shadow-[0_0_30px_rgba(220,232,93,0.3)] transition-colors hover:bg-[#e4ef6e]"
                >
                  <ArrowRight className="h-5 w-5 -rotate-45" />
                </button>
              </div>

              {/* Top-left chip */}
              <div className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-md">
                · Agent · live ·
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
