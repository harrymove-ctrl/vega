# Phase 3 — Social layer backend (lifecycle step 7)

**Goal:** Persist strategy graphs, agent run results, and a leaderboard so
`/marketplace`, `/leaderboard`, `/copy` read **real shared data** instead of mock.
Backed by the existing optional FastAPI service + Supabase.

**Depends on:** Phases 1–2 for real run/PnL data to display. Schema + endpoints can
be built in parallel; only the *populated* leaderboard needs real runs.

## Existing pieces
- `services/vega-backend` — FastAPI, Supabase client (`src/db/supabase.py`),
  Alembic migrations (`db/migrations`), routers under `/v1` (`main.py:24-26`).
  Today only `health`, `sosovalue`, `sodex` (stub `/markets`,`/orderbook`).
- `disable-missing-backend.ts` — frontend gate that keeps the static demo alive when
  backend is down. **Keep this gating** so the Cloudflare-only deploy still runs.

## Tasks
1. **Schema + migrations** (`services/vega-backend/db/migrations`)
   - `strategies` (id, owner_address, graph_json, name, visibility, created_at)
   - `agent_runs` (id, strategy_id, owner_address, status, started_at, stopped_at, summary_json)
   - `agent_results` (run_id, realized_pnl, unrealized_pnl, fees, n_orders, last_synced)
   - `copies` (id, source_strategy_id, copier_address, created_at) — metadata only, no fund flow.
   - Index leaderboard query: `agent_results` by realized_pnl desc within window.
2. **API routers** (`services/vega-backend/src/api/`)
   - `strategies.py`: `POST /v1/strategies` (publish graph), `GET /v1/strategies`,
     `GET /v1/strategies/{id}` (fork into builder).
   - `leaderboard.py`: `GET /v1/leaderboard?window=` — ranked from `agent_results`.
   - `runs.py`: `POST /v1/runs` + `PATCH /v1/runs/{id}` — frontend StrategyRuntime
     reports lifecycle + PnL snapshots (auth = signed message from owner_address;
     reuse EIP-712 verify pattern server-side, mirror SoDEX signer-as-identity model).
   - Register all in `main.py` under `/v1`.
3. **Auth** — verify the owner via wallet signature (no passwords; identity = EVM
   address, consistent with INTEGRATION.md §7). Reuse `vega-auth.ts` on the client.
4. **Frontend wiring**
   - `/marketplace`, `/leaderboard`: fetch from new endpoints behind the
     `disable-missing-backend` gate (graceful mock fallback when backend absent).
   - `/builder`: "publish" action → `POST /strategies`; "fork" → `buildGraphFromAiDraft`
     / load `graph_json` into the canvas.
   - `/copy`: list + record copy metadata.
5. **Run reporting bridge** — Phase 1 `StrategyRuntime` posts run start/stop + Phase 2
   PnL snapshots to `/v1/runs`. This is the only coupling between phases.

## Acceptance
- Publish a graph from `/builder` → appears in `/marketplace` for another session/address.
- A running agent's PnL surfaces on `/leaderboard`.
- Backend down → pages fall back to the existing gated mock, static demo still boots.
- Backend tests (pytest, `services/vega-backend/tests`) cover the new routers.

## Est. effort
Schema + routers + auth: ~2 days. Frontend wiring: ~1 day.

## Caution
Read `node_modules/next/dist/docs/` before adding any client data-fetching pattern —
static export constrains how/where fetches run (no server actions in the Cloudflare build).
