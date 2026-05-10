"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bell, ChevronDown, Menu, X } from "lucide-react";

import { useTransition } from "@/components/providers/transition-provider";

export default function Navigation1() {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileAccordion, setMobileAccordion] = useState<string | null>(null);
  const { triggerTransition } = useTransition();
  const launchApp = (e: React.MouseEvent) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    triggerTransition("/dashboard");
  };

  const menuItems = {
    products: [
      { name: "Smart Research", href: "/dashboard" },
      { name: "AI Copilot", href: "/copilot" },
      { name: "Visual Builder", href: "/builder" },
      { name: "Backtest Lab", href: "/backtests" },
      { name: "Autonomous Agents", href: "/bots" },
      { name: "Marketplace", href: "/marketplace" },
      { name: "Copy Trading", href: "/copy" },
    ],
    solutions: [
      { name: "For Solo Quants", href: "#" },
      { name: "For Index Publishers", href: "#" },
      { name: "For News Curators", href: "#" },
      { name: "For Liquidity Providers", href: "#" },
    ],
  };

  return (
    <nav className="relative w-full bg-white px-6 py-4 dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto w-full max-w-[1400px]">
        <motion.div
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* Left Side */}
          <div className="flex items-center gap-8">
            {/* Logo */}
            <a
              href="/"
              className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-white z-50 inline-flex items-baseline gap-[2px]"
            >
              <span>Vega</span>
              <span className="text-[#dce85d]">.</span>
            </a>

            {/* Navigation Items */}
            <div className="hidden items-center gap-1 lg:flex">
              {/* Products Dropdown */}
              <div
                className="relative"
                onMouseEnter={() => setActiveMenu("products")}
                onMouseLeave={() => setActiveMenu(null)}
              >
                <button className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white">
                  Products
                  <ChevronDown className="h-4 w-4" />
                </button>

                <AnimatePresence>
                  {activeMenu === "products" && (
                    <>
                      {/* Invisible bridge to prevent flickering */}
                      <div className="absolute left-0 top-full h-2 w-full" />
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
                      >
                        <div className="p-2">
                          {menuItems.products.map((item, index) => (
                            <motion.a
                              key={item.name}
                              href={item.href}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{
                                duration: 0.2,
                                delay: index * 0.03,
                              }}
                              className="block rounded-md px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900 no-underline"
                            >
                              {item.name}
                            </motion.a>
                          ))}
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Solutions Dropdown */}
              <div
                className="relative"
                onMouseEnter={() => setActiveMenu("solutions")}
                onMouseLeave={() => setActiveMenu(null)}
              >
                <button className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white">
                  Solutions
                  <ChevronDown className="h-4 w-4" />
                </button>

                <AnimatePresence>
                  {activeMenu === "solutions" && (
                    <>
                      {/* Invisible bridge to prevent flickering */}
                      <div className="absolute left-0 top-full h-2 w-full" />
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
                      >
                        <div className="p-2">
                          {menuItems.solutions.map((item, index) => (
                            <motion.a
                              key={item.name}
                              href={item.href}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{
                                duration: 0.2,
                                delay: index * 0.03,
                              }}
                              className="block rounded-md px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900 no-underline"
                            >
                              {item.name}
                            </motion.a>
                          ))}
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Docs link */}
              <a
                href="/docs"
                className="rounded-md px-3 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white no-underline"
              >
                Docs
              </a>
            </div>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-3">
            {/* Desktop: Notification Icon */}
            <button
              className="hidden h-10 w-10 items-center justify-center rounded-md text-neutral-700 dark:text-neutral-300 lg:flex"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
            </button>

            {/* Desktop: Sign In Button */}
            <a
              href="/onboarding"
              className="hidden rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900 lg:inline-block"
            >
              Sign in
            </a>

            {/* Desktop: Launch app */}
            <a
              href="/dashboard"
              onClick={launchApp}
              className="hidden rounded-md bg-[#dce85d] px-5 py-2 text-sm font-medium text-[#090a0a] hover:bg-[#e4ef6e] lg:inline-block"
            >
              Launch app
            </a>

            {/* Mobile: Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 lg:hidden z-50"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-white dark:bg-neutral-950 lg:hidden"
          >
            {/* Spacer for consistent layout */}
            <div className="h-[73px] border-b border-neutral-200 dark:border-neutral-800" />

            <div className="mx-auto flex h-[calc(100%-73px)] max-w-[1400px] flex-col px-6">
              {/* Menu Content */}
              <div className="flex flex-1 flex-col gap-8 overflow-y-auto py-8 pb-0">
                {/* Products Dropdown */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                >
                  <button
                    onClick={() =>
                      setMobileAccordion(
                        mobileAccordion === "products" ? null : "products",
                      )
                    }
                    className="flex w-full items-center justify-between text-left text-2xl font-medium text-neutral-900 dark:text-white"
                  >
                    Products
                    <ChevronDown
                      className={`h-6 w-6 transition-transform ${mobileAccordion === "products" ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence>
                    {mobileAccordion === "products" && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 pt-4">
                          {menuItems.products.map((item) => (
                            <a
                              key={item.name}
                              href={item.href}
                              className="block rounded-md px-4 py-3 text-base text-neutral-700 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900 no-underline"
                            >
                              {item.name}
                            </a>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Solutions Dropdown */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                >
                  <button
                    onClick={() =>
                      setMobileAccordion(
                        mobileAccordion === "solutions" ? null : "solutions",
                      )
                    }
                    className="flex w-full items-center justify-between text-left text-2xl font-medium text-neutral-900 dark:text-white"
                  >
                    Solutions
                    <ChevronDown
                      className={`h-6 w-6 transition-transform ${mobileAccordion === "solutions" ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence>
                    {mobileAccordion === "solutions" && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 pt-4">
                          {menuItems.solutions.map((item) => (
                            <a
                              key={item.name}
                              href={item.href}
                              className="block rounded-md px-4 py-3 text-base text-neutral-700 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900 no-underline"
                            >
                              {item.name}
                            </a>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Docs Link */}
                <motion.a
                  href="/docs"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 }}
                  className="text-2xl font-medium text-neutral-900 dark:text-white no-underline"
                >
                  Docs
                </motion.a>
              </div>

              {/* Bottom Actions */}
              <div className="flex flex-col gap-3 border-t border-neutral-200 py-6 dark:border-neutral-800">
                <motion.a
                  href="/onboarding"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.4 }}
                  className="w-full rounded-md border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900 text-center"
                >
                  Sign in
                </motion.a>
                <motion.a
                  href="/dashboard"
                  onClick={launchApp}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.5 }}
                  className="w-full rounded-md bg-[#dce85d] px-4 py-3 text-sm font-medium text-[#090a0a] hover:bg-[#e4ef6e] text-center"
                >
                  Launch app
                </motion.a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
