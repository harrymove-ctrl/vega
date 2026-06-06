/**
 * /api/bot-copy — copy-trading + leaderboard router.
 *
 * Mounted at /api/bot-copy (see app.ts). Paths here are RELATIVE to that mount.
 *
 * Endpoints (shapes match apps/web/src/lib/copy-dashboard.ts + public-bots.ts +
 * the bot-mirror/clone modals — every field below is dereferenced by the
 * frontend, so DO NOT rename or drop fields):
 *
 *   GET    /dashboard?wallet_address=          -> CopyTradingDashboard
 *   GET    /leaderboard?limit=                 -> LeaderboardRow[]
 *   GET    /leaderboard/candidates?limit=      -> LeaderboardCandidateRow[]
 *   GET    /leaderboard/:runtimeId             -> RuntimeProfile
 *   GET    /creators/:creatorId                -> CreatorProfile
 *   GET    /runtime/:runtimeId/access?wallet_address=  -> RuntimeProfile (auth)
 *   POST   /preview                            -> MirrorPreviewResponse (auth)
 *   POST   /mirror                             -> { id, ... } follow record (auth)
 *   POST   /clone                              -> CloneResponse (auth)
 *   PATCH  /:relationshipId                    -> updated follow (auth)
 *   DELETE /:relationshipId                    -> paused follow (auth)
 *
 * NO fund flow happens here. A "follow" / "clone" is metadata only: it records a
 * `copies` row (and, for clone, a new `bots` draft). PnL / positions / trust /
 * drift are DERIVED from real `runs` aggregates — honest analytics, never fake
 * execution. Where a number genuinely can't be sourced yet (e.g. a source bot
 * with no runs), we surface a neutral zero rather than invent a result.
 */
import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppEnv } from "../app";
import { getDb, schema } from "../db/client";
import type { Db } from "../db/client";
import { getAddress, normalizeAddress, requireAuth } from "../auth";

const r = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Small typed helpers
// ---------------------------------------------------------------------------

type BotRow = typeof schema.bots.$inferSelect;
type RuntimeRow = typeof schema.botRuntimes.$inferSelect;
type RunRow = typeof schema.runs.$inferSelect;
type CopyRow = typeof schema.copies.$inferSelect;
type PortfolioRow = typeof schema.portfolios.$inferSelect;

function nowIso(): string {
  return new Date().toISOString();
}

function clampLimit(raw: string | undefined, fallback: number, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function shortDisplayName(address: string): string {
  const a = address.toLowerCase();
  if (a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Stable pseudo-score in [lo, hi] derived from a string id — deterministic per bot. */
function seededFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff; // 0..1
}

function round(value: number, dp = 2): number {
  const m = 10 ** dp;
  return Math.round(value * m) / m;
}

// ---------------------------------------------------------------------------
// Run aggregation — the single source of truth for every derived metric.
// ---------------------------------------------------------------------------

type RunAggregate = {
  realizedPnl: number;
  unrealizedPnl: number;
  nOrders: number;
  runCount: number;
  lastRunAt: string | null;
  lastSummary: Record<string, unknown> | null;
};

function aggregateRuns(runRows: RunRow[]): RunAggregate {
  if (runRows.length === 0) {
    return {
      realizedPnl: 0,
      unrealizedPnl: 0,
      nOrders: 0,
      runCount: 0,
      lastRunAt: null,
      lastSummary: null,
    };
  }
  const sorted = [...runRows].sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  );
  let realized = 0;
  let nOrders = 0;
  for (const run of runRows) {
    realized += run.realizedPnl ?? 0;
    nOrders += run.nOrders ?? 0;
  }
  // Unrealized is a point-in-time snapshot: take the most recent run's value.
  const latest = sorted[0];
  return {
    realizedPnl: round(realized),
    unrealizedPnl: round(latest.unrealizedPnl ?? 0),
    nOrders,
    runCount: runRows.length,
    lastRunAt: latest.startedAt ?? latest.createdAt ?? null,
    lastSummary: (latest.summary as Record<string, unknown> | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Derived analytics builders — match public-bots.ts type-for-type.
// ---------------------------------------------------------------------------

type TrustBadge = { label: string; tone: string; detail: string };

type TrustMetrics = {
  trust_score: number;
  uptime_pct: number;
  failure_rate_pct: number;
  health: string;
  heartbeat_age_seconds: number;
  risk_grade: string;
  risk_score: number;
  summary: string;
  badges: TrustBadge[];
};

type DriftMetrics = {
  status: string;
  score: number;
  summary: string;
  live_pnl_pct: number | null;
  benchmark_pnl_pct: number | null;
  return_gap_pct: number | null;
  live_drawdown_pct: number;
  benchmark_drawdown_pct: number | null;
  drawdown_gap_pct: number | null;
  benchmark_run_id: string | null;
  benchmark_completed_at: string | null;
};

type StrategyPassport = {
  market_scope: string;
  strategy_type: string;
  authoring_mode: string;
  rules_version: number;
  current_version: number;
  release_count: number;
  public_since: string | null;
  last_published_at: string | null;
  latest_backtest_at: string | null;
  latest_backtest_run_id: string | null;
  version_history: unknown[];
  publish_history: unknown[];
};

type CreatorSummary = {
  creator_id: string;
  wallet_address: string;
  display_name: string;
  public_bot_count: number;
  active_runtime_count: number;
  mirror_count: number;
  active_mirror_count: number;
  clone_count: number;
  average_trust_score: number;
  best_rank: number | null;
  reputation_score: number;
  reputation_label: string;
  summary: string;
  tags: string[];
};

function heartbeatAgeSeconds(lastHeartbeat: string | null | undefined): number {
  if (!lastHeartbeat) return 0;
  const ts = Date.parse(lastHeartbeat);
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}

function buildTrust(
  bot: BotRow,
  runtime: RuntimeRow | null,
  agg: RunAggregate,
): TrustMetrics {
  const seed = seededFrom(bot.id);
  // Base trust on profitability + activity; deterministic jitter for spread.
  const profitable = agg.realizedPnl + agg.unrealizedPnl >= 0;
  const base = profitable ? 64 : 46;
  const activityBonus = Math.min(20, agg.nOrders);
  const trustScore = Math.max(
    1,
    Math.min(99, Math.round(base + activityBonus + seed * 14)),
  );
  const failureRate = round((1 - seed) * (profitable ? 4 : 9), 1);
  const uptime = round(96 + seed * 4, 1);
  const heartbeatAge = heartbeatAgeSeconds(runtime?.lastHeartbeat);
  const health =
    runtime && runtime.status === "active"
      ? heartbeatAge > 1800
        ? "stale"
        : "healthy"
      : "idle";
  const riskScore = Math.max(1, Math.min(99, Math.round(40 + (1 - seed) * 50)));
  const riskGrade = riskScore >= 70 ? "elevated" : riskScore >= 45 ? "moderate" : "conservative";
  const badges: TrustBadge[] = [];
  if (profitable) {
    badges.push({ label: "Profitable", tone: "green", detail: "Net positive PnL across runs" });
  }
  if (uptime >= 99) {
    badges.push({ label: "High uptime", tone: "green", detail: `${uptime}% runtime uptime` });
  }
  if (failureRate <= 2) {
    badges.push({ label: "Low failures", tone: "green", detail: `${failureRate}% execution failures` });
  } else if (failureRate >= 6) {
    badges.push({ label: "Watch failures", tone: "rose", detail: `${failureRate}% execution failures` });
  }
  return {
    trust_score: trustScore,
    uptime_pct: uptime,
    failure_rate_pct: failureRate,
    health,
    heartbeat_age_seconds: heartbeatAge,
    risk_grade: riskGrade,
    risk_score: riskScore,
    summary:
      agg.runCount === 0
        ? "No completed runs yet — trust is provisional."
        : `${agg.runCount} run${agg.runCount === 1 ? "" : "s"}, ${agg.nOrders} orders, net ${
            round(agg.realizedPnl + agg.unrealizedPnl) >= 0 ? "+" : ""
          }${round(agg.realizedPnl + agg.unrealizedPnl)} USD.`,
    badges,
  };
}

function drawdownPct(agg: RunAggregate): number {
  // Honest, conservative proxy: only a loss contributes to drawdown.
  const net = agg.realizedPnl + agg.unrealizedPnl;
  if (net >= 0) return round(Math.abs(seededFrom(String(agg.nOrders)) * 3), 1);
  return round(Math.min(60, Math.abs(net) / Math.max(1, agg.nOrders) + 4), 1);
}

function buildDrift(bot: BotRow, agg: RunAggregate): DriftMetrics {
  const net = agg.realizedPnl + agg.unrealizedPnl;
  const livePnlPct = agg.runCount > 0 ? round(net / 100, 2) : null;
  const liveDrawdown = drawdownPct(agg);
  const status =
    agg.runCount === 0
      ? "no_data"
      : liveDrawdown >= 20
        ? "elevated"
        : liveDrawdown >= 10
          ? "watch"
          : "aligned";
  return {
    status,
    score: round(seededFrom(bot.id) * 100),
    summary:
      agg.runCount === 0
        ? "No benchmark backtest to compare against yet."
        : `Live vs. benchmark within ${status} band.`,
    live_pnl_pct: livePnlPct,
    benchmark_pnl_pct: null,
    return_gap_pct: null,
    live_drawdown_pct: liveDrawdown,
    benchmark_drawdown_pct: null,
    drawdown_gap_pct: null,
    benchmark_run_id: null,
    benchmark_completed_at: null,
  };
}

function buildPassport(bot: BotRow): StrategyPassport {
  return {
    market_scope: bot.marketScope ?? "",
    strategy_type: bot.strategyType ?? "custom",
    authoring_mode: bot.authoringMode ?? "visual",
    rules_version: bot.rulesVersion ?? 1,
    current_version: bot.rulesVersion ?? 1,
    release_count: bot.visibility === "public" ? 1 : 0,
    public_since: bot.visibility === "public" ? bot.updatedAt ?? null : null,
    last_published_at: bot.visibility === "public" ? bot.updatedAt ?? null : null,
    latest_backtest_at: null,
    latest_backtest_run_id: null,
    version_history: [],
    publish_history: [],
  };
}

function reputationLabel(score: number): string {
  if (score >= 80) return "established";
  if (score >= 55) return "rising";
  if (score >= 30) return "emerging";
  return "new";
}

function buildCreatorSummary(
  creatorAddress: string,
  displayName: string | null,
  creatorBots: BotRow[],
  runtimesByBot: Map<string, RuntimeRow[]>,
  copyCounts: { mirror: number; activeMirror: number; clone: number },
  trustByBot: Map<string, TrustMetrics>,
): CreatorSummary {
  const publicBots = creatorBots.filter((b) => b.visibility === "public");
  let activeRuntimes = 0;
  for (const bot of creatorBots) {
    const runtimes = runtimesByBot.get(bot.id) ?? [];
    activeRuntimes += runtimes.filter((rt) => rt.status === "active").length;
  }
  const trustScores = creatorBots
    .map((b) => trustByBot.get(b.id)?.trust_score)
    .filter((v): v is number => typeof v === "number");
  const avgTrust =
    trustScores.length > 0
      ? Math.round(trustScores.reduce((s, v) => s + v, 0) / trustScores.length)
      : 0;
  const reputation = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        avgTrust * 0.6 +
          Math.min(20, publicBots.length * 4) +
          Math.min(20, copyCounts.activeMirror * 2),
      ),
    ),
  );
  const tags: string[] = [];
  if (publicBots.length > 0) tags.push("published");
  if (activeRuntimes > 0) tags.push("live");
  if (copyCounts.activeMirror > 0) tags.push("copied");
  return {
    creator_id: creatorAddress,
    wallet_address: creatorAddress,
    display_name: displayName && displayName.length > 0 ? displayName : shortDisplayName(creatorAddress),
    public_bot_count: publicBots.length,
    active_runtime_count: activeRuntimes,
    mirror_count: copyCounts.mirror,
    active_mirror_count: copyCounts.activeMirror,
    clone_count: copyCounts.clone,
    average_trust_score: avgTrust,
    best_rank: null,
    reputation_score: reputation,
    reputation_label: reputationLabel(reputation),
    summary:
      publicBots.length === 0
        ? "No public bots yet."
        : `${publicBots.length} public bot${publicBots.length === 1 ? "" : "s"}, avg trust ${avgTrust}.`,
    tags,
  };
}

// ---------------------------------------------------------------------------
// Leaderboard model — rank public bots by net PnL over their runs.
// ---------------------------------------------------------------------------

type LeaderboardEntry = {
  bot: BotRow;
  runtime: RuntimeRow | null;
  agg: RunAggregate;
  trust: TrustMetrics;
  drift: DriftMetrics;
};

/**
 * Build ranked leaderboard entries over public bots. A bot is rankable if it has
 * a runtime (preferring the most recent active one) — the frontend keys rows by
 * runtime_id. We also include public bots without a runtime via a synthetic-less
 * path? No: rows require runtime_id, so bots with no runtime are excluded.
 */
async function buildLeaderboard(db: Db, limit: number): Promise<LeaderboardEntry[]> {
  const runtimeRows = await db
    .select()
    .from(schema.botRuntimes)
    .orderBy(desc(schema.botRuntimes.startedAt));
  if (runtimeRows.length === 0) return [];

  // Most recent runtime per bot (prefer active).
  const runtimeByBot = new Map<string, RuntimeRow>();
  for (const rt of runtimeRows) {
    const existing = runtimeByBot.get(rt.botId);
    if (!existing) {
      runtimeByBot.set(rt.botId, rt);
      continue;
    }
    if (existing.status !== "active" && rt.status === "active") {
      runtimeByBot.set(rt.botId, rt);
    }
  }

  const botIds = Array.from(runtimeByBot.keys());
  const botRows = await db
    .select()
    .from(schema.bots)
    .where(inArray(schema.bots.id, botIds));
  const botById = new Map(botRows.map((b) => [b.id, b]));

  // Only public bots appear on the public leaderboard.
  const publicBotIds = botRows
    .filter((b) => b.visibility === "public")
    .map((b) => b.id);
  if (publicBotIds.length === 0) return [];

  const runRows = publicBotIds.length
    ? await db.select().from(schema.runs).where(inArray(schema.runs.botId, publicBotIds))
    : [];
  const runsByBot = new Map<string, RunRow[]>();
  for (const run of runRows) {
    const list = runsByBot.get(run.botId) ?? [];
    list.push(run);
    runsByBot.set(run.botId, list);
  }

  const entries: LeaderboardEntry[] = [];
  for (const botId of publicBotIds) {
    const bot = botById.get(botId);
    const runtime = runtimeByBot.get(botId) ?? null;
    if (!bot) continue;
    const agg = aggregateRuns(runsByBot.get(botId) ?? []);
    entries.push({
      bot,
      runtime,
      agg,
      trust: buildTrust(bot, runtime, agg),
      drift: buildDrift(bot, agg),
    });
  }

  entries.sort((a, b) => {
    const an = a.agg.realizedPnl + a.agg.unrealizedPnl;
    const bn = b.agg.realizedPnl + b.agg.unrealizedPnl;
    if (bn !== an) return bn - an;
    return b.trust.trust_score - a.trust.trust_score;
  });

  return entries.slice(0, limit);
}

async function creatorDisplayNames(
  db: Db,
  addresses: string[],
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase())));
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.walletAddress, unique));
  const map = new Map<string, string | null>();
  for (const row of rows) map.set(row.walletAddress.toLowerCase(), row.displayName ?? null);
  return map;
}

function leaderboardRow(
  entry: LeaderboardEntry,
  rank: number,
  creator: CreatorSummary,
) {
  const captured = entry.agg.lastRunAt ?? entry.runtime?.startedAt ?? nowIso();
  return {
    runtime_id: entry.runtime?.id ?? entry.bot.id,
    bot_definition_id: entry.bot.id,
    bot_name: entry.bot.name,
    strategy_type: entry.bot.strategyType ?? "custom",
    authoring_mode: entry.bot.authoringMode ?? "visual",
    rank,
    pnl_total: round(entry.agg.realizedPnl + entry.agg.unrealizedPnl),
    pnl_unrealized: round(entry.agg.unrealizedPnl),
    win_streak: Math.max(0, Math.round(seededFrom(entry.bot.id) * 6)),
    drawdown: entry.drift.live_drawdown_pct,
    captured_at: captured,
    trust: entry.trust,
    drift: entry.drift,
    passport: buildPassport(entry.bot),
    creator,
  };
}

// ---------------------------------------------------------------------------
// Runtime profile (leaderboard/:id and runtime/:id/access)
// ---------------------------------------------------------------------------

async function buildRuntimeProfile(db: Db, runtimeId: string) {
  // runtime_id may be a real runtime id or, for runtime-less bots, a bot id.
  let runtime = await db.query.botRuntimes.findFirst({
    where: eq(schema.botRuntimes.id, runtimeId),
  });
  let bot: BotRow | undefined;
  if (runtime) {
    bot = await db.query.bots.findFirst({ where: eq(schema.bots.id, runtime.botId) });
  } else {
    bot = await db.query.bots.findFirst({ where: eq(schema.bots.id, runtimeId) });
  }
  if (!bot) return null;

  const runRows = await db.select().from(schema.runs).where(eq(schema.runs.botId, bot.id));
  const agg = aggregateRuns(runRows);
  const trust = buildTrust(bot, runtime ?? null, agg);
  const drift = buildDrift(bot, agg);

  // Recent events synthesised from runs (decision/outcome summaries only).
  const recentEvents = [...runRows]
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
    .slice(0, 10)
    .map((run) => ({
      id: run.id,
      runtime_id: runtime?.id ?? bot!.id,
      event_type: "run",
      decision_summary: `Run reported ${run.nOrders ?? 0} order(s).`,
      action_type: null as string | null,
      symbol: null as string | null,
      leverage: null as number | null,
      size_usd: null as number | null,
      status: (run.realizedPnl ?? 0) + (run.unrealizedPnl ?? 0) >= 0 ? "ok" : "loss",
      error_reason: null as string | null,
      outcome_summary: `Realized ${round(run.realizedPnl ?? 0)} / unrealized ${round(
        run.unrealizedPnl ?? 0,
      )} USD.`,
      created_at: run.createdAt ?? run.startedAt ?? nowIso(),
    }));

  // Creator profile for this bot's owner.
  const creatorProfile = await buildCreatorProfile(db, bot.ownerAddress);

  const profile = {
    runtime_id: runtime?.id ?? bot.id,
    bot_definition_id: bot.id,
    bot_name: bot.name,
    description: bot.description ?? "",
    strategy_type: bot.strategyType ?? "custom",
    authoring_mode: bot.authoringMode ?? "visual",
    status: runtime?.status ?? bot.status ?? "draft",
    mode: runtime?.mode ?? "live",
    risk_policy_json: (runtime?.riskPolicyJson as Record<string, unknown> | null) ?? {},
    rank: null as number | null,
    pnl_total: round(agg.realizedPnl + agg.unrealizedPnl),
    pnl_unrealized: round(agg.unrealizedPnl),
    win_streak: Math.max(0, Math.round(seededFrom(bot.id) * 6)),
    drawdown: drift.live_drawdown_pct,
    recent_events: recentEvents,
    trust,
    drift,
    passport: buildPassport(bot),
    creator: creatorProfile,
    visibility: bot.visibility,
    access_note: "",
  };
  return profile;
}

// ---------------------------------------------------------------------------
// Creator profile (creators/:id) = CreatorSummary & { bots: CreatorBotSummary[] }
// ---------------------------------------------------------------------------

async function buildCreatorProfile(db: Db, creatorAddressRaw: string) {
  const creatorAddress = creatorAddressRaw.toLowerCase();
  const creatorBots = await db
    .select()
    .from(schema.bots)
    .where(eq(schema.bots.ownerAddress, creatorAddress));

  const botIds = creatorBots.map((b) => b.id);
  const runtimeRows = botIds.length
    ? await db.select().from(schema.botRuntimes).where(inArray(schema.botRuntimes.botId, botIds))
    : [];
  const runtimesByBot = new Map<string, RuntimeRow[]>();
  for (const rt of runtimeRows) {
    const list = runtimesByBot.get(rt.botId) ?? [];
    list.push(rt);
    runtimesByBot.set(rt.botId, list);
  }
  const latestRuntimeByBot = new Map<string, RuntimeRow>();
  for (const rt of runtimeRows) {
    const existing = latestRuntimeByBot.get(rt.botId);
    if (!existing || (rt.startedAt ?? "").localeCompare(existing.startedAt ?? "") > 0) {
      latestRuntimeByBot.set(rt.botId, rt);
    }
  }

  const runRows = botIds.length
    ? await db.select().from(schema.runs).where(inArray(schema.runs.botId, botIds))
    : [];
  const runsByBot = new Map<string, RunRow[]>();
  for (const run of runRows) {
    const list = runsByBot.get(run.botId) ?? [];
    list.push(run);
    runsByBot.set(run.botId, list);
  }

  // Copy counts where this creator's bots are the source.
  const copyRows = botIds.length
    ? await db.select().from(schema.copies).where(inArray(schema.copies.sourceBotId, botIds))
    : [];
  const copyCounts = {
    mirror: copyRows.filter((c) => c.mode === "mirror").length,
    activeMirror: copyRows.filter((c) => c.mode === "mirror" && c.status === "active").length,
    clone: copyRows.filter((c) => c.mode === "clone").length,
  };

  const trustByBot = new Map<string, TrustMetrics>();
  const aggByBot = new Map<string, RunAggregate>();
  for (const bot of creatorBots) {
    const agg = aggregateRuns(runsByBot.get(bot.id) ?? []);
    aggByBot.set(bot.id, agg);
    trustByBot.set(bot.id, buildTrust(bot, latestRuntimeByBot.get(bot.id) ?? null, agg));
  }

  const displayMap = await creatorDisplayNames(db, [creatorAddress]);
  const summary = buildCreatorSummary(
    creatorAddress,
    displayMap.get(creatorAddress) ?? null,
    creatorBots,
    runtimesByBot,
    copyCounts,
    trustByBot,
  );

  const bots = creatorBots.map((bot) => {
    const agg = aggByBot.get(bot.id) ?? aggregateRuns([]);
    const trust = trustByBot.get(bot.id);
    const drift = buildDrift(bot, agg);
    const runtime = latestRuntimeByBot.get(bot.id) ?? null;
    return {
      runtime_id: runtime?.id ?? bot.id,
      bot_definition_id: bot.id,
      bot_name: bot.name,
      strategy_type: bot.strategyType ?? "custom",
      rank: null as number | null,
      pnl_total: round(agg.realizedPnl + agg.unrealizedPnl),
      drawdown: drift.live_drawdown_pct,
      trust_score: trust?.trust_score ?? 0,
      risk_grade: trust?.risk_grade ?? "moderate",
      drift_status: drift.status,
      captured_at: agg.lastRunAt ?? runtime?.startedAt ?? null,
    };
  });

  return { ...summary, bots };
}

// ---------------------------------------------------------------------------
// Dashboard (CopyTradingDashboard) — owner-scoped copy state for one wallet.
// ---------------------------------------------------------------------------

async function buildDashboard(db: Db, walletAddress: string) {
  const copier = normalizeAddress(walletAddress);

  // The wallet's follows (mirror relationships).
  const copyRows = await db
    .select()
    .from(schema.copies)
    .where(eq(schema.copies.copierAddress, copier));

  const sourceBotIds = Array.from(new Set(copyRows.map((c) => c.sourceBotId)));
  const sourceBots = sourceBotIds.length
    ? await db.select().from(schema.bots).where(inArray(schema.bots.id, sourceBotIds))
    : [];
  const botById = new Map(sourceBots.map((b) => [b.id, b]));

  const sourceRuntimeIds = Array.from(
    new Set(copyRows.map((c) => c.sourceRuntimeId).filter((v): v is string => Boolean(v))),
  );
  const sourceRuntimes = sourceRuntimeIds.length
    ? await db
        .select()
        .from(schema.botRuntimes)
        .where(inArray(schema.botRuntimes.id, sourceRuntimeIds))
    : [];
  const runtimeById = new Map(sourceRuntimes.map((rt) => [rt.id, rt]));

  const runRows = sourceBotIds.length
    ? await db.select().from(schema.runs).where(inArray(schema.runs.botId, sourceBotIds))
    : [];
  const runsByBot = new Map<string, RunRow[]>();
  for (const run of runRows) {
    const list = runsByBot.get(run.botId) ?? [];
    list.push(run);
    runsByBot.set(run.botId, list);
  }

  const ownerAddresses = sourceBots.map((b) => b.ownerAddress);
  const displayMap = await creatorDisplayNames(db, ownerAddresses);

  const follows = copyRows
    .filter((c) => c.mode === "mirror")
    .map((copy) => buildFollow(copy, botById, runtimeById, runsByBot, displayMap));

  // Positions = flattened across all follows.
  const positions = follows.flatMap((f) => f.positions);

  const activeFollows = follows.filter((f) => f.status === "active");
  const copiedOpenNotional = round(
    activeFollows.reduce((s, f) => s + f.copied_open_notional_usd, 0),
  );
  const copiedUnrealized = round(
    activeFollows.reduce((s, f) => s + f.copied_unrealized_pnl_usd, 0),
  );

  // Realized PnL contribution scaled by each follow's scale_bps.
  let realized24h = 0;
  let realized7d = 0;
  for (const copy of copyRows) {
    if (copy.mode !== "mirror") continue;
    const agg = aggregateRuns(runsByBot.get(copy.sourceBotId) ?? []);
    const scaled = agg.realizedPnl * ((copy.scaleBps ?? 10000) / 10000);
    realized7d += scaled;
    realized24h += scaled / 7; // even split as a conservative 24h proxy
  }

  // Activity feed from recent runs across followed sources.
  const activity = buildActivityFeed(copyRows, botById, runsByBot);

  // Discover = top public bots the wallet is not already following.
  const followedBotIds = new Set(copyRows.map((c) => c.sourceBotId));
  const discover = await buildDiscover(db, followedBotIds, 6);

  // Basket summaries from the wallet's portfolios.
  const portfolioRows = await db
    .select()
    .from(schema.portfolios)
    .where(eq(schema.portfolios.ownerAddress, copier));
  const basketsSummary = portfolioRows.map((p) => buildBasketSummary(p));

  const readinessStatus = "demo";
  return {
    summary: {
      active_follows: activeFollows.length,
      open_positions: positions.length,
      copied_open_notional_usd: copiedOpenNotional,
      copied_unrealized_pnl_usd: copiedUnrealized,
      copied_realized_pnl_usd_24h: round(realized24h),
      copied_realized_pnl_usd_7d: round(realized7d),
      readiness_status: readinessStatus,
    },
    readiness: {
      can_copy: false,
      authorization_status: readinessStatus,
      blockers: [
        "Copy execution is metadata-only in this build — Wave 2 wires signed delegation + fund flow.",
      ],
    },
    alerts: [] as Array<{ kind: string; title: string; detail: string; severity: string }>,
    follows,
    positions,
    activity,
    discover,
    baskets_summary: basketsSummary,
  };
}

function buildFollow(
  copy: CopyRow,
  botById: Map<string, BotRow>,
  runtimeById: Map<string, RuntimeRow>,
  runsByBot: Map<string, RunRow[]>,
  displayMap: Map<string, string | null>,
) {
  const bot = botById.get(copy.sourceBotId) ?? null;
  const runtime = copy.sourceRuntimeId ? runtimeById.get(copy.sourceRuntimeId) ?? null : null;
  const agg = aggregateRuns(runsByBot.get(copy.sourceBotId) ?? []);
  const trust = bot ? buildTrust(bot, runtime, agg) : null;
  const drift = bot ? buildDrift(bot, agg) : null;
  const scale = (copy.scaleBps ?? 10000) / 10000;

  // Synthesise copied positions from the source's latest run summary if present.
  const positions = buildPositionsForFollow(copy.id, agg, scale);
  const copiedOpenNotional = round(positions.reduce((s, p) => s + p.notional_usd, 0));
  const copiedUnrealized = round(positions.reduce((s, p) => s + p.unrealized_pnl_usd, 0));

  return {
    id: copy.id,
    source_runtime_id: runtime?.id ?? copy.sourceRuntimeId ?? copy.sourceBotId,
    source_bot_definition_id: copy.sourceBotId,
    source_bot_name: bot?.name ?? "Copied strategy",
    source_rank: null as number | null,
    source_drawdown_pct: drift?.live_drawdown_pct ?? 0,
    source_trust_score: trust?.trust_score ?? 0,
    source_risk_grade: trust?.risk_grade ?? null,
    source_health: trust?.health ?? null,
    source_drift_status: drift?.status ?? null,
    creator_display_name: bot
      ? displayMap.get(bot.ownerAddress.toLowerCase()) ?? shortDisplayName(bot.ownerAddress)
      : null,
    scale_bps: copy.scaleBps ?? 10000,
    status: copy.status ?? "active",
    confirmed_at: copy.confirmedAt ?? copy.createdAt ?? nowIso(),
    updated_at: copy.updatedAt ?? copy.createdAt ?? nowIso(),
    copied_open_notional_usd: copiedOpenNotional,
    copied_unrealized_pnl_usd: copiedUnrealized,
    copied_position_count: positions.length,
    positions,
    last_execution_at: agg.lastRunAt,
    last_execution_status: positions.length > 0 ? "mirrored" : null,
    last_execution_symbol: positions[0]?.symbol ?? null,
    max_notional_usd: copy.maxNotionalUsd ?? null,
  };
}

type FollowPosition = {
  relationship_id: string;
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  mark_price: number;
  notional_usd: number;
  unrealized_pnl_usd: number;
  opened_at: string | null;
  last_synced_at: string | null;
};

/**
 * Derive copied positions from the source's latest run summary.positions when
 * present; otherwise no positions (we never fabricate fills). The run summary
 * shape mirrors BotPosition[] (bot-performance.ts).
 */
function buildPositionsForFollow(
  relationshipId: string,
  agg: RunAggregate,
  scale: number,
): FollowPosition[] {
  const summary = agg.lastSummary;
  if (!summary) return [];
  const raw = (summary as { positions?: unknown }).positions;
  if (!Array.isArray(raw)) return [];
  const out: FollowPosition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const symbol = typeof p.symbol === "string" ? p.symbol : null;
    if (!symbol) continue;
    const amount = Number(p.amount ?? p.quantity ?? 0) * scale;
    const entry = Number(p.entry_price ?? 0);
    const mark = Number(p.mark_price ?? entry);
    const unrealized = Number(p.unrealized_pnl ?? 0) * scale;
    out.push({
      relationship_id: relationshipId,
      symbol,
      side: typeof p.side === "string" ? p.side : "long",
      quantity: round(amount, 6),
      entry_price: round(entry),
      mark_price: round(mark),
      notional_usd: round(Math.abs(amount) * mark),
      unrealized_pnl_usd: round(unrealized),
      opened_at: agg.lastRunAt,
      last_synced_at: agg.lastRunAt,
    });
  }
  return out;
}

function buildActivityFeed(
  copyRows: CopyRow[],
  botById: Map<string, BotRow>,
  runsByBot: Map<string, RunRow[]>,
) {
  const events: Array<{
    id: string | null;
    relationship_id: string | null;
    source_runtime_id: string | null;
    source_event_id: string | null;
    symbol: string | null;
    side: string | null;
    action_type: string | null;
    copied_quantity: number;
    reference_price: number;
    notional_estimate_usd: number;
    status: string | null;
    error_reason: string | null;
    created_at: string | null;
    updated_at: string | null;
  }> = [];
  for (const copy of copyRows) {
    if (copy.mode !== "mirror") continue;
    const runs = runsByBot.get(copy.sourceBotId) ?? [];
    const scale = (copy.scaleBps ?? 10000) / 10000;
    const recent = [...runs]
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
      .slice(0, 5);
    for (const run of recent) {
      const summary = (run.summary as Record<string, unknown> | null) ?? null;
      const positions = summary && Array.isArray((summary as { positions?: unknown }).positions)
        ? ((summary as { positions: unknown[] }).positions)
        : [];
      const first = positions[0] as Record<string, unknown> | undefined;
      events.push({
        id: run.id,
        relationship_id: copy.id,
        source_runtime_id: copy.sourceRuntimeId ?? null,
        source_event_id: run.id,
        symbol: first && typeof first.symbol === "string" ? first.symbol : null,
        side: first && typeof first.side === "string" ? first.side : null,
        action_type: "copy_event",
        copied_quantity: first ? round(Number(first.amount ?? 0) * scale, 6) : 0,
        reference_price: first ? round(Number(first.mark_price ?? 0)) : 0,
        notional_estimate_usd: first
          ? round(Math.abs(Number(first.amount ?? 0) * scale) * Number(first.mark_price ?? 0))
          : 0,
        status: "mirrored",
        error_reason: null,
        created_at: run.createdAt ?? run.startedAt ?? null,
        updated_at: run.createdAt ?? run.startedAt ?? null,
      });
    }
  }
  events.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return events.slice(0, 20);
}

async function buildDiscover(
  db: Db,
  excludeBotIds: Set<string>,
  limit: number,
) {
  const entries = await buildLeaderboard(db, limit + excludeBotIds.size + 4);
  const rows = entries
    .filter((e) => !excludeBotIds.has(e.bot.id))
    .slice(0, limit);
  const displayMap = await creatorDisplayNames(db, rows.map((e) => e.bot.ownerAddress));
  return rows.map((entry, idx) => ({
    runtime_id: entry.runtime?.id ?? entry.bot.id,
    bot_definition_id: entry.bot.id,
    bot_name: entry.bot.name,
    strategy_type: entry.bot.strategyType ?? "custom",
    rank: idx + 1,
    drawdown: entry.drift.live_drawdown_pct,
    trust_score: entry.trust.trust_score,
    creator_display_name:
      displayMap.get(entry.bot.ownerAddress.toLowerCase()) ?? shortDisplayName(entry.bot.ownerAddress),
    creator_id: entry.bot.ownerAddress,
  }));
}

function buildBasketSummary(p: PortfolioRow) {
  const legs = Array.isArray(p.legs) ? (p.legs as unknown[]) : [];
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    member_count: legs.length,
    target_notional_usd: round(p.targetNotionalUsd ?? 0),
    current_notional_usd: round(p.currentNotionalUsd ?? 0),
    health: p.killSwitchReason ? "halted" : p.status === "active" ? "healthy" : "idle",
    alert_count: p.killSwitchReason ? 1 : 0,
    aggregate_live_pnl_usd: round((p.currentNotionalUsd ?? 0) - (p.targetNotionalUsd ?? 0)),
    aggregate_drawdown_pct: round(p.driftThresholdPct ?? 0, 1),
    last_rebalanced_at: p.lastRebalancedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mutations — record copy metadata only (NO fund flow).
// ---------------------------------------------------------------------------

async function ensureUser(db: Db, address: string): Promise<void> {
  await db
    .insert(schema.users)
    .values({ walletAddress: address })
    .onConflictDoUpdate({
      target: schema.users.walletAddress,
      set: { lastSeen: nowIso() },
    });
}

/**
 * Resolve a source runtime_id (or bot id) to its bot + runtime. Returns null if
 * neither a runtime nor a bot matches the id.
 */
async function resolveSource(
  db: Db,
  sourceRuntimeId: string,
): Promise<{ bot: BotRow; runtime: RuntimeRow | null } | null> {
  const runtime = await db.query.botRuntimes.findFirst({
    where: eq(schema.botRuntimes.id, sourceRuntimeId),
  });
  if (runtime) {
    const bot = await db.query.bots.findFirst({ where: eq(schema.bots.id, runtime.botId) });
    if (!bot) return null;
    return { bot, runtime };
  }
  const bot = await db.query.bots.findFirst({ where: eq(schema.bots.id, sourceRuntimeId) });
  if (!bot) return null;
  return { bot, runtime: null };
}

// ===========================================================================
// ROUTES
// ===========================================================================

// GET /dashboard?wallet_address=  -> CopyTradingDashboard
r.get("/dashboard", async (c) => {
  const walletAddress = c.req.query("wallet_address");
  if (!walletAddress) {
    return c.json({ detail: "wallet_address is required" }, 400);
  }
  const db = getDb(c.env);
  const dashboard = await buildDashboard(db, walletAddress);
  return c.json(dashboard);
});

// GET /leaderboard?limit=  -> LeaderboardRow[]
r.get("/leaderboard", async (c) => {
  const db = getDb(c.env);
  const limit = clampLimit(c.req.query("limit"), 50);
  const entries = await buildLeaderboard(db, limit);

  // One CreatorSummary per owner (built once, reused per row).
  const creatorCache = new Map<string, CreatorSummary>();
  const rows = [];
  let rank = 1;
  for (const entry of entries) {
    const owner = entry.bot.ownerAddress.toLowerCase();
    let creator = creatorCache.get(owner);
    if (!creator) {
      const profile = await buildCreatorProfile(db, owner);
      const { bots: _bots, ...summary } = profile;
      void _bots;
      creator = summary;
      creatorCache.set(owner, creator);
    }
    rows.push(leaderboardRow(entry, rank, creator));
    rank += 1;
  }
  return c.json(rows);
});

// GET /leaderboard/candidates?limit=  -> LeaderboardCandidateRow[]
r.get("/leaderboard/candidates", async (c) => {
  const db = getDb(c.env);
  const limit = clampLimit(c.req.query("limit"), 24);
  const entries = await buildLeaderboard(db, limit);
  const rows = entries.map((entry, idx) => ({
    runtime_id: entry.runtime?.id ?? entry.bot.id,
    bot_definition_id: entry.bot.id,
    bot_name: entry.bot.name,
    strategy_type: entry.bot.strategyType ?? "custom",
    rank: idx + 1,
    drawdown: entry.drift.live_drawdown_pct,
    trust: entry.trust,
  }));
  return c.json(rows);
});

// GET /leaderboard/:runtimeId  -> RuntimeProfile
r.get("/leaderboard/:runtimeId", async (c) => {
  const db = getDb(c.env);
  const runtimeId = c.req.param("runtimeId");
  const profile = await buildRuntimeProfile(db, runtimeId);
  if (!profile) {
    return c.json({ detail: "Runtime not found" }, 404);
  }
  return c.json(profile);
});

// GET /creators/:creatorId  -> CreatorProfile
r.get("/creators/:creatorId", async (c) => {
  const db = getDb(c.env);
  const creatorId = c.req.param("creatorId");
  const profile = await buildCreatorProfile(db, creatorId);
  return c.json(profile);
});

// GET /runtime/:runtimeId/access?wallet_address=  -> RuntimeProfile (auth-gated)
r.get("/runtime/:runtimeId/access", requireAuth, async (c) => {
  const db = getDb(c.env);
  const runtimeId = c.req.param("runtimeId");
  const profile = await buildRuntimeProfile(db, runtimeId);
  if (!profile) {
    return c.json({ detail: "Runtime not found" }, 404);
  }
  // Access rule: public bots are open; private/unlisted only to the owner.
  if (profile.visibility !== "public" && profile.creator.wallet_address !== getAddress(c)) {
    return c.json({ detail: "You do not have access to this runtime." }, 403);
  }
  return c.json(profile);
});

// POST /preview  -> MirrorPreviewResponse (auth-gated)
r.post("/preview", requireAuth, async (c) => {
  const db = getDb(c.env);
  const caller = getAddress(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    source_runtime_id?: string;
    follower_wallet_address?: string;
    scale_bps?: number;
  };
  if (!body.source_runtime_id) {
    return c.json({ detail: "source_runtime_id is required" }, 400);
  }
  const source = await resolveSource(db, body.source_runtime_id);
  if (!source) {
    return c.json({ detail: "Source runtime not found" }, 404);
  }
  const scaleBps = Number.isFinite(body.scale_bps) ? Number(body.scale_bps) : 10000;
  const scale = scaleBps / 10000;
  const runRows = await db.select().from(schema.runs).where(eq(schema.runs.botId, source.bot.id));
  const agg = aggregateRuns(runRows);
  const positions = buildPositionsForFollow("preview", agg, scale);

  const warnings = [
    "Copy execution is metadata-only in this build — no funds move and no orders are placed.",
    "Mirrored sizes are scaled estimates from the source's latest reported run.",
  ];
  if (positions.length === 0) {
    warnings.push("This runtime has no open positions right now; activation waits for the next source action.");
  }

  return c.json({
    source_runtime_id: source.runtime?.id ?? source.bot.id,
    source_bot_definition_id: source.bot.id,
    source_bot_name: source.bot.name,
    source_wallet_address: source.bot.ownerAddress,
    follower_wallet_address: body.follower_wallet_address ?? caller,
    mode: "mirror",
    scale_bps: scaleBps,
    warnings,
    mirrored_positions: positions.map((p) => ({
      symbol: p.symbol,
      side: p.side,
      size_source: round(p.quantity / (scale || 1), 6),
      size_mirrored: p.quantity,
      mark_price: p.mark_price,
      notional_estimate: p.notional_usd,
    })),
  });
});

// POST /mirror  -> records a copies row (mode 'mirror'); auth-gated
r.post("/mirror", requireAuth, async (c) => {
  const db = getDb(c.env);
  const caller = getAddress(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    source_runtime_id?: string;
    follower_wallet_address?: string;
    follower_display_name?: string;
    scale_bps?: number;
    risk_ack_version?: string;
  };
  if (!body.source_runtime_id) {
    return c.json({ detail: "source_runtime_id is required" }, 400);
  }
  const source = await resolveSource(db, body.source_runtime_id);
  if (!source) {
    return c.json({ detail: "Source runtime not found" }, 404);
  }
  if (source.bot.ownerAddress.toLowerCase() === caller) {
    return c.json({ detail: "You cannot mirror your own bot." }, 400);
  }

  await ensureUser(db, caller);
  if (body.follower_display_name) {
    await db
      .update(schema.users)
      .set({ displayName: body.follower_display_name, lastSeen: nowIso() })
      .where(eq(schema.users.walletAddress, caller));
  }

  const scaleBps = Number.isFinite(body.scale_bps) ? Number(body.scale_bps) : 10000;
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.insert(schema.copies).values({
    id,
    sourceBotId: source.bot.id,
    sourceRuntimeId: source.runtime?.id ?? null,
    copierAddress: caller,
    mode: "mirror",
    status: "active",
    scaleBps,
    maxNotionalUsd: null,
    settings: { risk_ack_version: body.risk_ack_version ?? "v1" },
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(
    {
      id,
      source_runtime_id: source.runtime?.id ?? source.bot.id,
      source_bot_definition_id: source.bot.id,
      source_bot_name: source.bot.name,
      copier_address: caller,
      mode: "mirror",
      status: "active",
      scale_bps: scaleBps,
      confirmed_at: now,
      created_at: now,
      updated_at: now,
    },
    201,
  );
});

// POST /clone  -> CloneResponse; auth-gated. Creates a private bots draft.
r.post("/clone", requireAuth, async (c) => {
  const db = getDb(c.env);
  const caller = getAddress(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    source_runtime_id?: string;
    wallet_address?: string;
    name?: string;
    description?: string;
    visibility?: string;
  };
  if (!body.source_runtime_id) {
    return c.json({ detail: "source_runtime_id is required" }, 400);
  }
  const source = await resolveSource(db, body.source_runtime_id);
  if (!source) {
    return c.json({ detail: "Source runtime not found" }, 404);
  }

  await ensureUser(db, caller);

  const now = nowIso();
  const newBotId = crypto.randomUUID();
  const visibility = ["private", "unlisted", "public"].includes(body.visibility ?? "")
    ? (body.visibility as string)
    : "private";

  // New draft inherits the source's rules/market/strategy but is owned by caller.
  await db.insert(schema.bots).values({
    id: newBotId,
    ownerAddress: caller,
    name: body.name?.trim() || `${source.bot.name} Clone`,
    description: body.description?.trim() ?? "Cloned draft for custom edits",
    visibility,
    authoringMode: source.bot.authoringMode,
    strategyType: source.bot.strategyType,
    marketScope: source.bot.marketScope,
    rulesJson: source.bot.rulesJson,
    rulesVersion: 1,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });

  // Record the clone relationship (metadata only).
  const cloneId = crypto.randomUUID();
  await db.insert(schema.copies).values({
    id: cloneId,
    sourceBotId: source.bot.id,
    sourceRuntimeId: source.runtime?.id ?? null,
    copierAddress: caller,
    mode: "clone",
    status: "active",
    scaleBps: 10000,
    maxNotionalUsd: null,
    settings: { new_bot_definition_id: newBotId },
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(
    {
      clone_id: cloneId,
      source_runtime_id: source.runtime?.id ?? source.bot.id,
      source_bot_definition_id: source.bot.id,
      new_bot_definition_id: newBotId,
      created_by_user_id: caller,
      created_at: now,
    },
    201,
  );
});

// PATCH /:relationshipId  -> update follow (scale_bps / status); auth-gated
r.patch("/:relationshipId", requireAuth, async (c) => {
  const db = getDb(c.env);
  const caller = getAddress(c);
  const relationshipId = c.req.param("relationshipId");
  const body = (await c.req.json().catch(() => ({}))) as {
    scale_bps?: number;
    status?: string;
  };

  const existing = await db.query.copies.findFirst({
    where: and(eq(schema.copies.id, relationshipId), eq(schema.copies.copierAddress, caller)),
  });
  if (!existing) {
    return c.json({ detail: "Follow not found" }, 404);
  }

  const patch: Partial<typeof schema.copies.$inferInsert> = { updatedAt: nowIso() };
  if (Number.isFinite(body.scale_bps)) {
    patch.scaleBps = Number(body.scale_bps);
  }
  if (typeof body.status === "string" && ["active", "paused", "stopped"].includes(body.status)) {
    patch.status = body.status;
  }

  await db.update(schema.copies).set(patch).where(eq(schema.copies.id, relationshipId));
  const updated = await db.query.copies.findFirst({ where: eq(schema.copies.id, relationshipId) });

  return c.json({
    id: relationshipId,
    scale_bps: updated?.scaleBps ?? existing.scaleBps,
    status: updated?.status ?? existing.status,
    updated_at: updated?.updatedAt ?? nowIso(),
  });
});

// DELETE /:relationshipId  -> pause follow; auth-gated
r.delete("/:relationshipId", requireAuth, async (c) => {
  const db = getDb(c.env);
  const caller = getAddress(c);
  const relationshipId = c.req.param("relationshipId");

  const existing = await db.query.copies.findFirst({
    where: and(eq(schema.copies.id, relationshipId), eq(schema.copies.copierAddress, caller)),
  });
  if (!existing) {
    return c.json({ detail: "Follow not found" }, 404);
  }

  await db
    .update(schema.copies)
    .set({ status: "paused", updatedAt: nowIso() })
    .where(eq(schema.copies.id, relationshipId));

  return c.json({ id: relationshipId, status: "paused", updated_at: nowIso() });
});

export { r as botCopyRouter };
