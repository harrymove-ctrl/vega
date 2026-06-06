/**
 * /api/bots — bot fleet CRUD + validate + deploy-record + runtime overviews.
 *
 * Consumers (response shapes are dereferenced verbatim by these files):
 *   - apps/web/src/lib/fleet-observability.ts          (BotFleetItem[], runtime-overviews map)
 *   - apps/web/src/components/bots/bots-fleet-page.tsx  (deploy/resume/stop -> RuntimeSummary,
 *                                                        runtime-overviews -> Record<id,{performance}>)
 *   - apps/web/src/components/builder/builder-graph-studio.tsx (list, GET :id, GET :id/runtime-overview,
 *                                                        POST / PATCH -> {id})
 *   - apps/web/src/components/builder/bot-validation-panel.tsx (validate -> {valid, issues[]})
 *   - apps/web/src/lib/disable-missing-backend.ts       (the demo-stub shapes we mirror)
 *
 * Owner-scoped reads take a `wallet_address` query param (no session needed to
 * read your own fleet on the static frontend). Every write goes through
 * requireAuth and trusts ONLY the verified caller address from getAddress(c) —
 * never a wallet_address from the query/body.
 *
 * IMPORTANT — runtime-overviews shape: the stub sketch said
 * `{bots,runtimes,summary}`, but BOTH real consumers (fleet-observability.ts:261
 * and bots-fleet-page.tsx:376) dereference it as `Record<botId, RuntimeOverview>`
 * (they do `overviewByBot[bot.id]?.performance`). We return that map — the only
 * shape that doesn't break those pages.
 */
import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppEnv } from "../app";
import { getDb, schema } from "../db/client";
import { getAddress, normalizeAddress, requireAuth } from "../auth";

const { users, bots, botRuntimes } = schema;

const r = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/** Live runtime statuses surface a `runtime` block on the fleet row. */
const LIVE_RUNTIME_STATUSES = new Set(["active", "paused"]);

type BotRow = typeof bots.$inferSelect;
type RuntimeRow = typeof botRuntimes.$inferSelect;

/** Ensure a users row exists so FK references (bots.owner_address) hold. */
async function ensureUser(
  db: ReturnType<typeof getDb>,
  address: `0x${string}`,
): Promise<void> {
  await db
    .insert(users)
    .values({ walletAddress: address })
    .onConflictDoUpdate({
      target: users.walletAddress,
      set: { lastSeen: nowIso() },
    });
}

/**
 * The latest runtime per bot, mapped to fleet-observability.ts:RuntimeSummary:
 *   { id, status, mode, updated_at, deployed_at?, stopped_at? }
 */
function toRuntimeSummary(runtime: RuntimeRow) {
  return {
    id: runtime.id,
    status: runtime.status,
    mode: runtime.mode,
    updated_at: runtime.updatedAt,
    deployed_at: runtime.startedAt,
    stopped_at: runtime.stoppedAt,
  };
}

/**
 * Pull a BotPerformance snapshot out of a runtime's stored summary JSON if one
 * was reported by a StrategyRuntime; otherwise null. Shape matches
 * apps/web/src/lib/bot-performance.ts:BotPerformance.
 */
function performanceFromRuntime(
  runtime: RuntimeRow | undefined,
): {
  pnl_total: number;
  pnl_total_pct: number;
  pnl_realized: number;
  pnl_unrealized: number;
  win_streak: number;
  positions: Array<{
    symbol: string;
    side: string;
    amount: number;
    entry_price: number;
    mark_price: number;
    unrealized_pnl: number;
  }>;
} | null {
  if (!runtime || !runtime.summary || typeof runtime.summary !== "object") {
    return null;
  }
  const summary = runtime.summary as Record<string, unknown>;
  const perf = summary.performance;
  if (!perf || typeof perf !== "object") return null;
  const p = perf as Record<string, unknown>;
  return {
    pnl_total: Number(p.pnl_total ?? 0),
    pnl_total_pct: Number(p.pnl_total_pct ?? 0),
    pnl_realized: Number(p.pnl_realized ?? 0),
    pnl_unrealized: Number(p.pnl_unrealized ?? 0),
    win_streak: Number(p.win_streak ?? 0),
    positions: Array.isArray(p.positions)
      ? (p.positions as Array<Record<string, unknown>>).map((pos) => ({
          symbol: String(pos.symbol ?? ""),
          side: String(pos.side ?? ""),
          amount: Number(pos.amount ?? 0),
          entry_price: Number(pos.entry_price ?? 0),
          mark_price: Number(pos.mark_price ?? 0),
          unrealized_pnl: Number(pos.unrealized_pnl ?? 0),
        }))
      : [],
  };
}

/**
 * Map a bots row + its latest runtime to a BotFleetItem
 * (apps/web/src/lib/fleet-observability.ts:20).
 */
function toFleetItem(
  bot: BotRow,
  runtime: RuntimeRow | undefined,
  includePerformance: boolean,
) {
  const liveRuntime =
    runtime && LIVE_RUNTIME_STATUSES.has(runtime.status) ? runtime : null;
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    wallet_address: bot.ownerAddress,
    visibility: bot.visibility,
    authoring_mode: bot.authoringMode,
    strategy_type: bot.strategyType,
    market_scope: bot.marketScope,
    updated_at: bot.updatedAt,
    runtime: liveRuntime ? toRuntimeSummary(liveRuntime) : null,
    performance: includePerformance ? performanceFromRuntime(runtime) : null,
  };
}

/** Latest runtime per bot id from a flat runtime list (ordered desc by createdAt). */
function latestRuntimeByBot(runtimeRows: RuntimeRow[]): Map<string, RuntimeRow> {
  const map = new Map<string, RuntimeRow>();
  for (const rt of runtimeRows) {
    if (!map.has(rt.botId)) map.set(rt.botId, rt); // first seen = latest (desc order)
  }
  return map;
}

/** Build a RuntimeOverview (runtime-overview.ts) from a runtime row. */
function buildOverview(runtime: RuntimeRow) {
  const summary =
    runtime.summary && typeof runtime.summary === "object"
      ? (runtime.summary as Record<string, unknown>)
      : {};
  const metricsRaw =
    summary.metrics && typeof summary.metrics === "object"
      ? (summary.metrics as Record<string, unknown>)
      : {};
  return {
    health: {
      runtime_id: runtime.id,
      health: LIVE_RUNTIME_STATUSES.has(runtime.status) ? "healthy" : "idle",
      status: runtime.status,
      mode: runtime.mode,
      last_runtime_update: runtime.updatedAt,
      last_event_at: runtime.lastHeartbeat,
      heartbeat_age_seconds: null,
      error_rate_recent: Number(metricsRaw.error_rate_recent ?? 0),
      reasons: [],
    },
    metrics: {
      runtime_id: runtime.id,
      status: runtime.status,
      uptime_seconds: null,
      window_hours: 24,
      events_total: Number(metricsRaw.events_total ?? 0),
      actions_total: Number(metricsRaw.actions_total ?? 0),
      actions_success: Number(metricsRaw.actions_success ?? 0),
      actions_error: Number(metricsRaw.actions_error ?? 0),
      actions_skipped: Number(metricsRaw.actions_skipped ?? 0),
      success_rate: Number(metricsRaw.success_rate ?? 0),
      status_counts: {},
      event_type_counts: {},
      failure_reasons: [],
      recent_failures: [],
      last_event_at: runtime.lastHeartbeat,
    },
    performance: performanceFromRuntime(runtime),
  };
}

/**
 * Validate the rules_json the builder produces. We keep this permissive (the
 * builder also runs its own client-side checks) but reject the cases that would
 * make a strategy un-runnable, returning every problem as a human string so the
 * panel/builder can render `issues.map(...)`.
 */
function validateRules(body: {
  authoring_mode?: unknown;
  visibility?: unknown;
  rules_version?: unknown;
  rules_json?: unknown;
}): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const rules = body.rules_json;
  if (rules === null || rules === undefined) {
    issues.push("rules_json is required.");
    return { valid: false, issues };
  }
  if (typeof rules !== "object" || Array.isArray(rules)) {
    issues.push("rules_json must be an object.");
    return { valid: false, issues };
  }

  const rulesObj = rules as Record<string, unknown>;

  // A runnable visual strategy needs at least one condition or an editor/graph
  // payload the runtime can compile. The builder stores these under
  // `graph` / `editor_graph` (PortableBuilderGraph) and/or `conditions`/`actions`.
  const hasGraph =
    (typeof rulesObj.graph === "object" && rulesObj.graph !== null) ||
    (typeof rulesObj.editor_graph === "object" && rulesObj.editor_graph !== null);
  const conditions = rulesObj.conditions;
  const actions = rulesObj.actions;
  const hasConditions = Array.isArray(conditions) && conditions.length > 0;
  const hasActions = Array.isArray(actions) && actions.length > 0;

  if (!hasGraph && !hasConditions && !hasActions) {
    issues.push(
      "Strategy has no rules yet — add at least one condition and action before saving.",
    );
  }
  if (!hasGraph && hasConditions && !hasActions) {
    issues.push("Add at least one action — conditions on their own never trade.");
  }

  if (
    body.rules_version !== undefined &&
    body.rules_version !== null &&
    (typeof body.rules_version !== "number" ||
      !Number.isFinite(body.rules_version))
  ) {
    issues.push("rules_version must be a number.");
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// SPECIFIC routes FIRST — Hono matches in registration order, so these must be
// declared before the parameterized `/:id` routes or `:id` would swallow them.
// ---------------------------------------------------------------------------

/**
 * GET /api/bots/runtime-overviews?wallet_address=&include_performance=&performance_mode=
 * -> Record<botId, RuntimeOverview>  (apps/web/src/lib/runtime-overview.ts)
 *
 * Real consumers index this by bot id and read `.performance` (fleet page) and
 * `.health` / `.metrics` (runtime cards). One entry per bot that has any runtime.
 */
r.get("/runtime-overviews", async (c) => {
  const wallet = c.req.query("wallet_address");
  if (!wallet) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(wallet);
  const db = getDb(c.env);

  const ownedBots = await db
    .select()
    .from(bots)
    .where(eq(bots.ownerAddress, owner));
  if (ownedBots.length === 0) return c.json({});

  const botIds = ownedBots.map((b) => b.id);
  const runtimeRows = await db
    .select()
    .from(botRuntimes)
    .where(inArray(botRuntimes.botId, botIds))
    .orderBy(desc(botRuntimes.createdAt));
  const latest = latestRuntimeByBot(runtimeRows);

  const overviews: Record<string, ReturnType<typeof buildOverview>> = {};
  for (const bot of ownedBots) {
    const runtime = latest.get(bot.id);
    if (!runtime) continue; // overviews only for bots with a runtime
    overviews[bot.id] = buildOverview(runtime);
  }
  return c.json(overviews);
});

/**
 * POST /api/bots/validate  { authoring_mode, visibility, rules_version, rules_json }
 * -> { valid, issues[] }   (bot-validation-panel.tsx, builder persistBotDraft)
 *
 * No auth: validation is a pure shape check the builder runs pre-save.
 */
r.post("/validate", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }
  return c.json(validateRules(body));
});

// ---------------------------------------------------------------------------
// LIST + CREATE
// ---------------------------------------------------------------------------

/**
 * GET /api/bots?wallet_address=&include_performance= -> BotFleetItem[]
 * Owner-scoped. `include_performance=true` hydrates each row's performance from
 * its latest runtime summary; otherwise performance is null (the fleet page
 * fetches it separately via runtime-overviews).
 */
r.get("/", async (c) => {
  const wallet = c.req.query("wallet_address");
  if (!wallet) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(wallet);
  const includePerformance = c.req.query("include_performance") === "true";
  const db = getDb(c.env);

  const ownedBots = await db
    .select()
    .from(bots)
    .where(eq(bots.ownerAddress, owner))
    .orderBy(desc(bots.updatedAt));
  if (ownedBots.length === 0) return c.json([]);

  const botIds = ownedBots.map((b) => b.id);
  const runtimeRows = await db
    .select()
    .from(botRuntimes)
    .where(inArray(botRuntimes.botId, botIds))
    .orderBy(desc(botRuntimes.createdAt));
  const latest = latestRuntimeByBot(runtimeRows);

  const items = ownedBots.map((bot) =>
    toFleetItem(bot, latest.get(bot.id), includePerformance),
  );
  return c.json(items);
});

/**
 * POST /api/bots -> { id }   (builder persistBotDraft, create)
 * Auth required. Owner = verified caller (the body's wallet_address is ignored
 * for trust — we only honor the session address).
 */
r.post("/", requireAuth, async (c) => {
  const owner = getAddress(c);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ detail: "name is required" }, 400);

  const db = getDb(c.env);
  await ensureUser(db, owner);

  const id = crypto.randomUUID();
  const ts = nowIso();
  await db.insert(bots).values({
    id,
    ownerAddress: owner,
    name,
    description: typeof body.description === "string" ? body.description : "",
    visibility:
      typeof body.visibility === "string" ? body.visibility : "private",
    authoringMode:
      typeof body.authoring_mode === "string" ? body.authoring_mode : "visual",
    strategyType:
      typeof body.strategy_type === "string" ? body.strategy_type : "custom",
    marketScope: typeof body.market_scope === "string" ? body.market_scope : "",
    rulesJson: (body.rules_json ?? null) as unknown,
    rulesVersion: typeof body.rules_version === "number" ? body.rules_version : 1,
    status: "draft",
    createdAt: ts,
    updatedAt: ts,
  });

  return c.json({ id });
});

// ---------------------------------------------------------------------------
// PARAMETERIZED routes — single bot, deploy, lifecycle actions
// ---------------------------------------------------------------------------

/**
 * GET /api/bots/:id/runtime-overview?wallet_address= -> RuntimeOverview
 * (builder loads this alongside the bot; reads .health.runtime_id/.status).
 * Owner-scoped. Returns an idle overview when the bot has no runtime yet.
 *
 * Registered before GET /:id so the more specific path wins.
 */
r.get("/:id/runtime-overview", async (c) => {
  const id = c.req.param("id");
  const wallet = c.req.query("wallet_address");
  if (!wallet) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(wallet);
  const db = getDb(c.env);

  const bot = await db.query.bots.findFirst({
    where: and(eq(bots.id, id), eq(bots.ownerAddress, owner)),
  });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);

  const runtime = await db.query.botRuntimes.findFirst({
    where: eq(botRuntimes.botId, id),
    orderBy: (cols, { desc: descOp }) => [descOp(cols.createdAt)],
  });

  if (!runtime) {
    return c.json({
      health: {
        runtime_id: null,
        health: "idle",
        status: "draft",
        mode: "live",
        last_runtime_update: null,
        last_event_at: null,
        heartbeat_age_seconds: null,
        error_rate_recent: 0,
        reasons: [],
      },
      metrics: {
        runtime_id: "",
        status: "draft",
        uptime_seconds: null,
        window_hours: 24,
        events_total: 0,
        actions_total: 0,
        actions_success: 0,
        actions_error: 0,
        actions_skipped: 0,
        success_rate: 0,
        status_counts: {},
        event_type_counts: {},
        failure_reasons: [],
        recent_failures: [],
        last_event_at: null,
      },
      performance: null,
    });
  }

  return c.json(buildOverview(runtime));
});

/**
 * GET /api/bots/:id?wallet_address= -> BuilderBotDefinition
 * (builder loadBotIntoBuilder). Owner-scoped; reads rules_json back verbatim.
 */
r.get("/:id", async (c) => {
  const id = c.req.param("id");
  const wallet = c.req.query("wallet_address");
  if (!wallet) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(wallet);
  const db = getDb(c.env);

  const bot = await db.query.bots.findFirst({
    where: and(eq(bots.id, id), eq(bots.ownerAddress, owner)),
  });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);

  return c.json({
    id: bot.id,
    name: bot.name,
    description: bot.description,
    wallet_address: bot.ownerAddress,
    visibility: bot.visibility,
    authoring_mode: bot.authoringMode,
    strategy_type: bot.strategyType,
    market_scope: bot.marketScope,
    rules_json: bot.rulesJson ?? {},
    rules_version: bot.rulesVersion,
    status: bot.status,
    created_at: bot.createdAt,
    updated_at: bot.updatedAt,
  });
});

/**
 * PATCH /api/bots/:id?wallet_address= -> { id }   (builder update)
 * Auth required, owner-only (the verified caller must own the bot).
 */
r.patch("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const owner = getAddress(c);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const db = getDb(c.env);
  const existing = await db.query.bots.findFirst({ where: eq(bots.id, id) });
  if (!existing) return c.json({ detail: "Bot not found" }, 404);
  if (existing.ownerAddress !== owner) {
    return c.json({ detail: "You do not own this bot" }, 403);
  }

  const patch: Partial<typeof bots.$inferInsert> = { updatedAt: nowIso() };
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.visibility === "string") patch.visibility = body.visibility;
  if (typeof body.authoring_mode === "string")
    patch.authoringMode = body.authoring_mode;
  if (typeof body.strategy_type === "string")
    patch.strategyType = body.strategy_type;
  if (typeof body.market_scope === "string")
    patch.marketScope = body.market_scope;
  if (body.rules_json !== undefined)
    patch.rulesJson = (body.rules_json ?? null) as unknown;
  if (typeof body.rules_version === "number")
    patch.rulesVersion = body.rules_version;

  await db.update(bots).set(patch).where(eq(bots.id, id));
  return c.json({ id });
});

/**
 * POST /api/bots/:id/deploy -> { status: "active", runtime_id, ... }
 * Auth required, owner-only. Records a bot_runtimes row (wallet-in-loop) and
 * flips the bot to deployed.
 *
 * Response is a SUPERSET that satisfies two consumers at once:
 *   - the contract: { status: "active", runtime_id }
 *   - bots-fleet-page.tsx requestBotAction casts the body to RuntimeSummary and
 *     assigns it to bot.runtime, so it also needs { id, status, mode, updated_at,
 *     deployed_at, stopped_at }. We include both `id` and `runtime_id`.
 *
 * Registered before POST /:id/:action so the literal "deploy" path wins.
 */
r.post("/:id/deploy", requireAuth, async (c) => {
  const id = c.req.param("id");
  const owner = getAddress(c);
  let body: { risk_policy_json?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    // deploy body is optional (a default policy may be omitted)
    body = {};
  }

  const db = getDb(c.env);
  const bot = await db.query.bots.findFirst({ where: eq(bots.id, id) });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);
  if (bot.ownerAddress !== owner) {
    return c.json({ detail: "You do not own this bot" }, 403);
  }

  const runtimeId = crypto.randomUUID();
  const ts = nowIso();
  await db.insert(botRuntimes).values({
    id: runtimeId,
    botId: id,
    ownerAddress: owner,
    status: "active",
    runtimeKind: "wallet-in-loop",
    mode: "live",
    riskPolicyJson: (body.risk_policy_json ?? null) as unknown,
    startedAt: ts,
    summary: null,
    createdAt: ts,
    updatedAt: ts,
  });
  await db
    .update(bots)
    .set({ status: "deployed", updatedAt: ts })
    .where(eq(bots.id, id));

  return c.json({
    status: "active",
    runtime_id: runtimeId,
    id: runtimeId,
    mode: "live",
    updated_at: ts,
    deployed_at: ts,
    stopped_at: null,
  });
});

/**
 * POST /api/bots/:id/:action  (action ∈ {resume, stop}) -> RuntimeSummary
 * Auth required, owner-only. Updates the latest runtime's lifecycle state.
 * The fleet page assigns the returned RuntimeSummary onto bot.runtime.
 */
r.post("/:id/:action", requireAuth, async (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");
  if (action !== "resume" && action !== "stop") {
    return c.json({ detail: `Unsupported action: ${action}` }, 400);
  }
  const owner = getAddress(c);
  const db = getDb(c.env);

  const bot = await db.query.bots.findFirst({ where: eq(bots.id, id) });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);
  if (bot.ownerAddress !== owner) {
    return c.json({ detail: "You do not own this bot" }, 403);
  }

  const runtime = await db.query.botRuntimes.findFirst({
    where: eq(botRuntimes.botId, id),
    orderBy: (cols, { desc: descOp }) => [descOp(cols.createdAt)],
  });
  if (!runtime) return c.json({ detail: "No runtime to update" }, 404);

  const ts = nowIso();
  const nextStatus = action === "resume" ? "active" : "stopped";
  const stoppedAt = action === "stop" ? ts : null;
  await db
    .update(botRuntimes)
    .set({ status: nextStatus, stoppedAt, updatedAt: ts })
    .where(eq(botRuntimes.id, runtime.id));
  await db
    .update(bots)
    .set({ status: action === "stop" ? "stopped" : "deployed", updatedAt: ts })
    .where(eq(bots.id, id));

  return c.json({
    status: nextStatus,
    runtime_id: runtime.id,
    id: runtime.id,
    mode: runtime.mode,
    updated_at: ts,
    deployed_at: runtime.startedAt,
    stopped_at: stoppedAt,
  });
});

/**
 * DELETE /api/bots/:id?wallet_address= -> 200 { ok }   (fleet page deleteBot)
 * Auth required, owner-only. Removes the bot and any runtime rows.
 */
r.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const owner = getAddress(c);
  const db = getDb(c.env);

  const bot = await db.query.bots.findFirst({ where: eq(bots.id, id) });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);
  if (bot.ownerAddress !== owner) {
    return c.json({ detail: "You do not own this bot" }, 403);
  }

  await db.delete(botRuntimes).where(eq(botRuntimes.botId, id));
  await db.delete(bots).where(eq(bots.id, id));
  return c.json({ ok: true });
});

export { r as botsRouter };
