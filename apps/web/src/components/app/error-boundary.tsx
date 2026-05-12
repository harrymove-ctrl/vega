"use client";

import React from "react";

type State = { error: Error | null };

/**
 * Global error boundary for the (app) shell. Catches any uncaught React
 * render error from the cloned ClashX components and renders a clean
 * "Demo mode" fallback instead of letting Next.js's bare 'This page
 * couldn't load' page surface. Reload button restores normal flow.
 */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn("[Vega] AppErrorBoundary caught:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="grid min-h-[60vh] place-items-center p-8">
        <div className="max-w-md rounded-2xl border border-white/10 bg-card-deep/60 p-6 backdrop-blur-md">
          <div className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#dca204]">
            Demo mode
          </div>
          <h2 className="mt-2 font-mono text-lg font-bold uppercase tracking-tight text-neutral-50">
            Wave 2 wiring needed
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            This page tried to call the Vega backend (FastAPI + Supabase +
            agent runtime) which isn&apos;t deployed in Wave 1. The landing
            page and dashboard show real SoSoValue + SoDEX data; the agent
            authoring + execution stack ships in Wave 2.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={this.reset}
              className="rounded-full bg-[#dce85d] px-4 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#090a0a] transition hover:bg-[#e4ef6e]"
            >
              Try again
            </button>
            <a
              href="/"
              className="rounded-full border border-white/12 px-4 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-neutral-300 transition hover:border-white/24"
            >
              Back to landing
            </a>
          </div>
        </div>
      </main>
    );
  }
}
