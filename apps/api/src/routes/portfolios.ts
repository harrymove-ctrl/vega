/**
 * /api/portfolios — copy baskets (metadata only, NO fund flow).
 *
 * Endpoints (contract §7 + the real copy-trading page flow in
 * apps/web/src/components/copy/copy-trading-page.tsx):
 *   GET    /                  -> PortfolioBasket[]      (owner-scoped, ?wallet_address=)
 *   POST   /                  -> PortfolioBasket        (auth; body has wallet_address + draft)
 *   GET    /:id               -> PortfolioBasket        (owner-scoped, ?wallet_address=)
 *   PATCH  /:id               -> PortfolioBasket        (auth; update draft)
 *   DELETE /:id               -> { ok: true }           (auth)
 *   POST   /:id/rebalance     -> PortfolioBasket        (auth; stamps a rebalance event)
 *   POST   /:id/kill-switch   -> PortfolioBasket        (auth; engage/release kill switch)
 *
 * Response shape is the exact `PortfolioBasket` the frontend dereferences in
 * apps/web/src/lib/copy-portfolios.ts (members[], health, rebalance_history,
 * risk_policy). This service tracks basket *configuration* only — live PnL /
 * trust / drift are not computed off-chain here, so per-member market metrics
 * are honest zeros until a runtime feed wires them, never fabricated numbers.
 */
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";

import type { AppEnv } from "../app";
import { getDb } from "../db/client";
import { portfolios, botRuntimes, bots } from "../db/schema";
import type { Db } from "../db/client";
import { getAddress, normalizeAddress, requireAuth } from "../auth";

const r = new Hono<AppEnv>();

// --- types mirrored from apps/web/src/lib/copy-portfolios.ts ----------------

type PortfolioRiskPolicy = {
  max_drawdown_pct: number;
  max_member_drawdown_pct: number;
  min_trust_score: number;
  max_active_members: number;
  auto_pause_on_source_stale: boolean;
  kill_switch_on_breach: boolean;
};

type PortfolioBasketMember = {
  id: string;
  source_runtime_id: string;
  source_bot_definition_id: string;
  source_bot_name: string;
  target_weight_pct: number;
  target_notional_usd: number;
  max_scale_bps: number;
  target_scale_bps: number;
  latest_scale_bps: number;
  status: string;
  relationship_id?: string | null;
  relationship_status?: string | null;
  trust_score: number;
  risk_grade: string;
  drift_status: string;
  member_live_pnl_pct: number;
  member_drawdown_pct: number;
  scale_drift_pct: number;
  last_rebalanced_at?: string | null;
};

type PortfolioRebalanceEvent = {
  id: string;
  trigger: string;
  status: string;
  summary_json: Record<string, unknown>;
  created_at: string;
};

// Incoming draft member from serializePortfolioDraft (copy-trading-page.tsx).
type DraftMember = {
  source_runtime_id?: string;
  source_bot_name?: string;
  target_weight_pct?: number;
  max_scale_bps?: number;
};

const DEFAULT_RISK_POLICY: PortfolioRiskPolicy = {
  max_drawdown_pct: 18,
  max_member_drawdown_pct: 22,
  min_trust_score: 55,
  max_active_members: 5,
  auto_pause_on_source_stale: true,
  kill_switch_on_breach: true,
};

const nowIso = () => new Date().toISOString();

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function mergeRiskPolicy(input: unknown): PortfolioRiskPolicy {
  const raw = (input ?? {}) as Partial<PortfolioRiskPolicy>;
  return {
    max_drawdown_pct: asNumber(raw.max_drawdown_pct, DEFAULT_RISK_POLICY.max_drawdown_pct),
    max_member_drawdown_pct: asNumber(
      raw.max_member_drawdown_pct,
      DEFAULT_RISK_POLICY.max_member_drawdown_pct,
    ),
    min_trust_score: asNumber(raw.min_trust_score, DEFAULT_RISK_POLICY.min_trust_score),
    max_active_members: asNumber(raw.max_active_members, DEFAULT_RISK_POLICY.max_active_members),
    auto_pause_on_source_stale:
      typeof raw.auto_pause_on_source_stale === "boolean"
        ? raw.auto_pause_on_source_stale
        : DEFAULT_RISK_POLICY.auto_pause_on_source_stale,
    kill_switch_on_breach:
      typeof raw.kill_switch_on_breach === "boolean"
        ? raw.kill_switch_on_breach
        : DEFAULT_RISK_POLICY.kill_switch_on_breach,
  };
}

/**
 * Normalize incoming draft members into the canonical PortfolioBasketMember[]
 * persisted in `legs`. `target_notional_usd` is derived from weight × basket
 * notional; per-member market metrics start at honest zeros (this service does
 * not compute live PnL/trust/drift).
 */
async function buildMembers(
  db: Db,
  drafts: DraftMember[],
  targetNotionalUsd: number,
): Promise<PortfolioBasketMember[]> {
  const members: PortfolioBasketMember[] = [];
  for (const draft of drafts) {
    const runtimeId = asString(draft.source_runtime_id);
    if (!runtimeId) continue;

    // Look up the runtime → bot to fill the definition id + a real bot name
    // when available; fall back to the name the client sent at compose time.
    let botDefinitionId = "";
    let botName = asString(draft.source_bot_name);
    const runtime = await db.query.botRuntimes.findFirst({
      where: eq(botRuntimes.id, runtimeId),
    });
    if (runtime) {
      botDefinitionId = runtime.botId;
      if (!botName) {
        const bot = await db.query.bots.findFirst({ where: eq(bots.id, runtime.botId) });
        botName = bot?.name ?? "";
      }
    }

    const weightPct = asNumber(draft.target_weight_pct, 0);
    const maxScaleBps = asNumber(draft.max_scale_bps, 20_000);
    const targetNotional = Math.round((targetNotionalUsd * weightPct) / 100);

    members.push({
      id: crypto.randomUUID(),
      source_runtime_id: runtimeId,
      source_bot_definition_id: botDefinitionId,
      source_bot_name: botName || runtimeId,
      target_weight_pct: weightPct,
      target_notional_usd: targetNotional,
      max_scale_bps: maxScaleBps,
      target_scale_bps: maxScaleBps,
      latest_scale_bps: maxScaleBps,
      status: "active",
      relationship_id: null,
      relationship_status: null,
      trust_score: 0,
      risk_grade: "unrated",
      drift_status: "ok",
      member_live_pnl_pct: 0,
      member_drawdown_pct: 0,
      scale_drift_pct: 0,
      last_rebalanced_at: null,
    });
  }
  return members;
}

type PortfolioRow = typeof portfolios.$inferSelect;

/** Serialize a stored row into the exact PortfolioBasket the frontend reads. */
function toBasket(row: PortfolioRow): Record<string, unknown> {
  const members = asArray<PortfolioBasketMember>(row.legs);
  const riskPolicy = mergeRiskPolicy(row.riskPolicy);
  const rebalanceHistory = asArray<PortfolioRebalanceEvent>(row.rebalanceHistory);

  const aggregateLivePnlUsd = members.reduce(
    (sum, m) => sum + (m.target_notional_usd * m.member_live_pnl_pct) / 100,
    0,
  );
  const worstDrawdownPct = members.reduce(
    (max, m) => Math.max(max, m.member_drawdown_pct),
    0,
  );
  const riskBudgetUsedPct =
    riskPolicy.max_drawdown_pct > 0
      ? Math.min(100, (worstDrawdownPct / riskPolicy.max_drawdown_pct) * 100)
      : 0;

  const killed = row.status === "killed";
  const breach = worstDrawdownPct >= riskPolicy.max_drawdown_pct && riskPolicy.max_drawdown_pct > 0;
  const needsRebalance =
    row.rebalanceMode === "drift" &&
    members.some((m) => Math.abs(m.scale_drift_pct) >= row.driftThresholdPct);

  const alerts: string[] = [];
  if (killed && row.killSwitchReason) alerts.push(row.killSwitchReason);
  if (breach) alerts.push("Aggregate drawdown breached the basket risk budget.");
  if (needsRebalance) alerts.push("Member scale drift exceeded the rebalance threshold.");

  let health = "healthy";
  if (killed || breach) health = "critical";
  else if (needsRebalance || riskBudgetUsedPct >= 75) health = "watch";

  const currentTotalNotionalUsd = members.reduce((sum, m) => sum + m.target_notional_usd, 0);

  return {
    id: row.id,
    owner_user_id: row.ownerAddress,
    wallet_address: row.ownerAddress,
    name: row.name,
    description: row.description,
    status: row.status,
    rebalance_mode: row.rebalanceMode,
    rebalance_interval_minutes: row.rebalanceIntervalMinutes,
    drift_threshold_pct: row.driftThresholdPct,
    target_notional_usd: row.targetNotionalUsd,
    current_notional_usd: row.currentNotionalUsd,
    kill_switch_reason: row.killSwitchReason ?? null,
    last_rebalanced_at: row.lastRebalancedAt ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    risk_policy: riskPolicy,
    members,
    health: {
      health,
      total_target_notional_usd: row.targetNotionalUsd,
      current_total_notional_usd: currentTotalNotionalUsd,
      aggregate_live_pnl_usd: aggregateLivePnlUsd,
      aggregate_drawdown_pct: worstDrawdownPct,
      risk_budget_used_pct: riskBudgetUsedPct,
      should_kill_switch: breach && riskPolicy.kill_switch_on_breach,
      needs_rebalance: needsRebalance,
      alert_count: alerts.length,
      alerts,
    },
    rebalance_history: rebalanceHistory,
  };
}

// --- GET / (list, owner-scoped) ---------------------------------------------

r.get("/", async (c) => {
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(walletAddress);
  const db = getDb(c.env);

  const rows = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.ownerAddress, owner))
    .orderBy(desc(portfolios.createdAt));

  return c.json(rows.map(toBasket));
});

// --- POST / (create) --------------------------------------------------------

r.post("/", requireAuth, async (c) => {
  const owner = getAddress(c);
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const name = asString(body.name).trim();
  if (name.length < 2) return c.json({ detail: "A basket name is required." }, 400);

  const db = getDb(c.env);
  const targetNotionalUsd = asNumber(body.target_notional_usd, 0);
  const members = await buildMembers(db, asArray<DraftMember>(body.members), targetNotionalUsd);
  const activate = body.activate_on_create === true;

  const now = nowIso();
  const id = crypto.randomUUID();
  const values = {
    id,
    ownerAddress: owner,
    name,
    description: asString(body.description),
    status: activate ? "active" : "draft",
    rebalanceMode: asString(body.rebalance_mode, "drift"),
    rebalanceIntervalMinutes: asNumber(body.rebalance_interval_minutes, 60),
    driftThresholdPct: asNumber(body.drift_threshold_pct, 6),
    targetNotionalUsd,
    currentNotionalUsd: members.reduce((sum, m) => sum + m.target_notional_usd, 0),
    killSwitchReason: null as string | null,
    lastRebalancedAt: null as string | null,
    legs: members,
    riskPolicy: mergeRiskPolicy(body.risk_policy),
    rebalanceHistory: [] as PortfolioRebalanceEvent[],
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(portfolios).values(values);
  const row = await db.query.portfolios.findFirst({ where: eq(portfolios.id, id) });
  if (!row) return c.json({ detail: "Failed to create the basket." }, 500);
  return c.json(toBasket(row), 201);
});

// --- GET /:id (owner-scoped) ------------------------------------------------

r.get("/:id", async (c) => {
  const id = c.req.param("id");
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(walletAddress);
  const db = getDb(c.env);

  const row = await db.query.portfolios.findFirst({
    where: and(eq(portfolios.id, id), eq(portfolios.ownerAddress, owner)),
  });
  if (!row) return c.json({ detail: "Basket not found." }, 404);
  return c.json(toBasket(row));
});

// --- PATCH /:id (update) ----------------------------------------------------

r.patch("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const owner = getAddress(c);
  const db = getDb(c.env);

  const row = await db.query.portfolios.findFirst({
    where: and(eq(portfolios.id, id), eq(portfolios.ownerAddress, owner)),
  });
  if (!row) return c.json({ detail: "Basket not found." }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const targetNotionalUsd = asNumber(body.target_notional_usd, row.targetNotionalUsd);
  const members =
    body.members !== undefined
      ? await buildMembers(db, asArray<DraftMember>(body.members), targetNotionalUsd)
      : asArray<PortfolioBasketMember>(row.legs);

  const activate = body.activate_on_create === true;
  const nextStatus =
    body.activate_on_create !== undefined
      ? activate
        ? "active"
        : "draft"
      : row.status;

  await db
    .update(portfolios)
    .set({
      name: body.name !== undefined ? asString(body.name).trim() : row.name,
      description: body.description !== undefined ? asString(body.description) : row.description,
      status: nextStatus,
      rebalanceMode:
        body.rebalance_mode !== undefined ? asString(body.rebalance_mode) : row.rebalanceMode,
      rebalanceIntervalMinutes: asNumber(
        body.rebalance_interval_minutes,
        row.rebalanceIntervalMinutes,
      ),
      driftThresholdPct: asNumber(body.drift_threshold_pct, row.driftThresholdPct),
      targetNotionalUsd,
      currentNotionalUsd: members.reduce((sum, m) => sum + m.target_notional_usd, 0),
      legs: members,
      riskPolicy: body.risk_policy !== undefined ? mergeRiskPolicy(body.risk_policy) : row.riskPolicy,
      updatedAt: nowIso(),
    })
    .where(eq(portfolios.id, id));

  const updated = await db.query.portfolios.findFirst({ where: eq(portfolios.id, id) });
  if (!updated) return c.json({ detail: "Failed to update the basket." }, 500);
  return c.json(toBasket(updated));
});

// --- DELETE /:id ------------------------------------------------------------

r.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const owner = getAddress(c);
  const db = getDb(c.env);

  const row = await db.query.portfolios.findFirst({
    where: and(eq(portfolios.id, id), eq(portfolios.ownerAddress, owner)),
  });
  if (!row) return c.json({ detail: "Basket not found." }, 404);

  await db.delete(portfolios).where(eq(portfolios.id, id));
  return c.json({ ok: true });
});

// --- POST /:id/rebalance ----------------------------------------------------

r.post("/:id/rebalance", requireAuth, async (c) => {
  const id = c.req.param("id");
  const owner = getAddress(c);
  const db = getDb(c.env);

  const row = await db.query.portfolios.findFirst({
    where: and(eq(portfolios.id, id), eq(portfolios.ownerAddress, owner)),
  });
  if (!row) return c.json({ detail: "Basket not found." }, 404);

  const now = nowIso();
  const event: PortfolioRebalanceEvent = {
    id: crypto.randomUUID(),
    trigger: "manual_rebalance",
    status: "completed",
    summary_json: { member_count: asArray<PortfolioBasketMember>(row.legs).length },
    created_at: now,
  };
  const history = [event, ...asArray<PortfolioRebalanceEvent>(row.rebalanceHistory)];

  await db
    .update(portfolios)
    .set({ rebalanceHistory: history, lastRebalancedAt: now, updatedAt: now })
    .where(eq(portfolios.id, id));

  const updated = await db.query.portfolios.findFirst({ where: eq(portfolios.id, id) });
  if (!updated) return c.json({ detail: "Failed to rebalance the basket." }, 500);
  return c.json(toBasket(updated));
});

// --- POST /:id/kill-switch --------------------------------------------------

r.post("/:id/kill-switch", requireAuth, async (c) => {
  const id = c.req.param("id");
  const owner = getAddress(c);
  const db = getDb(c.env);

  const row = await db.query.portfolios.findFirst({
    where: and(eq(portfolios.id, id), eq(portfolios.ownerAddress, owner)),
  });
  if (!row) return c.json({ detail: "Basket not found." }, 404);

  let body: { engaged?: boolean; reason?: string | null } = {};
  try {
    body = (await c.req.json()) as { engaged?: boolean; reason?: string | null };
  } catch {
    // body is optional; default to engaging the kill switch
    body = { engaged: true };
  }

  const engaged = body.engaged !== false;
  const now = nowIso();
  const reason = engaged
    ? asString(body.reason ?? undefined) || "Manual kill switch triggered."
    : null;

  const event: PortfolioRebalanceEvent = {
    id: crypto.randomUUID(),
    trigger: engaged ? "kill_switch_engaged" : "kill_switch_released",
    status: "completed",
    summary_json: reason ? { reason } : {},
    created_at: now,
  };
  const history = [event, ...asArray<PortfolioRebalanceEvent>(row.rebalanceHistory)];

  await db
    .update(portfolios)
    .set({
      status: engaged ? "killed" : "active",
      killSwitchReason: reason,
      rebalanceHistory: history,
      updatedAt: now,
    })
    .where(eq(portfolios.id, id));

  const updated = await db.query.portfolios.findFirst({ where: eq(portfolios.id, id) });
  if (!updated) return c.json({ detail: "Failed to toggle the kill switch." }, 500);
  return c.json(toBasket(updated));
});

export { r as portfoliosRouter };
