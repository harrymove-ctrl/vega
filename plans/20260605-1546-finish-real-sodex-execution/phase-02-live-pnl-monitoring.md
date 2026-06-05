# Phase 2 — Live PnL monitoring (lifecycle step 6)

**Goal:** `/dashboard` shows real account state + agent-attributed PnL from SoDEX
reads. The fetch layer already exists — the gap is **aggregation + attribution +
live refresh**, not new endpoints.

**Independent of Phase 1** — can run in parallel. Becomes richer once Phase 1 emits
real fills, but stands alone against any address with testnet activity.

## Existing pieces to reuse
- `fetchAccountBalances(address)` → `SoDEXCompactBalance[]` (`sodex-public.ts:211`)
- `fetchAccountOpenOrders(address)` (`:217`)
- `fetchAccountOrderHistory(address, ...)` (`:223`)
- `fetchAccountUserTrades(address, ...)` (`:238`)
- Panels already mounted on `/dashboard`: `MyOrdersPanel`, `MarketChart`,
  `TestOrderPanel`, `LiveSoDEXMarkets` (`dashboard/page.tsx:10-13`).

## Tasks
1. **PnL aggregator** (`apps/web/src/lib/pnl/account-pnl.ts`)
   - Inputs: balances + user trades + open orders + current tickers.
   - Compute: realized PnL (from fills), unrealized (open position × mark from `fetchTickers`),
     fees, net. Per-symbol and portfolio total.
   - Pure + unit-tested with fixture trade lists. This is the correctness core.
2. **Agent attribution** (links to Phase 1)
   - Tag orders placed by `StrategyRuntime` with their `clOrdId` prefix (already
     controllable in `sodex-trade.ts` clOrdID logic). Aggregator buckets fills by
     agent via clOrdId prefix → per-agent PnL without extra storage.
3. **Live refresh hook** (`apps/web/src/lib/pnl/use-account-pnl.ts`)
   - TanStack Query (`@tanstack/react-query` already a dep) polling balances/orders;
     subscribe to SoDEX WS positions where available, fall back to interval.
4. **Dashboard wiring**
   - Replace any remaining mock PnL in dashboard widgets with `useAccountPnl(address)`.
   - Empty/disconnected state when no wallet (don't crash on `address === undefined`).
5. **Verification** — extend a smoke script to print computed PnL for a known testnet
   address and eyeball against the SoDEX explorer.

## Acceptance
- Connect a wallet that has placed testnet orders → dashboard shows correct balances,
  open orders, realized/unrealized PnL matching the explorer within rounding.
- No wallet connected → clean empty state, no errors.
- `tsc --noEmit` clean; aggregator unit tests pass.

## Est. effort
Aggregator + tests: ~1 day. Hook + dashboard wiring: ~0.5 day.
