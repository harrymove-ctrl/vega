/**
 * /api/runs — run-reporting bridge.
 *
 * The browser-side {@link StrategyRuntime} (apps/web/src/lib/runtime/strategy-runtime.ts)
 * opens a run when it starts trading a bot, then patches a PnL/stop snapshot when
 * it stops or on each rollup tick. These rows are the source the leaderboard +
 * runtime-overviews aggregate over (manifest: "These feed the leaderboard").
 *
 * Contract:
 *   POST  /api/runs                     (auth) body {bot_id, started_at?, runtime_id?}      -> run row
 *   PATCH /api/runs/:id                 (auth) body {stopped_at?, realized_pnl?, ...}        -> run row
 *   GET   /api/runs?wallet_address=&bot_id=&limit=   (owner-scoped read)                     -> RunRecord[]
 *
 * Writes are gated on requireAuth and use the verified caller address (getAddress).
 * Reads are owner-scoped via the wallet_address query param. Non-2xx bodies are
 * `{ detail }` (the frontend's error convention).
 *
 * Response rows are snake_case and mirror the `runs` table columns the manifest
 * defines, so leaderboard/overview aggregators can read them field-for-field.
 */
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";

import type { AppEnv } from "../app";
import { getDb } from "../db/client";
import { runs, bots, users } from "../db/schema";
import { normalizeAddress, requireAuth } from "../auth";

const r = new Hono<AppEnv>();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** ISO timestamp used for server-side defaults. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Row shape returned to callers — snake_case, mirrors the `runs` columns. */
type RunRecord = {
  id: string;
  bot_id: string;
  runtime_id: string | null;
  owner_address: string;
  started_at: string;
  stopped_at: string | null;
  realized_pnl: number;
  unrealized_pnl: number;
  n_orders: number;
  summary: unknown;
  created_at: string;
};

type RunRow = typeof runs.$inferSelect;

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    bot_id: row.botId,
    runtime_id: row.runtimeId ?? null,
    owner_address: row.ownerAddress,
    started_at: row.startedAt,
    stopped_at: row.stoppedAt ?? null,
    realized_pnl: row.realizedPnl,
    unrealized_pnl: row.unrealizedPnl,
    n_orders: row.nOrders,
    summary: row.summary ?? null,
    created_at: row.createdAt,
  };
}

/** Coerce to a finite number or undefined (so we never persist NaN/Infinity). */
function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

/** Coerce to a non-negative integer or undefined. */
function asCount(value: unknown): number | undefined {
  const n = asFiniteNumber(value);
  if (n === undefined) return undefined;
  return Math.max(0, Math.trunc(n));
}

/**
 * Ensure a `users` row exists for the verified caller before inserting a run
 * (runs.owner_address FK -> users.wallet_address). The browser runtime may
 * report a run before any other write created the user row.
 */
async function ensureUser(db: ReturnType<typeof getDb>, address: `0x${string}`) {
  await db
    .insert(users)
    .values({ walletAddress: address })
    .onConflictDoNothing({ target: users.walletAddress });
}

// ---------------------------------------------------------------------------
// POST /api/runs — open a run (auth). body: { bot_id, started_at?, runtime_id? }
// ---------------------------------------------------------------------------
r.post("/", requireAuth, async (c) => {
  // requireAuth set c.var.address to the verified caller (manifest: getAddress(c)
  // returns exactly c.var.address). Read it directly to keep the concrete AppEnv
  // context type without the helper's narrower Context generic.
  const owner = c.var.address;

  let body: {
    bot_id?: unknown;
    started_at?: unknown;
    runtime_id?: unknown;
    summary?: unknown;
    realized_pnl?: unknown;
    unrealized_pnl?: unknown;
    n_orders?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const botId = typeof body.bot_id === "string" ? body.bot_id : "";
  if (!botId) return c.json({ detail: "bot_id is required" }, 400);

  const db = getDb(c.env);

  // The bot must exist and belong to the caller — never report runs for
  // someone else's bot (this is what the leaderboard attributes by).
  const bot = await db.query.bots.findFirst({ where: eq(bots.id, botId) });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);
  if (normalizeAddress(bot.ownerAddress) !== owner) {
    return c.json({ detail: "Not authorized for this bot" }, 403);
  }

  await ensureUser(db, owner);

  const startedAt =
    typeof body.started_at === "string" && body.started_at.length > 0
      ? body.started_at
      : nowIso();
  const runtimeId =
    typeof body.runtime_id === "string" && body.runtime_id.length > 0
      ? body.runtime_id
      : null;

  const id = crypto.randomUUID();
  const createdAt = nowIso();

  const [inserted] = await db
    .insert(runs)
    .values({
      id,
      botId,
      runtimeId,
      ownerAddress: owner,
      startedAt,
      realizedPnl: asFiniteNumber(body.realized_pnl) ?? 0,
      unrealizedPnl: asFiniteNumber(body.unrealized_pnl) ?? 0,
      nOrders: asCount(body.n_orders) ?? 0,
      summary: body.summary ?? null,
      createdAt,
    })
    .returning();

  return c.json(toRunRecord(inserted), 201);
});

// ---------------------------------------------------------------------------
// PATCH /api/runs/:id — update stop/PnL snapshot (auth).
// body (all optional): { stopped_at, realized_pnl, unrealized_pnl, n_orders, summary }
// ---------------------------------------------------------------------------
r.patch("/:id", requireAuth, async (c) => {
  const owner = c.var.address; // verified caller (see POST handler note)
  const id = c.req.param("id");

  let body: {
    stopped_at?: unknown;
    realized_pnl?: unknown;
    unrealized_pnl?: unknown;
    n_orders?: unknown;
    summary?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const db = getDb(c.env);

  const existing = await db.query.runs.findFirst({ where: eq(runs.id, id) });
  if (!existing) return c.json({ detail: "Run not found" }, 404);
  if (normalizeAddress(existing.ownerAddress) !== owner) {
    return c.json({ detail: "Not authorized for this run" }, 403);
  }

  const patch: Partial<typeof runs.$inferInsert> = {};

  if (typeof body.stopped_at === "string" && body.stopped_at.length > 0) {
    patch.stoppedAt = body.stopped_at;
  } else if (body.stopped_at === null) {
    patch.stoppedAt = null;
  }

  const realized = asFiniteNumber(body.realized_pnl);
  if (realized !== undefined) patch.realizedPnl = realized;

  const unrealized = asFiniteNumber(body.unrealized_pnl);
  if (unrealized !== undefined) patch.unrealizedPnl = unrealized;

  const nOrders = asCount(body.n_orders);
  if (nOrders !== undefined) patch.nOrders = nOrders;

  if ("summary" in body) patch.summary = body.summary ?? null;

  if (Object.keys(patch).length === 0) {
    // Nothing to change — return the current row rather than erroring.
    return c.json(toRunRecord(existing));
  }

  const [updated] = await db
    .update(runs)
    .set(patch)
    .where(eq(runs.id, id))
    .returning();

  return c.json(toRunRecord(updated));
});

// ---------------------------------------------------------------------------
// GET /api/runs?wallet_address=&bot_id=&limit= — recent runs, owner-scoped.
// ---------------------------------------------------------------------------
r.get("/", async (c) => {
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) {
    return c.json({ detail: "wallet_address is required" }, 400);
  }
  const owner = normalizeAddress(walletAddress);

  const botIdFilter = c.req.query("bot_id");
  const limitRaw = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.trunc(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const db = getDb(c.env);

  const where =
    botIdFilter && botIdFilter.length > 0
      ? and(eq(runs.ownerAddress, owner), eq(runs.botId, botIdFilter))
      : eq(runs.ownerAddress, owner);

  const rows = await db
    .select()
    .from(runs)
    .where(where)
    .orderBy(desc(runs.startedAt))
    .limit(limit);

  return c.json(rows.map(toRunRecord));
});

export { r as runsRouter };
