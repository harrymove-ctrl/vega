"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Segment-level error boundary for every /(app) page. Without it, a single
 * unexpected runtime error (e.g. a backend-offline payload shaped differently
 * than a component expects) white-screens the whole route. This degrades it to
 * a recoverable fallback instead.
 *
 * NOTE: this Next.js build exposes `unstable_retry` (not the upstream `reset`).
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[vega] app segment error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
        <AlertTriangle className="size-6 text-amber-400" />
      </div>
      <h2 className="mt-5 font-mono text-xl font-semibold text-neutral-50">
        Something went wrong on this page
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
        This usually means a data source is unavailable (the optional backend is
        not connected in this build). Your wallet and on-chain data are
        unaffected. Try again, or head back to the dashboard.
      </p>
      {error?.message ? (
        <pre className="mt-4 max-w-md overflow-x-auto rounded-lg border border-white/8 bg-black/40 px-3 py-2 text-left text-[0.7rem] text-neutral-500">
          {error.message}
        </pre>
      ) : null}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => unstable_retry()}
          className="inline-flex items-center gap-2 rounded-full bg-[#dce85d] px-5 py-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#090a0a] transition hover:bg-[#e4ef6e]"
        >
          <RotateCw className="size-3.5" />
          Try again
        </button>
        <a
          href="/dashboard"
          className="inline-flex items-center rounded-full border border-white/10 px-5 py-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-neutral-300 transition hover:border-white/20 hover:text-neutral-100"
        >
          Dashboard
        </a>
      </div>
    </main>
  );
}
