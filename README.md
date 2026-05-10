# Sosodex

> **Build Your One-Person On-Chain Finance Business with SoSoValue**
> ([Akindo Wave Hack](https://app.akindo.io/wave-hacks/JBEQXgN4Zi2jA3wA?tab=overview)).

Sosodex turns SoSoValue's research, indices, and on-chain orderbook into an
agentic platform. Be your own news agency, index publisher, and fund manager —
solo, on **ValueChain + SoDEX** spot orderbook trading.

---

## Hackathon brief

Build agentic finance applications with SoSoValue's APIs and other supporting
tools. Even a single-person team can build an application that functions as a
financial news agency, an index publisher, or a fund manager — and make it
available on-chain to users worldwide.

**Required**

- Genuine SoSoValue API integration
- Clear use case + real user value
- Complete flow from data input to actionable output
- Verifiable demo + documentation

**Bonus**

- SoDEX API integration
- AI-enhanced functionality
- Risk control / confirmations / security awareness
- Better UX (panels, bots, skills, automated workflows)

**Example directions**

- Signal-to-Execution Agent
- Opportunity Discovery Engine
- Strategy Assistant Bot
- Smart Research Dashboard
- Copy-Trading Support Tool

### Judging criteria

| Category                       | Weight | Focus                                                       |
| ------------------------------ | -----: | ----------------------------------------------------------- |
| User Value & Practical Impact  |    30% | Real-world value: insight, decisions, execution efficiency  |
| Functionality & Working Demo   |    25% | Clear functional demo of the core flow                      |
| Logic, Workflow & Product      |    20% | Logical product structure, solid analytical framework       |
| Data / API Integration         |    15% | How effectively SoSoValue + SoDEX + others are integrated   |
| UX & Clarity                   |    10% | Intuitive, easy to understand                               |

### Submission requirements

1. Project Overview — name, short description, target users, core logic, APIs, data sources
2. Public GitHub repo with README + setup
3. Public live demo
4. (Recommended) short video introduction
5. Team info
6. Wave progress changelog

---

## Stack

**Frontend** (`apps/web`)

- Next.js 16 App Router + TypeScript + Tailwind v4
- wagmi v2 + viem v2 + RainbowKit v2 + TanStack Query
- ValueChain (EVM-compatible L1 hosting SoDEX) configured via env
- shadcn/ui (Radix) components
- `@xyflow/react` visual graph builder, `lightweight-charts`, `framer-motion`, `lucide-react`

**Backend** (`services/sosodex-backend`)

- FastAPI + httpx async clients for SoSoValue / SoDEX
- Supabase (Postgres) + Alembic migrations
- AI copilot with Anthropic / OpenAI providers (tool-calling)
- Background workers: signal ingestion, agent runtime, copy execution

**Shared** (`packages/shared-types`)

- TS contracts mirrored across the web app: ETF, news, indices, agent graphs,
  backtest results.

---

## Monorepo layout

```
sosodex/
├── apps/web/                       ← Next.js dashboard
│   └── src/
│       ├── app/
│       │   ├── (app)/              ← authenticated app shell
│       │   │   ├── dashboard/      ← Welcome / overview
│       │   │   ├── research/       ← Smart Research Dashboard
│       │   │   ├── copilot/        ← AI Copilot (Strategy Assistant Bot)
│       │   │   ├── builder/        ← Visual Strategy Builder (xyflow)
│       │   │   ├── agents/         ← Deployed agents fleet
│       │   │   ├── backtests/      ← Backtesting Lab
│       │   │   ├── marketplace/    ← Creator Marketplace
│       │   │   ├── leaderboard/    ← Agent leaderboard + trust score
│       │   │   ├── copy/           ← Copy-Trading Support Tool
│       │   │   ├── telegram/       ← Telegram bot integration
│       │   │   └── analytics/      ← Performance analytics
│       │   ├── api/sosovalue/      ← Edge proxies for SoSoValue API
│       │   ├── layout.tsx          ← Wraps in <Providers>
│       │   ├── providers.tsx       ← Wagmi + Query + RainbowKit
│       │   └── page.tsx            ← Landing page
│       ├── components/             ← app/, builder/, ui/
│       └── lib/                    ← sosovalue.ts, sodex.ts, wagmi.ts, utils.ts
├── services/sosodex-backend/       ← FastAPI service
│   └── src/
│       ├── api/                    ← health, sosovalue, sodex routes
│       ├── core/                   ← Pydantic settings
│       ├── db/                     ← Supabase client
│       ├── services/               ← API clients, agent runtime, copilot
│       ├── workers/                ← background processes
│       └── main.py                 ← FastAPI app factory
├── packages/shared-types/          ← TS contracts
├── package.json                    ← workspace scripts
└── pnpm-workspace.yaml
```

---

## Quickstart

### Prerequisites

- Node 22+ and pnpm 10+
- Python 3.11+ (for the backend)
- A Supabase project (free tier works)
- API keys: SoSoValue, optionally SoDEX (apply via the [Buildathon access form](https://forms.gle/2nuJT2qNbUQsyyZy8)), Anthropic or OpenAI for the copilot, WalletConnect Cloud project ID

### Setup

```bash
git clone <this repo>
cd sosodex
cp .env.example .env.local                       # fill in keys
pnpm install                                      # web + shared-types

# backend
cd services/sosodex-backend
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
cd ../..
```

### Run

```bash
# terminal 1 — web
pnpm dev                                          # apps/web on :3000

# terminal 2 — backend
pnpm backend                                      # FastAPI on :8000
```

### Migrations

```bash
pnpm db:migration:new                             # create a revision
pnpm db:migrate                                   # apply against $DATABASE_URL
```

---

## Environment

| Var                                       | Where    | Notes                                                                                |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `SOSOVALUE_API_KEY`                       | both     | Server-only. [Docs](https://sosovalue-1.gitbook.io/sosovalue-api-doc).               |
| `SODEX_API_KEY`                           | both     | Mainnet needs Silver SoPoints rank or buildathon whitelist. Testnet is open.         |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`    | web      | [WalletConnect Cloud](https://cloud.walletconnect.com).                              |
| `NEXT_PUBLIC_VALUECHAIN_*`                | web      | Mainnet RPC / chainId / explorer for ValueChain. Fill from official docs.            |
| `NEXT_PUBLIC_VALUECHAIN_TESTNET_*`        | web      | Testnet equivalent.                                                                  |
| `SUPABASE_URL` / `*_KEY`                  | backend  | Supabase project URL + service-role key.                                             |
| `DATABASE_URL`                            | backend  | Postgres connection string for Alembic.                                              |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`    | backend  | At least one for the AI copilot.                                                     |

See `.env.example` for the full list.

---

## Roadmap (per judging weights)

### Wave 1 — foundations (this commit)

- Monorepo + design system + landing + 11 page stubs
- API proxies for SoSoValue + SoDEX (web edge + FastAPI)
- Wallet connect with ValueChain support
- TS contracts for agents, backtests, ETF/news, indices

### Wave 2 — Smart Research Dashboard

Hits *User Value* (30%) + *Data Integration* (15%). Live ETF flow, SSI index
panels, AI news digest with sentiment.

### Wave 3 — Strategy Builder + Backtest Lab

Hits *Logic / Workflow* (20%) + *UX* (10%). xyflow graph editor saves to
Supabase; backtest service replays SoSoValue history with lightweight-charts.

### Wave 4 — Agents on SoDEX (testnet)

Hits *Functionality / Working Demo* (25%). Deploy a strategy graph, sign a
delegated authorization, runtime worker executes against SoDEX testnet,
Telegram alerts + manual approval gate above a threshold.

### Wave 5 — Copy + Marketplace + Leaderboard

Network-effect features. Trust score, mirror execution, fork-and-tune flows.

---

## Demo materials

- Live demo: _coming soon_
- Video walkthrough: _coming soon_
- Architecture diagram: see `apps/web/src/app/(app)/builder/` for the visual
  language; full diagram lives in the eventual `docs/` directory.

---

## License

MIT.
