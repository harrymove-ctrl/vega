# Vega Full-Flow Audit

**Date:** 2026-06-06 · **Method:** 36-agent workflow (map → audit → adversarial verify → live on-chain proof runs → research/plan → synthesize + critic). 10 flows, 7 on-chain proof areas, 6 completion plans. Static source analysis + live read-only/dry-run script runs; **no browser was driven and no live order was placed.**

---

## ⚠️ Read first — accuracy corrections (from the completeness critic)

The synthesized report below is sharp but **overstates a few proofs**. These corrections override the body where they conflict:

1. **Order signing is NOT "proven", it's code-correct-unrun.** The dry-run script `apps/web/scripts/sodex-place-testnet-order.mjs` **reimplements** the whole EIP-712 pipeline with viem (`privateKeyToAccount` + `account.signTypedData`); it does **not** import the production `signBatchNewOrder`/`placeBatchNewOrder`/`sendSigned` from `sodex-trade.ts` (those call `signTypedData(wagmiConfig,…)`, which only runs in a browser). So what's proven is that a **parallel reimplementation** is byte-correct — the exported functions the UI actually calls were never executed. Reclassify `signBatchNewOrder` → **code-correct-unrun** (the viem *reimplementation*).

   **UPDATE 2026-06-06 — the LIVE WRITE is now proven.** Ran the (reimplemented) place pipeline against live testnet WITHOUT `--dry-run`: 3 real orders accepted by the SoDEX sequencer (HTTP 200, code 0, real orderIDs `1265346247` TESTBTC_vUSDC, `1265346249` vBTC_vUSDC, `1265346250` vTSLA_vUSDC), then all 3 cancelled (signed DELETE, code 0), account returned to 0 open orders. A halted symbol (vMAG7ssi_vUSDC) returned `code -1 "symbol is in cancel only mode"` — i.e. the signature passed verification and was rejected only on market state. So the **EIP-712 signing scheme + sequencer accept/cancel path is proven-live**. Still genuinely un-run: the **browser wagmi `signTypedData` leg** (the exported `sodex-trade.ts` fns) — only the viem local-key reimplementation has touched the network.
2. **Payload-hash parity = JS self-consistency vs frozen fixtures, not a live Go re-run.** `sodex-payload-hash-parity.mjs` asserts against hardcoded `EXPECTED.hash` literals hand-captured from a Go program earlier. It passes green, but "byte-parity with the live Go SDK" is unverified unless someone re-runs the Go.
3. **Crash claims are DEMO_MODE-conditional and were not browser-observed.** `/backtests`, `/copy`, `/telegram` crashes require the stub active (`DEMO_MODE=1`). But `.env.local` sets `NEXT_PUBLIC_DEMO_MODE=0`, so *locally* the fetch patch is OFF and those paths hit dead localhost instead. Treat each crash as "only in a deployed `DEMO_MODE=1` build, inferred from source — not observed."
4. **Script paths are `apps/web/scripts/sodex-*.mjs`** (the repo-root `scripts/` is unrelated). Some line refs are ±a few lines (e.g. `computePayloadHash` is `sodex-trade.ts:275`, not `:267`).
5. **`/onboarding` was missed** — it's the first gated surface and calls `fetchSoDEXReadiness`, hitting the same fabricated-readiness stub (`ready:true`, `VEGA-DEMO`, `equity_usd:250`) flagged for `/bots`, but on the entry funnel. `/terms`, `/desktop-only`, and the `/docs` tree (15+ pages) were also not audited.
6. **Auth is a top-tier finding, not a footnote.** `getAuthHeaders` emits `Authorization: Bearer wagmi:<addr>` (`vega-auth.ts:71`) — an unsigned, spoofable plaintext address. Any backend built per the P1 plan must replace this before trusting wallet identity. **Promote to P0.**
7. **Live-read numbers (blockHeight 153,903,192; vUSDC 1400; aid 999/56664) were captured in-session and not re-verified every pass** — testnet state drifts.

**Net effect:** the *exchange-layer reads* are genuinely proven live; the *write path* is correctly coded and parity-checked but **never exercised through the real exported functions or a real wallet**. "It can place a real order" remains one un-run MetaMask round-trip away from proof.

---

## 1. Executive verdict

**Vega is a thin shell of genuinely-real surfaces wrapped around a large body of demo-stubbed/mock UI.** Of 10 user-facing flows, exactly **one** (`/dashboard`) is genuinely real and wired live; the rest are demo-stubbed or mock/broken because they depend on an optional FastAPI backend (`services/vega-backend`) that implements only 5 read-only proxy routes (`/healthz`, `/v1/sosovalue/etf`, `/v1/sosovalue/news`, `/v1/sodex/markets`, `/v1/sodex/orderbook` — `services/vega-backend/src/main.py:24-26`) and **none** of the `/api/bots`, `/api/copilot`, `/api/marketplace`, `/api/bot-copy`, `/api/portfolios`, `/api/telegram`, `/api/backtests`, `/api/sodex/readiness`, or `/api/builder/*` routes the frontend calls. **Headline: ~15% real.**

The central mock mechanism is `apps/web/src/lib/disable-missing-backend.ts`: when `NEXT_PUBLIC_DEMO_MODE` is unset/"1" (shipped default, `:156`) it monkey-patches `window.fetch` to return canned JSON for `localhost:8000/8001` URLs. `DISABLED_PREFIXES` (`:12-16`) contains **only** localhost + three public ETH RPCs (`SUPPRESSED_RPCS`, `:22-26`). It does **not** intercept `*.sodex.dev`, `openapi.sosovalue.com`, or `*.valuechain.xyz` — so the real seams pass straight through regardless of demo mode. That's why the dashboard's SoDEX/SoSoValue data is real even in demo mode.

**Proven real (script-verified live reads):**
- **SoDEX testnet public reads** (`lib/sodex-public.ts`) — 9/10 functions proven-live by direct curl (HTTP 200, real prices, blockHeight ~153.9M, OHLCV, orderbook depth).
- **SoSoValue OpenAPI** (`lib/sosovalue-public.ts`) — ETF history / news / etfs proven-live with key-gated 200s; a no-key control returned 401 `{code:400101}`, proving real auth, not a permissive stub.
- **ValueChain L1 RPC** — testnet 138565 / mainnet 286623 proven-live (block advancing).
- **Runtime evaluator** (`lib/runtime/*`) — snapshot + evaluate + indicators proven-live by `sodex-run-loop-smoke.mjs` (real fire/no-fire off live klines).

**Proven correct-but-unrun (per corrections above):** the EIP-712 write pipeline (`computePayloadHash`, `toWireSignature`, `signBatchNewOrder`) — byte-correct in a viem reimplementation, real exported functions never executed.

**On-chain caveat that matters:** SoDEX orders are **EIP-712 messages to the SoDEX sequencer/gateway, NOT ValueChain L1 settlement txs** (`verifyingContract 0x0`, sequencer blockHeight ~148M, INTEGRATION.md §7.5). "Touches chain" is true at the *exchange layer*; there's no explorer-verifiable L1 tx from the UI. The only true L1 boundary (deposit/withdraw) has **no working code path**.

## 2. Status matrix (corrected verdicts)

| Flow | Completeness | Real/Mock | On-chain wired? | Top UI/UX issue |
|---|---|---|---|---|
| `/dashboard` | complete | **real** | real-wired (exchange layer) | "Refreshes on every page load" but widgets fetch once in `useEffect`, no interval (`dashboard/page.tsx:132`) |
| `/builder` | partial | **partial** (only SoDEX reads live; server verbs stubbed) | **none** (`deployBot` → fake toast) | Deploy is fake-success theater: green toast, signs/sends/persists nothing (`builder-graph-studio.tsx:2307-2333`) |
| `/copilot` | shell-only | **demo-stubbed** (no LLM client at all) | none | Send POST returns `[]` → "Copilot request failed"; docs oversell "dual-provider failover" that doesn't exist (`copilot-page.tsx:571,581`) |
| `/backtests` | broken* | **demo-stubbed** | none | *Only in `DEMO_MODE=1`: bootstrap stub omits `bots` → `nextBots.some()` TypeError. "SoDEX windows" is local arithmetic, no candles fetched |
| `/bots` | shell-only | **demo-stubbed** | none | Every `/bots/${id}` link 404s (no `[id]` route under static export); fabricated readiness shown as real, no demo banner |
| `/marketplace` | shell-only | **demo-stubbed** | none | Permanently empty (`{discover:[],featured:[],creators:[]}`) shown as live; profile links 404 |
| `/leaderboard` | shell-only | **demo-stubbed** | none | Bare client redirect to `/marketplace`, blank flash; most components dead code |
| `/copy` | shell-only | **mock** | none | *DEMO_MODE-dependent stub key mismatch → `[]` → overview crashes on `.summary` |
| `/analytics` | shell-only | **demo-stubbed** | none | Authoritative `+$0.00`/`0 Errors` with no loading guard / no demo banner |
| `/onboarding` ⚠️ | shell-only | **demo-stubbed** | none | (added by critic) fabricated readiness `ready:true`/`VEGA-DEMO`/`$250` on the FIRST gated surface |

## 3. On-chain proof ledger (corrected)

| Function | How checked | Result | Evidence |
|---|---|---|---|
| `fetchTickers/Klines/Orderbook/AccountState/Balances/OpenOrders/OrderHistory/UserTrades` (`sodex-public.ts`) | direct curl + smoke | **proven-live** | HTTP 200 real data; captured in-session, not re-verified each pass |
| `fetchRecentTrades` (`sodex-public.ts:174`) | code read; sibling curled | **code-correct-unrun** | shares the proven `get()`/BASE_URL; exact route not curled |
| `computePayloadHash` (`sodex-trade.ts:275`) | `sodex-payload-hash-parity.mjs` | **JS-self-consistent vs frozen Go fixtures** | 3/3 hashes match hardcoded literals; Go not re-run |
| `toWireSignature` (`sodex-trade.ts:310`) | independent viem `recoverAddress` | **proven (crypto)** | v 27→0 normalized sig recovers to signer; 66-byte wireSig |
| `signBatchNewOrder` (`sodex-trade.ts:346`) | dry-run **reimplementation**, real fn un-run | **code-correct-unrun** | script reimplements with viem; exported fn (wagmi) never executed |
| `placeBatchNewOrder`/`sendSigned` (`sodex-trade.ts:460,393`) | code read; POST withheld | **needs-key** | target not stubbed; gateway live; one non-dry-run call would place a real order |
| `WalletInLoopStrategy.placeOrder` (`execution-strategy.ts:53`) | code read | **code-correct-unrun** | `live=true`; calls `placeBatchNewOrder`; needs browser wallet |
| `DryRunStrategy` / `DelegatedKeyStrategy` | code read | **mock / broken by design** | dry-run no-op; delegated throws "not wired (Option B)" |
| `fetchEtfSummaryHistory/FeaturedNews/Etfs` (`sosovalue-public.ts`) | live curl + no-key control | **proven-live** | 200 `{code:0}`; no-key → 401 `{code:400101}` |
| ValueChain testnet/mainnet RPC | `sodex-l1-readiness.mjs` + curl | **proven-live** | testnet 138565 (block advancing), mainnet 286623 |
| L1 native broadcast (`sodex-l1-self-transfer.mjs`) | `--dry-run` | **inert** | `eth_estimateGas=21000`, no broadcast; wallet 0 SOSO, nonce 0 |
| L1 withdraw/bridge (`sodex-withdraw-probe.mjs`) | code + §7.5 | **broken** | public `transferAsset` rejects EVMWithdraw; real withdraw closed-source |

## 4. Prioritized gap plan

### P0 — Correctness core
- **P0-A. Extend the runtime evaluator** (`lib/runtime/evaluate-route.ts` + `indicators.ts`). 18 conditions short-circuit to `unsupported()` and **block their whole route**. Split: *pure-candle indicators* (atr/bollinger/macd/volatility) need NO new data (`candlesByInterval` exists) → add pure fns + switch arms (M). *Spot account-state* (has_position/position_side_is/in_profit/loss/pnl_above/below) → synthesize an `AccountSnapshot` (net inventory + avg-cost unrealized) from `fetchAccountBalances`+`fetchAccountUserTrades`, plumb via `RouteEvalContext` (S+M+M+M). *True perp* (funding_rate, margin pnl_pct) → stay `unsupported()` with an honest reason ("spot venue has no funding/margin") — do NOT fabricate (S).
- **P0-B. (promoted) Replace `Bearer wagmi:<addr>` auth** (`vega-auth.ts:71`) with a real signed challenge before any backend trusts identity.

### P1 — Make the real path reachable, stop the lies
- **P1-A.** Backend-aware degrade: replace the global `window.fetch` monkey-patch with `isBackendConfigured()` + typed empty shapes; make `assertSoDEXDeployReadiness` (`sodex-readiness.ts:64`) non-blocking when no backend (it's the one place a dead fetch hard-throws and blocks `/bots` + `/builder` deploy).
- **P1-B.** Live account-attributed PnL on `/dashboard` (step 6): pure avg-cost aggregator (`lib/pnl/account-pnl.ts`) + TanStack-Query hook + panel + smoke. REST polling (no WS exists). ⚠️ critic: verify the `vega-bot-*`/`vega-ui-*` clOrdID prefixes are actually emitted before relying on them for attribution.
- **P1-C.** Reconcile `/bots` fleet → the real browser wallet-in-loop runtime; export-safe `/bots/desk?botId=` detail route (no `[id]` under `output:"export"`); serialize bulk-deploy signatures.
- **P1-D.** Social backend to the **real client contract** (`/api/*`, not the plan-03 `/v1/*`): first Alembic migration, models, routers, run-reporting bridge. ⚠️ enumerate the full `/api/*` call set first.
- **P1-E.** Copilot real Anthropic tool loop (no LLM client exists today; key stays backend-only — static export ships any `NEXT_PUBLIC_*`).

### P2 — Honesty/polish
- "Backend-offline" badges on analytics/marketplace/leaderboard/copy/telegram/backtests; fix stub-shape crashes (`/backtests` missing `bots`, `/copy` key mismatch, `/telegram` missing `commands`); add `(app)/error.tsx` boundary; remove dead code; add `/dashboard` widget polling.

## 5. UI/UX issues — see body of run for full HIGH/MEDIUM/LOW list
Headlines (HIGH): `/builder` fake-success deploy & save; `/copilot` dead send + vaporware docs; `/backtests` crash + fake worker engine; `/bots` dead nav + fabricated readiness; `/marketplace` & `/leaderboard` empty-as-live; `/copy` crash + inert safety-critical mirror modal; `/telegram` crash + fake "test sent"; `/analytics` authoritative zeros with no disclosure. `/dashboard` MEDIUM: runtime panel always dry-runs in prod yet button says "Deploy"; default graph's `set_tpsl` leg silently unsupported.

## 6. Honest caveats
No live order placed (read-only mandate); browser-wallet signTypedData round-trip un-run; UI never driven in a browser (crash claims are source + bundle-grep); deployed Cloudflare `DEMO_MODE` value inferred not observed; `.env.local` has `DEMO_MODE=0` so local ≠ deployed behavior.
