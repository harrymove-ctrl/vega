# Plan — Finish the REAL SoDEX execution tech

**Created:** 2026-06-05 15:46
**Scope:** Turn lifecycle steps 5–7 (deploy / monitor / social) from UI-shell + mock
into real wired tech, on top of the already-live research, market-data, and EIP-712
signing paths.

---

## 0. Where we actually are (verified, not aspirational)

| Lifecycle step | Surface | State | Evidence |
|---|---|---|---|
| 1 Research | `/research`, `/copilot` | ✅ live | `sosovalue-public.ts`, Anthropic tools |
| 2–3 Author graph | `/builder` (xyflow) | ✅ live (in-memory) | `builder-flow-utils.ts` |
| 4 Backtest | `/backtests` | ✅ live | `fetchKlines`, SoSoValue history |
| **5 Deploy/run agent** | `/bots` | 🔴 **UI shell + mock** | `bots-fleet-page.tsx`, `runtime-*.ts`, `fleet-observability.ts` |
| **6 Monitor PnL** | `/dashboard` | 🟡 **partial** | account-read fns exist (`fetchAccount*`), panels render, but no agent-attributed PnL |
| **7 Social** | `/marketplace` `/leaderboard` `/copy` | 🔴 **mock data** | FastAPI backend only stubs `/markets`,`/orderbook` |

**Already real and reusable (do NOT rebuild):**
- `sodex-trade.ts` — EIP-712 `signBatchNewOrder` / `signBatchCancelOrder` /
  `placeBatchNewOrder` / `cancelBatchOrder`, payload-hash parity locked vs Go SDK,
  nonce + clOrdID handling. This is the execution primitive everything in step 5 calls.
- `sodex-public.ts` — `fetchAccountBalances`, `fetchAccountOpenOrders`,
  `fetchAccountOrderHistory`, `fetchAccountUserTrades`, `fetchTickers`, `fetchKlines`.
  Step 6 reads are already implemented — the gap is aggregation + attribution, not fetching.
- `buildRoutesFromGraph(nodes, edges)` — already compiles a builder graph into
  condition→action routes. Step 5's evaluator consumes this; do not re-serialize.

---

## 1. THE blocking decision (read before anything else)

**An "agent that signs SoDEX orders when triggers fire" cannot exist as pure
static frontend.** Two hard facts collide:

1. The web app is a **static export → Cloudflare Workers static assets. No Node
   runtime, no server loop.** (INTEGRATION.md §7, §2.)
2. Every order write is an **EIP-712 signature from the user's wallet**. MetaMask
   requires a human click per signature. You cannot autonomously sign with the
   user's primary key.

So a real run-loop needs ONE of these execution models. This choice gates all of Phase 1:

### Option A — Browser-resident runtime (wallet-in-the-loop)
A loop runs **in an open tab**: polls market data, evaluates `buildRoutesFromGraph`
triggers, and on a fire calls `placeBatchNewOrder` → MetaMask prompts the user to sign.
- ✅ Zero new infra, zero key custody, ships on the existing static deploy. **Honest** about being non-custodial.
- ❌ Not autonomous — user must approve each signature; tab must stay open. "Agent" is really "assistant".
- **Best for: hackathon demo. Provably real orders, no security story to defend.**

### Option B — Delegated session key (true autonomous agent)
Generate a **separate EVM keypair** (session/agent key); user authorizes it once;
the private key drives autonomous signing from a runtime that stays up:
- **B1 — key in browser (IndexedDB/encrypted):** loop still needs an open tab, but
  signs without per-order prompts. Half-real autonomy.
- **B2 — key server-side (FastAPI worker in `services/vega-backend`):** real 24/7
  agent. Needs key custody, encryption-at-rest, a worker process, and SoDEX
  whitelisting of the agent address. This is what INTEGRATION.md §7 ("agents are
  just EVM addresses that hold a delegated signing key") actually describes.
- ✅ Real autonomous execution.
- ❌ Custody risk + real backend + ops. Mainnet needs Buildathon whitelist per agent address.

**DECISION (2026-06-05):** ✅ **Option A — Wallet-in-loop** chosen. Build behind
`ExecutionStrategy` so B2 can drop in later. Phase 1 in progress.

**Recommendation:** Ship **Option A** as the demonstrably-real default (it proves the
full chain end-to-end with no hand-waving), and structure the run-loop behind an
`ExecutionStrategy` interface so **Option B2** drops in later without touching the
evaluator. Do NOT build B2 custody for the hackathon unless 24/7 autonomy is a
judged requirement — it's a security liability that adds days and risks the demo.

> ⚠️ This is the one question I need answered before Phase 1 work is real and not
> speculative. Everything else (steps 6, 7) is unblocked regardless.

---

## 2. Architecture seams

```
builder graph (xyflow)
   │  buildRoutesFromGraph()         ← exists
   ▼
StrategyRuntime (NEW, phase 1)
   ├─ market feed: fetchTickers/Orderbook/Trades (WS where available)   ← exists
   ├─ trigger evaluator: route.conditions → boolean                     ← NEW
   ├─ ExecutionStrategy (interface)                                     ← NEW seam
   │     ├─ WalletInLoop  → placeBatchNewOrder (MetaMask)   [Option A]  ← primitive exists
   │     └─ DelegatedKey  → placeBatchNewOrder (session key)[Option B]  ← later
   └─ execution log + state → runtime-events.ts / fleet-observability.ts (replace mock)
   ▼
PnL aggregator (phase 2): fetchAccountBalances + OrderHistory + UserTrades
   ▼
Social layer (phase 3): FastAPI + Supabase persists graph + run results + leaderboard
```

---

## 3. Phases (detailed files alongside)

| Phase | File | Outcome | Depends on |
|---|---|---|---|
| 1 | `phase-01-agent-run-loop.md` | Real `StrategyRuntime` that places real testnet orders from a builder graph | §1 decision |
| 2 | `phase-02-live-pnl-monitoring.md` | `/dashboard` shows real balances + agent-attributed PnL from SoDEX reads | none (parallelizable with 1) |
| 3 | `phase-03-social-backend.md` | FastAPI+Supabase persists strategies, runs, leaderboard; `/marketplace`,`/copy` read real data | 1, 2 for run data |

Phases 1 and 2 are independent and can run in parallel. Phase 3 needs real run/PnL
data from 1+2 to be meaningful, but its schema + endpoints can be built in parallel.

---

## 4. Risks / honest cautions

- **Static export kills `next dev`-only assumptions** — `AGENTS.md` warns this is a
  modified Next.js 16; read `node_modules/next/dist/docs/` before adding any server
  action / route handler. No SSR escape hatch in the Cloudflare static build.
- **No autonomous signing without custody** — don't pretend Option A is 24/7. Label it.
- **Mainnet whitelist** — write path on mainnet needs Buildathon whitelist per address;
  testnet (`testnet-gw.sodex.dev`) is open. Keep everything on testnet for the demo.
- **Orders are NOT L1 txs** — don't add ValueChain L1 calls to the execution path; L1
  is bridge-only (INTEGRATION.md §7.5). Already verified; don't regress it.
- **Backend is optional today** — turning on step 7 makes Supabase a hard dependency
  for those pages only. Keep `disable-missing-backend.ts` gating so the static demo
  still runs with the backend down.

---

## 5. Out of scope

- Custodial key infrastructure (Option B2) unless explicitly requested.
- Mainnet execution / per-agent whitelisting.
- Copy-trading fund flows (only metadata/leaderboard in phase 3).
