# vega-backend

FastAPI service for vega. Proxies SoSoValue + SoDEX, hosts the AI copilot,
runs background workers (signal ingestion, agent runtime, copy execution),
and persists state to Supabase Postgres.

## Quickstart

```bash
cd services/vega-backend
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
cp ../../.env.example .env.local   # fill SUPABASE_*, DATABASE_URL, SOSOVALUE_API_KEY, etc.

uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

## Layout

```
services/vega-backend/
├── alembic.ini
├── db/migrations/        ← Alembic
├── pyproject.toml
├── src/
│   ├── api/              ← FastAPI route modules
│   ├── core/config.py    ← Pydantic settings
│   ├── db/               ← Supabase + SQLAlchemy
│   ├── middleware/
│   ├── models/           ← Pydantic + SQLAlchemy models
│   ├── services/         ← SoSoValueClient, SoDEXClient, copilot, agent runtime…
│   ├── workers/          ← background processes
│   └── main.py           ← FastAPI app factory
└── tests/
```

## Endpoints (current)

- `GET /healthz`
- `GET /v1/sosovalue/etf`
- `GET /v1/sosovalue/news?currency=BTC`
- `GET /v1/sodex/markets`
- `GET /v1/sodex/orderbook?symbol=BTC-USD`

## Migrations

```bash
pnpm db:migration:new   # creates a revision under db/migrations/versions/
pnpm db:migrate         # alembic upgrade head against $DATABASE_URL
```
