"use client";

import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

export default function Footer1() {
  const footerCards = [
    {
      title: "Product",
      links: [
        { text: "Smart Research", href: "/dashboard" },
        { text: "AI Copilot", href: "/copilot" },
        { text: "Visual Builder", href: "/builder" },
        { text: "Backtest Lab", href: "/backtests" },
      ],
    },
    {
      title: "Network",
      links: [
        { text: "Marketplace", href: "/marketplace" },
        { text: "Copy trading", href: "/copy" },
        { text: "Telegram bot", href: "/telegram" },
      ],
    },
    {
      title: "Resources",
      links: [
        { text: "Documentation", href: "/docs" },
        { text: "SoSoValue API", href: "https://sosovalue-1.gitbook.io/sosovalue-api-doc", external: true },
        { text: "SoDEX API", href: "https://sodex.com/documentation/api/api", external: true },
        { text: "Terms", href: "/terms" },
      ],
    },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <footer className="relative w-full overflow-hidden bg-white dark:bg-neutral-950 py-12 sm:py-16 md:py-20 lg:py-24">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
            {/* Branding column */}
            <motion.div
              variants={itemVariants}
              className="flex flex-col justify-between space-y-6 mb-6 lg:mb-0"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#dce85d]">
                  <span className="text-lg font-bold text-[#090a0a]">V</span>
                </div>
                <span className="text-lg font-semibold text-neutral-900 dark:text-white tracking-tight">
                  Vega
                </span>
              </div>

              <div>
                <h3 className="text-lg font-medium tracking-tight text-neutral-900 dark:text-white sm:text-xl">
                  Agentic on-chain
                  <br />
                  finance for one.
                </h3>
              </div>

              <div className="mt-auto">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Built for the SoSoValue Buildathon.
                </p>
              </div>
            </motion.div>

            {/* Link cards */}
            {footerCards.map((card, index) => {
              let marginClass = "";
              if (index > 0) marginClass = "-mt-px";
              if (index === 0) marginClass += " md:mt-0";
              else if (index === 1) marginClass += " md:-mt-px md:ml-0";
              else if (index === 2) marginClass += " md:-mt-px md:-ml-px";
              marginClass += " lg:mt-0";
              if (index > 0) marginClass += " lg:-ml-px";

              return (
                <motion.div
                  key={card.title}
                  variants={itemVariants}
                  className={`group relative min-h-[260px] overflow-hidden border border-neutral-300 p-6 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900 sm:p-8 ${marginClass}`}
                >
                  <h4 className="mb-6 text-sm font-medium tracking-tight text-neutral-900 dark:text-white sm:text-base">
                    {card.title}
                  </h4>
                  <ul className="space-y-3">
                    {card.links.map((link) => (
                      <li key={link.text}>
                        <a
                          href={link.href}
                          target={link.external ? "_blank" : undefined}
                          rel={link.external ? "noreferrer" : undefined}
                          className="inline-flex font-light items-center gap-1 text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white sm:text-base"
                        >
                          {link.text}
                          {link.external && <ArrowUpRight className="h-3 w-3" />}
                        </a>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>

          {/* Wordmark */}
          <motion.div
            variants={itemVariants}
            className="relative flex items-center justify-center overflow-hidden py-8 sm:py-12 md:py-16"
            aria-hidden="true"
          >
            <span
              className="select-none font-mono text-[18vw] font-black uppercase leading-none tracking-tighter text-neutral-200 dark:text-neutral-900"
            >
              VEGA
            </span>
          </motion.div>
        </motion.div>
      </div>
    </footer>
  );
}
