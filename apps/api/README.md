# @vega/api

The Vega backend: a **separate Cloudflare Worker** (Hono + Drizzle ORM + D1/SQLite).
It does **not** touch the static frontend at `apps/web`. The frontend calls it at
`${NEXT_PUBLIC_API_BASE_URL}/api/*`; CORS reflects the request origin and allows
`Authorization`, so the static site (a different origin) can send bearer sessions.

## Layout

```
src/
  index.ts            # Worker entry: export default { fetch: app.fetch }; Env type
  app.ts              # Hono app: CORS, /healthz, mounts every router at /api/*
  auth/index.ts       # signed-challenge auth: nonce/verify, HMAC sessions, requireAuth
  db/
    schema.ts         # Drizzle SQLite schema for ALL resources (+ `schema` barrel)
    client.ts         # getDb(env) -> drizzle(env.DB, { schema })
  routes/<name>.ts    # one Hono sub-router per resource (auth is fully implemented)
drizzle/              # generated SQL migrations (db:generate output)
wrangler.jsonc        # Worker + D1 binding config
drizzle.config.ts     # drizzle-kit (sqlite, schema-only)
```

## Prerequisites

- `pnpm install` at the repo root (installs this workspace package + deps).
- `wrangler login` (for any remote/deploy step).

## Local development

```bash
# 1. Create the D1 database (once). Copy the printed database_id…
wrangler d1 create vega-db

# 2. …and paste it into wrangler.jsonc -> d1_databases[0].database_id
#    (replace "REPLACE_AFTER_d1_create").

# 3. Generate the SQL migration from the Drizzle schema.
pnpm --filter @vega/api db:generate     # == drizzle-kit generate -> ./drizzle

# 4. Apply migrations to the LOCAL D1 (miniflare).
pnpm --filter @vega/api db:migrate:local

# 5. Set the auth secret for local dev (writes .dev.vars).
echo 'AUTH_SECRET="dev-only-change-me"' >> .dev.vars

# 6. Run the Worker locally.
pnpm --filter @vega/api dev             # == wrangler dev  (http://localhost:8787)
```

Point the frontend at it with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8787`
(and `NEXT_PUBLIC_DEMO_MODE=0` to bypass the demo-stub fetch interceptor).

## Deploy (user's Cloudflare account)

```bash
wrangler login
pnpm --filter @vega/api db:generate                    # if schema changed
pnpm --filter @vega/api deploy                          # == wrangler deploy
wrangler d1 migrations apply vega-db --remote           # apply migrations to prod D1

# Set the production HMAC secret (NOT in wrangler.jsonc [vars]):
wrangler secret put AUTH_SECRET
# Resource secrets, when their routers land:
#   wrangler secret put TELEGRAM_BOT_TOKEN
#   wrangler secret put ANTHROPIC_API_KEY
```

## Typecheck

```bash
pnpm --filter @vega/api typecheck       # == tsc --noEmit
```

## Auth model (contract §3)

1. `GET /api/auth/nonce?address=0x…` → `{ address, nonce, message, expiresAt }`.
2. Client `personal_sign`s `message` (= `Vega auth: <nonce>`).
3. `POST /api/auth/verify { address, signature }` → `{ address, token }`.
4. Send `Authorization: Bearer <token>` on every authed call. Write endpoints use
   the `requireAuth` middleware, which verifies the HMAC token and exposes the
   caller via `getAddress(c)` — handlers **never** trust a header-supplied address.
