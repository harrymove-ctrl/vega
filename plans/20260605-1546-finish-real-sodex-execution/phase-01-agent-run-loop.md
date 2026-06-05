# Phase 1 — Agent deploy/run loop (lifecycle step 5)

**Goal:** A builder graph becomes a running agent that evaluates triggers against
live SoDEX market data and places **real testnet orders** via the existing
`sodex-trade.ts` primitives. Replace the mock runtime in `/bots`.

**Blocked on:** §1 execution-model decision in `plan.md`. Default = Option A
(wallet-in-the-loop), built behind an `ExecutionStrategy` interface.

## Existing pieces to reuse (don't rebuild)
- `buildRoutesFromGraph(nodes, edges)` → `BuilderAiRoute[]` (`builder-flow-utils.ts:735`)
- `placeBatchNewOrder` / `cancelBatchOrder` (`sodex-trade.ts:460,469`)
- `fetchTickers`, `fetchOrderbook`, `fetchRecentTrades` (`sodex-public.ts`)
- Mock surfaces to replace: `runtime-events.ts`, `runtime-overview.ts`,
  `fleet-observability.ts`, `components/bots/*` (`execution-log.tsx`, `runtime-controls.tsx`)

## Tasks
1. **`ExecutionStrategy` interface** (`apps/web/src/lib/runtime/execution-strategy.ts`)
   - `placeOrder(item: BatchNewOrderItem): Promise<{ clOrdId; accepted: boolean; raw }>`
   - `cancel(item: BatchCancelOrderItem): Promise<...>`
   - Impl `WalletInLoopStrategy` wraps `placeBatchNewOrder` (uses connected wagmi signer).
   - Leave a `DelegatedKeyStrategy` stub with a clear `throw new Error("not wired")`.
2. **Trigger evaluator** (`apps/web/src/lib/runtime/evaluate-route.ts`)
   - Pure fn: `(route, marketSnapshot) => { fired: boolean; matched: condition[] }`.
   - Cover every `CONDITION_OPTIONS` type (`price_above/below`, `cooldown_elapsed`,
     orderbook imbalance, tape). Unit-test each — this is the correctness core.
3. **`StrategyRuntime`** (`apps/web/src/lib/runtime/strategy-runtime.ts`)
   - Holds: graph routes, poll interval, market feed, ExecutionStrategy, state machine
     (`idle|running|paused|stopped|error`), in-memory execution log.
   - Loop: snapshot market → evaluate routes → on fire, map action→`BatchNewOrderItem`
     (reuse symbol/precision from `fetchSymbols`) → `strategy.placeOrder` → append log.
   - Respect `cooldown_elapsed` + per-route dedupe so one fire ≠ order storm.
   - Kill-switch + `cancelBatchOrder` on stop.
4. **Wire `/bots` UI to real runtime**
   - `bots-fleet-page.tsx`: deploy button instantiates `StrategyRuntime` from the
     active builder graph; controls call `runtime.start/pause/stop`.
   - `execution-log.tsx`: render real log events, not mock.
   - Gate the whole panel behind `NEXT_PUBLIC_DEMO_MODE` parity (matches PR #1 pattern).
5. **Verification script** (`apps/web/scripts/sodex-run-loop-smoke.mjs`)
   - Headless: load a starter template graph → evaluator → place ONE real testnet order
     → assert accepted (mirror existing `sodex-place-testnet-order.mjs`).

## Acceptance
- Deploying the `momentum-breakout-v1` starter on testnet places a real, explorer-visible
  order when its condition is synthetically satisfied.
- `tsc --noEmit` clean; evaluator unit tests pass.
- With `NEXT_PUBLIC_DEMO_MODE=true`, no real orders fire (uses a no-op strategy).

## Est. effort
Evaluator + runtime + interface: ~1.5 day. UI wiring: ~0.5 day. Option B2 (if chosen): +2–3 days.

---

## STATUS — 2026-06-05 (Option A)

✅ **Engine complete + type-clean + lint-clean + live-verified.** New module `apps/web/src/lib/runtime/`:
- `indicators.ts` — sma/ema/rsi/vwap/breakout/cross (pure)
- `market-snapshot.ts` — assembles a `MarketSnapshot` from public SoDEX reads
- `evaluate-route.ts` — pure trigger evaluator. Implements price/change/volume/
  breakout/sma/rsi/vwap/ema-cross/htf-sma/cooldown. **Unsupported conditions
  (position_*, funding, atr, bollinger, macd, volatility) return `supported:false`
  → BLOCK the route from firing.** Never trades on an unreadable trigger.
- `map-action.ts` — `VisualAction` → `BatchNewOrderItem`, sized to tick/step/min.
  open_long/open_short/place_market/place_limit wired; perp/twap/cancel → unsupported.
- `execution-strategy.ts` — `ExecutionStrategy` seam + `WalletInLoopStrategy` (A),
  `DryRunStrategy` (demo), `DelegatedKeyStrategy` (B stub, throws).
- `strategy-runtime.ts` — loop + state machine (idle/running/paused/stopped/error)
  + per-route cooldown + storm guard + execution log. Resolves builder universe
  sentinel to the chosen symbol.
- UI: `components/bots/strategy-runtime-panel.tsx` — deploy/pause/stop + live log,
  DryRun under `NEXT_PUBLIC_DEMO_MODE`. **Self-contained, mountable, NOT yet mounted.**
- Verify: `scripts/sodex-run-loop-smoke.mjs` — wallet-free, **passed live on testnet**
  (vMAG7ssi_vUSDC snapshot well-formed, sma_above decision reproduced).

✅ **Mounted on `/dashboard`** (user choice) — `<StrategyRuntimePanel/>` seeded with
the momentum-breakout starter graph (`buildDefaultGraph()`), below TestOrderPanel.
tsc + eslint clean after mount.

**Phase 1 COMPLETE** (Option A). Phase 2 (PnL) and Phase 3 (social) remain.

⚠️ **Not committed** — no push/commit without explicit go-ahead.
