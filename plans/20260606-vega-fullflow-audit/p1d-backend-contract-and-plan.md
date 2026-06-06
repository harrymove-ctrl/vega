# P1-D — Backend: full `/api/*` contract + build plan (Cloudflare deploy)

**Date:** 2026-06-06 · **Constraint:** deploy on **Cloudflare via wrangler CLI (user's account)** — NOT Railway. No backend code yet; this is the contract + plan.

---

## 0. The architecture decision (read first — it changes everything)

The frontend posts to `${NEXT_PUBLIC_API_BASE_URL}/api/*` (default `http://localhost:8000`). The existing `services/vega-backend` is **FastAPI (Python)** and implements only 5 read proxies — none of the `/api/*` resources below.

**Cloudflare cannot run FastAPI/uvicorn well** (Workers is JS/WASM; Python Workers are beta and won't carry SQLAlchemy/asyncpg). And the web app is **`output: "export"` (pure static)** — so Next.js route handlers do **not** run today either.

Two real Cloudflare-native paths:

| Option | What | Pros | Cons |
|---|---|---|---|
| **A (recommended) — Next Route Handlers on OpenNext** | Drop `output:"export"`, switch the web app to full OpenNext server mode (the `wrangler.jsonc` already points at `.open-next/worker.js`). Implement `/api/*` as App-Router **Route Handlers** (`app/api/.../route.ts`) hitting Supabase Postgres. Co-deployed on the **same Worker** via `wrangler deploy`. | One deploy, **same-origin** (`NEXT_PUBLIC_API_BASE_URL=""` → no CORS, no localhost, **delete `disable-missing-backend.ts`**). Server secrets stay server-side. TypeScript end-to-end (reuse `sodex-trade.ts`/types). | Loses pure-static cold-start; must verify every page still builds under OpenNext server mode; `images.unoptimized` + `trailingSlash` interplay. |
| **B — Hono Worker (separate service)** | A second Cloudflare Worker (Hono + Drizzle) on a `api.vega…` route, D1 or Supabase via Hyperdrive. | Keeps the static frontend; clean separation. | Second deploy + CORS again; duplicate types. |

> **Recommendation: Option A.** It deletes the entire mock layer (the demo-stub monkey-patch exists *only* because there's no same-origin backend), is a single `wrangler deploy` to the user's account, and reuses the TS types. The cost is migrating off static export — a real but contained change. **This decision should be confirmed before any code.**

---

## 1. Full `/api/*` contract (every call site the frontend makes)

Enumerated from `src/lib/*` and `src/components/*`. Shapes are the ones components actually dereference (from the stub shapes in `disable-missing-backend.ts` + the TS types).

### Bots / fleet (`/builder`, `/bots`)
| Method | Path | Request | Response | Consumer |
|---|---|---|---|---|
| GET | `/api/bots?wallet_address=` | — | `BotFleetItem[]` | bots-fleet-page |
| POST | `/api/bots` | draft payload (name, rules_json, visibility, market_scope…) | `{ id }` | builder persistBotDraft |
| PATCH | `/api/bots/:id?wallet_address=` | draft payload | `{ id }` | builder update |
| POST | `/api/bots/validate` | `{ authoring_mode, visibility, rules_version, rules_json }` | `{ valid, issues[] }` | builder |
| POST | `/api/bots/:id/deploy` | runtime controls/policy | `{ status, runtime_id }` | bots/builder deploy |
| GET | `/api/bots/runtime-overviews?wallet_address=&include_performance=&performance_mode=` | — | `{ bots[], runtimes[], summary }` (BotRuntimeOverview) | bots-fleet-page |

### Builder
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/builder/templates` | `BuilderTemplate[]` | builder |
| POST | `/api/builder/validate` | `{ errors[], warnings[] }` | builder |
| POST | `/api/builder/simulate` | sim result | builder |
| POST | `/api/builder/ai-chat/jobs` → GET `/api/builder/ai-chat/jobs/:id` | `{ id }` then `{ id, status, errorDetail?, result? }` (poll) | builder AI tab |

### Copilot (`/copilot`)
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/copilot/conversations` ; `/:id` | `Conversation[]` ; `Conversation` | copilot-page |
| POST | `/api/copilot/chat/jobs` → GET `/api/copilot/chat/jobs/:id` | `{ id }` then poll `{ status, result }` | copilot-page (see P1-E for the Anthropic tool loop) |

### Marketplace (`/marketplace`, `/leaderboard`)
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/marketplace/overview` | `{ discover[], featured[], creators[] }` | marketplace |
| GET | `/api/marketplace/discover` ; `/featured` ; `/creators` ; `/creators/:id` | lists / profile | marketplace, leaderboard |
| POST | `/api/marketplace/publishing/...` | publish result | bot-publishing-panel |

### Bot-copy / copy-trading (`/copy`)
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/bot-copy/dashboard` | `{ follows[], positions[], activity[], discover[], baskets_summary{}, summary{active_follows,open_positions,copied_open_notional_usd,copied_unrealized_pnl_usd,copied_realized_pnl_usd_24h}, readiness{} }` | copy-trading-overview |
| GET | `/api/bot-copy/leaderboard` ; `/leaderboard/candidates` ; `/leaderboard/:id` | ranked lists | copy |
| GET | `/api/bot-copy/creators/:id` | creator profile | copy |
| POST | `/api/bot-copy/mirror` ; `/clone` ; `/preview` | mirror/clone/preview result | bot-mirror/clone modals |
| GET/POST | `/api/bot-copy/runtime/...` | copy runtime state | copy |

### Portfolios (`/copy` baskets)
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/portfolios` ; `/:id` | `{ portfolios[], summary }` | portfolio-basket-composer |
| POST | `/api/portfolios` | created basket | composer |

### Backtests (`/backtests`)
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/backtests/bootstrap` | `{ strategies[], markets[], runs[], jobs[], bots[] }` | backtesting-lab-page |
| POST | `/api/backtests/runs` → GET `/api/backtests/runs/:id`, `/runs/jobs/:id` | run + job poll | backtesting-lab-page |

### Telegram (`/telegram`)
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/telegram?wallet_address=` | `TelegramConnectionStatus` (telegram.ts:15) | telegram-page |
| POST | `/api/telegram/link` ; `/preferences` ; `/test` ; `/disconnect` | updated status | telegram-page |
| POST | `/api/telegram/webhook` | Telegram inbound (Bot API) | server-only |

### Readiness (`/onboarding`, `/bots`, `/builder`)
| Method | Path | Response | Consumer |
|---|---|---|---|
| GET | `/api/sodex/readiness?wallet_address=` | `SoDEXReadinessPayload` (wallet_address, ready, blockers[], metrics{}, steps[]) | onboarding, deploy gate |

---

## 2. Data model (Supabase Postgres)

```
users            (wallet_address PK, created_at, last_seen)
strategies/bots  (id, owner_address FK, name, description, visibility,
                  market_scope, rules_json JSONB, rules_version, status,
                  created_at, updated_at)
bot_runtimes     (id, bot_id FK, owner_address, status, runtime_kind,   -- 'wallet-in-loop'
                  started_at, stopped_at, last_heartbeat, summary JSONB)
runs             (id, bot_id FK, owner_address, started_at, stopped_at,
                  realized_pnl, unrealized_pnl, n_orders, summary JSONB)  -- reported by StrategyRuntime
marketplace_listings (id, bot_id FK, creator_address, headline, stats JSONB,
                      featured bool, published_at)
copies           (id, source_bot_id FK, copier_address, mode, created_at)  -- metadata only, no fund flow
portfolios       (id, owner_address, name, legs JSONB, created_at)
telegram_links   (wallet_address PK, chat_id, telegram_username, connected,
                  notifications_enabled, notification_prefs JSONB, token_configured…)
backtest_runs    (id, owner_address, bot_id, params JSONB, status, result JSONB)
```
Leaderboard = view/query over `runs`+`bots` ranked by realized_pnl in a window.

---

## 3. Auth (replaces the spoofable `Bearer wagmi:<addr>`)

`vega-auth.ts:71` currently sends `Authorization: Bearer wagmi:<address>` — an unsigned plaintext address. Replace with a **signed challenge** (same EIP-712 identity model SoDEX uses):
1. `GET /api/auth/nonce?address=` → server-issued nonce.
2. Client `personal_sign`/EIP-712 signs `vega-auth:<nonce>`.
3. `POST /api/auth/verify` → server `recoverAddress`, issues a short-lived signed session token (JWT or signed cookie).
4. Route handlers verify the token and trust `owner_address`. **Any write must be gated on this** — never trust a header address.

---

## 4. Build phases (Option A)

| # | Step | Files | Effort |
|---|---|---|---|
| 1 | **Decision + spike**: drop `output:"export"`, build the app under OpenNext server mode, confirm all 26 pages still render + `wrangler dev` serves. | `next.config.ts`, `wrangler.jsonc`, `open-next.config.ts` | M |
| 2 | Supabase project + schema migrations + a typed DB client (Drizzle or `postgres` + Hyperdrive binding). | `apps/web/src/server/db/*`, `drizzle/` | M |
| 3 | Signed-challenge auth route handlers + `vega-auth.ts` client rewrite. | `app/api/auth/*`, `lib/vega-auth.ts` | M |
| 4 | Bots resource (CRUD + validate + deploy-record + runtime-overviews). | `app/api/bots/**` | L |
| 5 | Run-reporting bridge: `StrategyRuntime` POSTs run start/stop + PnL snapshots → `/api/runs`. | `lib/runtime/strategy-runtime.ts`, `app/api/runs/*` | M |
| 6 | Marketplace + leaderboard (read views over runs/listings) + publish. | `app/api/marketplace/**` | M |
| 7 | Bot-copy + portfolios (metadata only — no fund flow). | `app/api/bot-copy/**`, `app/api/portfolios/**` | M |
| 8 | Telegram (status/link/prefs/test + webhook) — needs `TELEGRAM_BOT_TOKEN`. | `app/api/telegram/**` | M |
| 9 | Readiness (`/api/sodex/readiness`) computed from real SoDEX account + chain reads (reuse `sodex-public.ts`/`sodex-readiness.ts`). | `app/api/sodex/readiness/*` | S |
| 10 | Backtests runs (queue + compute over SoDEX klines). | `app/api/backtests/**` | L |
| 11 | Flip `NEXT_PUBLIC_API_BASE_URL=""` (same-origin), **delete `disable-missing-backend.ts`**, remove demo-stub branches. | env, `lib/disable-missing-backend.ts` | S |
| 12 | `wrangler deploy` to the user's Cloudflare account; set Supabase/Hyperdrive bindings + secrets. | `wrangler.jsonc`, CF dashboard/CLI | M |

Copilot LLM loop = separate P1-E (Anthropic tool-calling in `/api/copilot/chat`).

---

## 5. Risks
- **Static→server migration** is the gating risk: confirm OpenNext server build serves every existing page before building APIs (Step 1 is a spike, not a commitment).
- **Supabase from Workers** needs Hyperdrive (or the HTTP `@supabase/supabase-js`) — direct TCP Postgres isn't available on Workers without it.
- **Demo deletion**: removing `disable-missing-backend.ts` means every page now hits real handlers — ship handlers for the full contract above or pages 500. Keep a feature flag during rollout.
- **Auth migration** must land before any write endpoint is trusted.
- Don't reuse the FastAPI `services/vega-backend` for this path — it can't deploy on Cloudflare; either retire it or keep it only as a local higher-rate-limit proxy.
